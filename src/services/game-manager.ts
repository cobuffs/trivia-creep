import { TextChannel, Message, MessageFlags, MessageCreateOptions } from 'discord.js';
import { Question } from '../../helper-scripts/types';
import { DatabaseService } from './database';
import { validateAnswer } from './answer-validator';
import {
  createRulesEmbed,
  createQuestionEmbed,
  createLeaderboardEmbed,
  createCorrectAnswerEmbed,
  createTimesUpEmbed,
  createRoundBreakEmbed,
  createFinalJeopardyCategoryEmbed,
  createFinalJeopardyQuestionEmbed,
  createFinalJeopardyResultsEmbed,
  createFinalLeaderboardEmbed,
  formatCurrency
} from '../utils/formatters';
import { logger } from '../utils/logger';

export type GameStatus = 
  | 'IDLE'
  | 'STARTING'
  | 'ROUND_1'
  | 'ROUND_1_BREAK'
  | 'ROUND_2'
  | 'ROUND_2_BREAK'
  | 'FINAL_WAGERING'
  | 'FINAL_ANSWERING'
  | 'FINAL_RESULTS'
  | 'ARCHIVING';

export interface PlayerState {
  userId: string;
  username: string;
  score: number;
  round1Score: number;
  round2Score: number;
  finalWager?: number;
  finalAnswer?: string;
  finalCorrect?: boolean;
  finalScoreChange?: number;
  participated: boolean;
}

export interface GameState {
  gameId: string;
  guildId: string;
  channelId: string;
  channel?: TextChannel;
  status: GameStatus;
  currentRound: 'round1' | 'round2' | 'final';
  currentQuestionIndex: number;
  questions: {
    round1: Question[];
    round2: Question[];
    final: Question | null;
  };
  players: Map<string, PlayerState>;
  startTime: Date;
  currentQuestionStartTime?: Date;
  wageringPhaseEndTime?: Date;
  answeringPhaseEndTime?: Date;
  questionAnswered: boolean;
  timers: {
    questionTimer?: NodeJS.Timeout;
    breakTimer?: NodeJS.Timeout;
    wageringTimer?: NodeJS.Timeout;
    answeringTimer?: NodeJS.Timeout;
  };
}

export class GameManager {
  private static instance: GameManager;
  private gameState: GameState | null = null;
  private databaseService: DatabaseService;

  private constructor(databaseService: DatabaseService) {
    this.databaseService = databaseService;
  }

  static getInstance(databaseService: DatabaseService): GameManager {
    if (!GameManager.instance) {
      GameManager.instance = new GameManager(databaseService);
    }
    return GameManager.instance;
  }

  /**
   * Check if a game is currently active
   */
  isGameActive(): boolean {
    return this.gameState !== null && this.gameState.status !== 'IDLE';
  }

  /**
   * Get current game state
   */
  getGameState(): GameState | null {
    return this.gameState;
  }

  /**
   * Get game state for a specific guild
   */
  getGameStateForGuild(guildId: string): GameState | null {
    if (this.gameState && this.gameState.guildId === guildId) {
      return this.gameState;
    }
    return null;
  }

  /**
   * Start a new trivia game
   */
  async startGame(
    guildId: string,
    channelId: string,
    channel: TextChannel
  ): Promise<void> {
    if (this.isGameActive()) {
      throw new Error('A trivia game is already in progress');
    }

    logger.info(`Starting new trivia game for guild ${guildId}`);

    // Set status to STARTING
    this.gameState = {
      gameId: `game_${Date.now()}`,
      guildId,
      channelId,
      channel,
      status: 'STARTING',
      currentRound: 'round1',
      currentQuestionIndex: 0,
      questions: {
        round1: [],
        round2: [],
        final: null
      },
      players: new Map(),
      startTime: new Date(),
      questionAnswered: false,
      timers: {}
    };

    try {
      // Fetch questions from database
      const [round1Questions, round2Questions, finalQuestions] = await Promise.all([
        this.databaseService.getRandomQuestions('Jeopardy!', 10),
        this.databaseService.getRandomQuestions('Double Jeopardy!', 10),
        this.databaseService.getRandomQuestions('Final Jeopardy!', 1)
      ]);

      if (round1Questions.length < 10 || round2Questions.length < 10 || finalQuestions.length < 1) {
        this.gameState = null;
        throw new Error('Not enough questions available in database');
      }

      this.gameState.questions.round1 = round1Questions;
      this.gameState.questions.round2 = round2Questions;
      this.gameState.questions.final = finalQuestions[0];

      // Post game rules
      await channel.send({ embeds: [createRulesEmbed()] });

      // Start Round 1
      this.gameState.status = 'ROUND_1';
      await this.startQuestion(0, 'round1');

    } catch (error) {
      logger.error('Error starting game:', error);
      this.gameState = null;
      throw error;
    }
  }

  /**
   * Start a question
   */
  private async startQuestion(questionIndex: number, round: 'round1' | 'round2'): Promise<void> {
    if (!this.gameState || !this.gameState.channel) {
      return;
    }

    const questions = round === 'round1' ? this.gameState.questions.round1 : this.gameState.questions.round2;
    const question = questions[questionIndex];

    if (!question) {
      logger.error(`Question not found at index ${questionIndex} in ${round}`);
      return;
    }

    this.gameState.currentQuestionIndex = questionIndex;
    this.gameState.currentRound = round;
    this.gameState.questionAnswered = false;
    this.gameState.currentQuestionStartTime = new Date();

      // Show leaderboard if players exist (except for first question)
      if (this.gameState.players.size > 0 && (questionIndex > 0 || round === 'round2')) {
        const leaderboard = this.getCurrentLeaderboard();
        await this.gameState.channel.send({ 
          embeds: [createLeaderboardEmbed(leaderboard)],
          flags: MessageFlags.SuppressNotifications
        });
        
        // 5 second break between questions
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      // Post question
      const embed = createQuestionEmbed(
        round === 'round1' ? 1 : 2,
        questionIndex,
        question.category || 'Unknown',
        question.dollar_amount || 0,
        question.question
      );

      await this.gameState.channel.send({ 
        embeds: [embed],
        flags: MessageFlags.SuppressNotifications
      });

    // Start 30-second timer
    this.gameState.timers.questionTimer = setTimeout(async () => {
      await this.handleQuestionTimeout(question);
    }, 30000);
  }

  /**
   * Handle a message during a question
   */
  async handleMessage(message: Message): Promise<void> {
    if (!this.gameState || this.gameState.status !== 'ROUND_1' && this.gameState.status !== 'ROUND_2') {
      return;
    }

    if (message.channel.id !== this.gameState.channelId) {
      return;
    }

    if (message.author.bot) {
      return;
    }

    // Mark player as participated
    this.markPlayerParticipated(message.author.id, message.author.username);

    // Check if question already answered
    if (this.gameState.questionAnswered) {
      return;
    }

    const questions = this.gameState.currentRound === 'round1' 
      ? this.gameState.questions.round1 
      : this.gameState.questions.round2;
    const question = questions[this.gameState.currentQuestionIndex];

    if (!question) {
      return;
    }

    // Validate answer
    const isCorrect = validateAnswer(message.content, question.answer);

    if (isCorrect) {
      // Clear timer
      if (this.gameState.timers.questionTimer) {
        clearTimeout(this.gameState.timers.questionTimer);
        this.gameState.timers.questionTimer = undefined;
      }

      this.gameState.questionAnswered = true;

      // Award points
      const dollarAmount = question.dollar_amount || 0;
      this.awardPoints(message.author.id, message.author.username, dollarAmount);

      // Post success message
      if (message.channel.isTextBased() && 'send' in message.channel) {
        await (message.channel as TextChannel).send({ 
          embeds: [createCorrectAnswerEmbed(message.author.username, dollarAmount)],
          flags: MessageFlags.SuppressNotifications
        });
      }

      // Move to next question after a short delay
      setTimeout(async () => {
        await this.moveToNextQuestion();
      }, 2000);
    }
  }

  /**
   * Handle question timeout
   */
  private async handleQuestionTimeout(question: Question): Promise<void> {
    if (!this.gameState || !this.gameState.channel) {
      return;
    }

    if (this.gameState.questionAnswered) {
      return;
    }

    // Post time's up message
    await this.gameState.channel.send({ 
      embeds: [createTimesUpEmbed(question.answer)],
      flags: MessageFlags.SuppressNotifications
    });

    // Move to next question
    await this.moveToNextQuestion();
  }

  /**
   * Move to next question
   */
  private async moveToNextQuestion(): Promise<void> {
    if (!this.gameState) {
      return;
    }

    const currentRound = this.gameState.currentRound;
    const currentIndex = this.gameState.currentQuestionIndex;

    if (currentRound === 'round1') {
      if (currentIndex < 9) {
        // More questions in Round 1
        await this.startQuestion(currentIndex + 1, 'round1');
      } else {
        // Round 1 complete, start break
        await this.startRoundBreak(1);
      }
    } else if (currentRound === 'round2') {
      if (currentIndex < 9) {
        // More questions in Round 2
        await this.startQuestion(currentIndex + 1, 'round2');
      } else {
        // Round 2 complete, start Final Jeopardy
        await this.startFinalJeopardy();
      }
    }
  }

  /**
   * Start round break
   */
  private async startRoundBreak(round: 1 | 2): Promise<void> {
    if (!this.gameState || !this.gameState.channel) {
      return;
    }

    this.gameState.status = round === 1 ? 'ROUND_1_BREAK' : 'ROUND_2_BREAK';

    const leaderboard = this.getCurrentLeaderboard();
    const embed = createRoundBreakEmbed(round, leaderboard);
    await this.gameState.channel.send({ 
      embeds: [embed],
      flags: MessageFlags.SuppressNotifications
    });

    // 30-second break
    this.gameState.timers.breakTimer = setTimeout(async () => {
      if (round === 1) {
        this.gameState!.status = 'ROUND_2';
        await this.startQuestion(0, 'round2');
      } else {
        await this.startFinalJeopardy();
      }
    }, 30000);
  }

  /**
   * Start Final Jeopardy
   */
  private async startFinalJeopardy(): Promise<void> {
    if (!this.gameState || !this.gameState.channel || !this.gameState.questions.final) {
      return;
    }

    this.gameState.status = 'FINAL_WAGERING';
    this.gameState.currentRound = 'final';

    const leaderboard = this.getCurrentLeaderboard();
    const embed = createFinalJeopardyCategoryEmbed(
      this.gameState.questions.final.category || 'Unknown',
      leaderboard
    );

    await this.gameState.channel.send({ 
      embeds: [embed],
      flags: MessageFlags.SuppressNotifications
    });

    // 30-second wagering phase
    this.gameState.wageringPhaseEndTime = new Date(Date.now() + 30000);
    this.gameState.timers.wageringTimer = setTimeout(async () => {
      await this.startFinalJeopardyAnswering();
    }, 30000);
  }

  /**
   * Start Final Jeopardy answering phase
   */
  private async startFinalJeopardyAnswering(): Promise<void> {
    if (!this.gameState || !this.gameState.channel || !this.gameState.questions.final) {
      return;
    }

    this.gameState.status = 'FINAL_ANSWERING';

    const embed = createFinalJeopardyQuestionEmbed(
      this.gameState.questions.final.category || 'Unknown',
      this.gameState.questions.final.question
    );

    await this.gameState.channel.send({ 
      embeds: [embed],
      flags: MessageFlags.SuppressNotifications
    });

    // 30-second answering phase
    this.gameState.answeringPhaseEndTime = new Date(Date.now() + 30000);
    this.gameState.timers.answeringTimer = setTimeout(async () => {
      await this.showFinalJeopardyResults();
    }, 30000);
  }

  /**
   * Show Final Jeopardy results
   */
  private async showFinalJeopardyResults(): Promise<void> {
    if (!this.gameState || !this.gameState.channel || !this.gameState.questions.final) {
      return;
    }

    this.gameState.status = 'FINAL_RESULTS';

    // Calculate final scores
    const results: Array<{
      username: string;
      answer: string;
      correct: boolean;
      wager: number;
      finalScore: number;
    }> = [];

    for (const player of this.gameState.players.values()) {
      if (player.finalWager !== undefined) {
        let isCorrect = player.finalCorrect === true;
        let scoreChange: number;
        
        if (player.finalAnswer) {
          // Player answered - calculate based on correctness
          scoreChange = isCorrect ? player.finalWager : -player.finalWager;
          player.score += scoreChange;
          player.finalScoreChange = scoreChange;
        } else {
          // Player wagered but didn't answer - treat as incorrect
          isCorrect = false;
          player.finalCorrect = false;
          scoreChange = -player.finalWager;
          player.score += scoreChange;
          player.finalScoreChange = scoreChange;
        }

        // Add to results (include all players who wagered)
        results.push({
          username: player.username,
          answer: player.finalAnswer || '(no answer)',
          correct: isCorrect,
          wager: player.finalWager,
          finalScore: player.score
        });
      }
    }

    // Post results
    const resultsEmbed = createFinalJeopardyResultsEmbed(
      this.gameState.questions.final.answer,
      results
    );
    await this.gameState.channel.send({ 
      embeds: [resultsEmbed],
      flags: MessageFlags.SuppressNotifications
    });

    // Post final leaderboard
    const leaderboard = this.getCurrentLeaderboard();
    const leaderboardEmbed = createFinalLeaderboardEmbed(leaderboard);
    await this.gameState.channel.send({ 
      embeds: [leaderboardEmbed],
      flags: MessageFlags.SuppressNotifications
    });

    // Archive game
    await this.archiveGame();
  }

  /**
   * Archive game to database
   */
  private async archiveGame(): Promise<void> {
    if (!this.gameState) {
      return;
    }

    this.gameState.status = 'ARCHIVING';

    try {
      const round1QuestionIds = this.gameState.questions.round1.map((q, idx) => {
        // We need to get question IDs from database - for now, we'll store indices
        // In a real implementation, we'd need to track question IDs
        return idx;
      });
      const round2QuestionIds = this.gameState.questions.round2.map((q, idx) => idx);

      const players = Array.from(this.gameState.players.values()).map(player => ({
        userId: player.userId,
        username: player.username,
        finalScore: player.score,
        round1Score: player.round1Score,
        round2Score: player.round2Score,
        finalWager: player.finalWager ?? null,
        finalCorrect: player.finalCorrect ?? null,
        finalScoreChange: player.finalScoreChange ?? null
      }));

      await this.databaseService.archiveGame(
        this.gameState.guildId,
        this.gameState.channelId,
        this.gameState.startTime,
        new Date(),
        'completed',
        round1QuestionIds,
        round2QuestionIds,
        null, // finalQuestionId - would need to track this
        players
      );

      logger.info(`Game ${this.gameState.gameId} archived successfully`);
    } catch (error) {
      logger.error('Error archiving game:', error);
    } finally {
      this.clearAllTimers();
      this.gameState = null;
    }
  }

  /**
   * End game early
   */
  async endGameEarly(): Promise<void> {
    if (!this.gameState) {
      throw new Error('No active game to end');
    }

    logger.info(`Ending game ${this.gameState.gameId} early`);

    this.clearAllTimers();

    // Calculate final scores based on current state
    if (this.gameState.status === 'FINAL_ANSWERING' || this.gameState.status === 'FINAL_WAGERING') {
      // Handle Final Jeopardy players
      for (const player of this.gameState.players.values()) {
        if (player.finalWager !== undefined) {
          if (player.finalAnswer && player.finalCorrect !== undefined) {
            // Player answered - calculate normally
            const scoreChange = player.finalCorrect ? player.finalWager : -player.finalWager;
            player.score += scoreChange;
            player.finalScoreChange = scoreChange;
          } else if (player.finalWager > 0) {
            // Player wagered but didn't answer - treat as incorrect
            player.finalCorrect = false;
            player.score -= player.finalWager;
            player.finalScoreChange = -player.finalWager;
          }
        }
      }
    }

    // Post final leaderboard
    if (this.gameState.channel) {
      const leaderboard = this.getCurrentLeaderboard();
      const embed = createFinalLeaderboardEmbed(leaderboard);
      embed.setTitle('🛑 Game Ended Early');
      embed.setFooter({ text: 'Game has been archived.' });
      await this.gameState.channel.send({ 
        embeds: [embed],
        flags: MessageFlags.SuppressNotifications
      });
    }

    // Archive with 'abandoned' status
    this.gameState.status = 'ARCHIVING';
    try {
      const round1QuestionIds = this.gameState.questions.round1.map((q, idx) => idx);
      const round2QuestionIds = this.gameState.questions.round2.map((q, idx) => idx);

      const players = Array.from(this.gameState.players.values()).map(player => ({
        userId: player.userId,
        username: player.username,
        finalScore: player.score,
        round1Score: player.round1Score,
        round2Score: player.round2Score,
        finalWager: player.finalWager ?? null,
        finalCorrect: player.finalCorrect ?? null,
        finalScoreChange: player.finalScoreChange ?? null
      }));

      await this.databaseService.archiveGame(
        this.gameState.guildId,
        this.gameState.channelId,
        this.gameState.startTime,
        new Date(),
        'abandoned',
        round1QuestionIds,
        round2QuestionIds,
        null,
        players
      );
    } catch (error) {
      logger.error('Error archiving abandoned game:', error);
    } finally {
      this.gameState = null;
    }
  }

  /**
   * Place Final Jeopardy wager
   */
  placeFinalWager(userId: string, username: string, wager: number): void {
    if (!this.gameState || this.gameState.status !== 'FINAL_WAGERING') {
      throw new Error('Wagering phase is not active');
    }

    const player = this.getOrCreatePlayer(userId, username);
    
    if (player.finalWager !== undefined) {
      throw new Error('You have already placed your wager');
    }

    // Validate wager
    const maxWager = player.score > 0 ? player.score : 2000;
    if (wager < 1 || wager > maxWager || !Number.isInteger(wager)) {
      throw new Error(`Invalid wager amount. You can wager between $1 and ${formatCurrency(maxWager)}`);
    }

    player.finalWager = wager;
    player.participated = true;
  }

  /**
   * Submit Final Jeopardy answer
   */
  submitFinalAnswer(userId: string, username: string, answer: string): void {
    if (!this.gameState || this.gameState.status !== 'FINAL_ANSWERING') {
      throw new Error('Answering phase is not active');
    }

    const player = this.getOrCreatePlayer(userId, username);

    if (player.finalWager === undefined) {
      throw new Error('You must place a wager first using `/final-wager`');
    }

    if (player.finalAnswer !== undefined) {
      throw new Error('You have already submitted your answer');
    }

    if (!this.gameState.questions.final) {
      throw new Error('Final Jeopardy question not found');
    }

    // Validate answer
    const isCorrect = validateAnswer(answer, this.gameState.questions.final.answer);
    player.finalAnswer = answer;
    player.finalCorrect = isCorrect;
    player.participated = true;
  }

  /**
   * Get or create player state
   */
  private getOrCreatePlayer(userId: string, username: string): PlayerState {
    if (!this.gameState) {
      throw new Error('No active game');
    }

    if (!this.gameState.players.has(userId)) {
      this.gameState.players.set(userId, {
        userId,
        username,
        score: 0,
        round1Score: 0,
        round2Score: 0,
        participated: false
      });
    }

    return this.gameState.players.get(userId)!;
  }

  /**
   * Mark player as participated
   */
  private markPlayerParticipated(userId: string, username: string): void {
    const player = this.getOrCreatePlayer(userId, username);
    player.participated = true;
  }

  /**
   * Award points to a player
   */
  private awardPoints(userId: string, username: string, amount: number): void {
    const player = this.getOrCreatePlayer(userId, username);
    player.score += amount;
    
    if (this.gameState!.currentRound === 'round1') {
      player.round1Score += amount;
    } else {
      player.round2Score += amount;
    }
  }

  /**
   * Get current leaderboard
   */
  getCurrentLeaderboard(): Array<{ username: string; score: number }> {
    if (!this.gameState) {
      return [];
    }

    return Array.from(this.gameState.players.values())
      .filter(p => p.participated)
      .sort((a, b) => b.score - a.score)
      .map(p => ({ username: p.username, score: p.score }));
  }

  /**
   * Clear all timers
   */
  private clearAllTimers(): void {
    if (!this.gameState) {
      return;
    }

    if (this.gameState.timers.questionTimer) {
      clearTimeout(this.gameState.timers.questionTimer);
    }
    if (this.gameState.timers.breakTimer) {
      clearTimeout(this.gameState.timers.breakTimer);
    }
    if (this.gameState.timers.wageringTimer) {
      clearTimeout(this.gameState.timers.wageringTimer);
    }
    if (this.gameState.timers.answeringTimer) {
      clearTimeout(this.gameState.timers.answeringTimer);
    }

    this.gameState.timers = {};
  }
}
