import { TextChannel, Message, MessageFlags, MessageCreateOptions, ThreadChannel } from 'discord.js';
import { Question } from '../../helper-scripts/types';
import { DatabaseService } from './database';
import { validateAnswer } from './answer-validator';
import { LMStudioService, AnswerSpec } from './lmstudio';
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
  createInfoEmbed,
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
  thread?: ThreadChannel;
  status: GameStatus;
  currentRound: 'round1' | 'round2' | 'final';
  currentQuestionIndex: number;
  questions: {
    round1: Question[];
    round2: Question[];
    final: Question | null;
  };
  normalizedAnswers: Map<number, AnswerSpec>; // question_id -> AnswerSpec
  players: Map<string, PlayerState>;
  startTime: Date;
  currentQuestionStartTime?: Date;
  currentQuestionEndTime?: Date;
  wageringPhaseEndTime?: Date;
  answeringPhaseEndTime?: Date;
  questionAnswered: boolean;
  timers: {
    questionTimer?: NodeJS.Timeout;
    breakTimer?: NodeJS.Timeout;
    wageringTimer?: NodeJS.Timeout;
    answeringTimer?: NodeJS.Timeout;
    threadDeletionTimer?: NodeJS.Timeout;
  };
}

export class GameManager {
  private static instance: GameManager;
  private gameState: GameState | null = null;
  private databaseService: DatabaseService;
  private lmStudioService: LMStudioService;

  private constructor(databaseService: DatabaseService) {
    this.databaseService = databaseService;
    this.lmStudioService = new LMStudioService();
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
      normalizedAnswers: new Map(),
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

      // Debug: Log question IDs when questions are loaded
      const round1Ids = round1Questions.map(q => q.id).filter((id): id is number => id !== undefined);
      const round2Ids = round2Questions.map(q => q.id).filter((id): id is number => id !== undefined);
      const finalId = finalQuestions[0]?.id;
      logger.debug(`[GAME START DEBUG] Round 1 Question IDs loaded: ${JSON.stringify(round1Ids)}`);
      logger.debug(`[GAME START DEBUG] Round 2 Question IDs loaded: ${JSON.stringify(round2Ids)}`);
      logger.debug(`[GAME START DEBUG] Final Question ID loaded: ${finalId}`);

      // Create a thread for this game with timestamp
      const startTime = new Date();
      // Format timestamp using system timezone (should match server timezone)
      // Format: YYYY-MM-DD HH:MM:SS in local time
      const year = startTime.getFullYear();
      const month = String(startTime.getMonth() + 1).padStart(2, '0');
      const day = String(startTime.getDate()).padStart(2, '0');
      const hours = String(startTime.getHours()).padStart(2, '0');
      const minutes = String(startTime.getMinutes()).padStart(2, '0');
      const seconds = String(startTime.getSeconds()).padStart(2, '0');
      const timestamp = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
      const thread = await channel.threads.create({
        name: `Trivia ${timestamp}`,
        autoArchiveDuration: 60, // 1 hour
        reason: 'Trivia game thread'
      });
      this.gameState.thread = thread;
      logger.info(`Created trivia thread: ${thread.id} with name: ${thread.name}`);

      // Post game rules with thread link
      const threadLink = `https://discord.com/channels/${guildId}/${thread.id}`;
      
      // Find and mention the trivia-nerds role
      const triviaNerdsRole = channel.guild.roles.cache.find(role => role.name === 'trivia-nerds');
      const roleMention = triviaNerdsRole ? `<@&${triviaNerdsRole.id}>` : '';
      
      await channel.send({ 
        content: roleMention ? `${roleMention} Trivia is starting in 60 seconds!` : undefined,
        embeds: [createRulesEmbed(threadLink)]
      });

      // Start normalization in background (in order: round1, round2, final)
      this.startNormalizationInBackground(round1Questions, round2Questions, finalQuestions[0] || null);

      // Wait 60 seconds before starting to give people time to join the thread
      await new Promise(resolve => setTimeout(resolve, 60000));

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
   * Start a scheduled trivia game (with pre-loaded questions and thread)
   */
  async startScheduledGame(
    guildId: string,
    channelId: string,
    channel: TextChannel,
    thread: ThreadChannel,
    round1Questions: Question[],
    round2Questions: Question[],
    finalQuestion: Question,
    normalizedAnswers: Map<number, AnswerSpec>
  ): Promise<void> {
    if (this.isGameActive()) {
      throw new Error('A trivia game is already in progress');
    }

    logger.info(`Starting scheduled trivia game for guild ${guildId}`);

    // Set status to STARTING
    this.gameState = {
      gameId: `game_${Date.now()}`,
      guildId,
      channelId,
      channel,
      thread,
      status: 'STARTING',
      currentRound: 'round1',
      currentQuestionIndex: 0,
      questions: {
        round1: round1Questions,
        round2: round2Questions,
        final: finalQuestion
      },
      normalizedAnswers,
      players: new Map(),
      startTime: new Date(),
      questionAnswered: false,
      timers: {}
    };

    try {
      // Debug: Log question IDs when questions are loaded
      const round1Ids = round1Questions.map(q => q.id).filter((id): id is number => id !== undefined);
      const round2Ids = round2Questions.map(q => q.id).filter((id): id is number => id !== undefined);
      const finalId = finalQuestion?.id;
      logger.debug(`[SCHEDULED GAME START DEBUG] Round 1 Question IDs loaded: ${JSON.stringify(round1Ids)}`);
      logger.debug(`[SCHEDULED GAME START DEBUG] Round 2 Question IDs loaded: ${JSON.stringify(round2Ids)}`);
      logger.debug(`[SCHEDULED GAME START DEBUG] Final Question ID loaded: ${finalId}`);

      // Post game rules to thread (no 60-second wait for scheduled games)
      const threadLink = `https://discord.com/channels/${guildId}/${thread.id}`;
      
      // Find and mention the trivia-nerds role
      const triviaNerdsRole = channel.guild.roles.cache.find(role => role.name === 'trivia-nerds');
      const roleMention = triviaNerdsRole ? `<@&${triviaNerdsRole.id}>` : '';
      
      await channel.send({ 
        content: roleMention ? `${roleMention} Scheduled trivia is starting now!` : undefined,
        embeds: [createRulesEmbed(threadLink)]
      });

      // Post to thread as well
      await thread.send({
        embeds: [createInfoEmbed(
          '🎮 Game Starting',
          'The scheduled trivia game is starting now! Get ready!'
        )]
      });

      // Start Round 1 immediately (no wait for scheduled games)
      this.gameState.status = 'ROUND_1';
      await this.startQuestion(0, 'round1');

    } catch (error) {
      logger.error('Error starting scheduled game:', error);
      this.gameState = null;
      throw error;
    }
  }

  /**
   * Start normalization in background in the order questions will be asked
   */
  private async startNormalizationInBackground(
    round1Questions: Question[],
    round2Questions: Question[],
    finalQuestion: Question | null
  ): Promise<void> {
    // Collect all question IDs
    const allQuestionIds = [
      ...round1Questions.map(q => q.id).filter((id): id is number => id !== undefined),
      ...round2Questions.map(q => q.id).filter((id): id is number => id !== undefined),
      ...(finalQuestion?.id ? [finalQuestion.id] : [])
    ];

    // Check if LMStudio server is running
    const lmStudioRunning = await this.lmStudioService.isServerRunning();
    logger.info(`LMStudio server is ${lmStudioRunning ? 'running' : 'not running'}`);

    // Load existing normalized answers from database
    const existingSpecs = await this.databaseService.getAnswerSpecs(allQuestionIds);
    for (const [questionId, spec] of existingSpecs) {
      this.gameState!.normalizedAnswers.set(questionId, spec);
    }
    logger.info(`Loaded ${existingSpecs.size} existing normalized answers from database`);

    // If LMStudio is not running, we're done
    if (!lmStudioRunning) {
      const questionsNeedingNormalization = allQuestionIds.length - existingSpecs.size;
      if (questionsNeedingNormalization > 0) {
        logger.info(`LMStudio not running. ${questionsNeedingNormalization} questions will use fallback validation.`);
      }
      return;
    }

    // Build list of questions needing normalization in order: round1, round2, final
    const questionsNeedingNormalization: Array<{ question: Question; id: number }> = [];
    
    // Round 1 questions first
    for (const question of round1Questions) {
      if (question.id && !this.gameState!.normalizedAnswers.has(question.id)) {
        questionsNeedingNormalization.push({ question, id: question.id });
      }
    }
    
    // Round 2 questions second
    for (const question of round2Questions) {
      if (question.id && !this.gameState!.normalizedAnswers.has(question.id)) {
        questionsNeedingNormalization.push({ question, id: question.id });
      }
    }
    
    // Final question last
    if (finalQuestion && finalQuestion.id && !this.gameState!.normalizedAnswers.has(finalQuestion.id)) {
      questionsNeedingNormalization.push({ question: finalQuestion, id: finalQuestion.id });
    }

    if (questionsNeedingNormalization.length === 0) {
      logger.info('All answers already normalized');
      return;
    }

    logger.info(`Normalizing ${questionsNeedingNormalization.length} answers in background using LMStudio...`);
    
    // Normalize questions sequentially in order (not parallel) to prioritize earlier questions
    // This ensures round1 questions are normalized first
    (async () => {
      for (const { question, id } of questionsNeedingNormalization) {
        try {
          const spec = await this.lmStudioService.normalizeAnswer(
            question.question,
            question.answer,
            question.category ?? null
          );
          
          // Store in memory
          if (this.gameState) {
            this.gameState.normalizedAnswers.set(id, spec);
          }
          
          // Store in database
          await this.databaseService.storeAnswerSpec(id, spec);
          
          logger.debug(`Normalized answer for question_id=${id}`);
        } catch (error) {
          logger.error(`Failed to normalize answer for question_id=${id}:`, error);
          // Continue with next question even if one fails
        }
      }
      logger.info(`Background normalization complete`);
    })().catch(error => {
      logger.error('Error in background normalization:', error);
    });
  }

  /**
   * Start a question
   */
  private async startQuestion(questionIndex: number, round: 'round1' | 'round2'): Promise<void> {
    if (!this.gameState || !this.gameState.thread) {
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
    this.gameState.currentQuestionEndTime = new Date(Date.now() + 30000); // 30 seconds from now

      // Show leaderboard if players exist (except for first question)
      if (this.gameState.players.size > 0 && (questionIndex > 0 || round === 'round2')) {
        const leaderboard = this.getCurrentLeaderboard();
        await this.gameState.thread.send({ 
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

      await this.gameState.thread.send({ 
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

    // Accept messages from either the main channel or the game thread
    const isMainChannel = message.channel.id === this.gameState.channelId;
    const isThread = this.gameState.thread && message.channel.id === this.gameState.thread.id;
    
    if (!isMainChannel && !isThread) {
      return;
    }

    if (message.author.bot) {
      return;
    }

    // Mark player as participated
    this.markPlayerParticipated(message.author.id, message.author.username);

    // Check if question already answered (atomic check)
    if (this.gameState.questionAnswered) {
      return;
    }

    // Check if time has expired - reject answers that come in after the timeout
    const now = new Date();
    if (this.gameState.currentQuestionEndTime && now > this.gameState.currentQuestionEndTime) {
      return;
    }

    const questions = this.gameState.currentRound === 'round1' 
      ? this.gameState.questions.round1 
      : this.gameState.questions.round2;
    const question = questions[this.gameState.currentQuestionIndex];

    if (!question) {
      return;
    }

    // Get normalized answer spec if available
    const normalizedSpec = question.id ? this.gameState.normalizedAnswers.get(question.id) : undefined;
    
    // Validate answer (use normalized spec if available, otherwise fallback)
    const isCorrect = validateAnswer(message.content, question.answer, normalizedSpec);

    if (isCorrect) {
      // Double-check time hasn't expired while we were validating (race condition protection)
      const checkTime = new Date();
      if (this.gameState.currentQuestionEndTime && checkTime > this.gameState.currentQuestionEndTime) {
        return;
      }

      // Atomic check-and-set: check again if question was answered while we were validating
      if (this.gameState.questionAnswered) {
        return;
      }

      // Set answered flag before clearing timer to prevent race condition
      this.gameState.questionAnswered = true;

      // Clear timer
      if (this.gameState.timers.questionTimer) {
        clearTimeout(this.gameState.timers.questionTimer);
        this.gameState.timers.questionTimer = undefined;
      }

      // Award points
      const dollarAmount = question.dollar_amount || 0;
      this.awardPoints(message.author.id, message.author.username, dollarAmount);

      // Post success message
      if (message.channel.isTextBased() && 'send' in message.channel) {
        await (message.channel as TextChannel).send({ 
          embeds: [createCorrectAnswerEmbed(message.author.username, dollarAmount, question.answer)],
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
    if (!this.gameState || !this.gameState.thread) {
      return;
    }

    // Atomic check: if question was answered, don't proceed
    if (this.gameState.questionAnswered) {
      return;
    }

    // Double-check timestamp to ensure we're actually past the timeout
    const now = new Date();
    if (this.gameState.currentQuestionEndTime && now < this.gameState.currentQuestionEndTime) {
      // Timer fired early somehow, don't proceed
      return;
    }

    // Set answered flag to prevent any late-arriving answers from being processed
    this.gameState.questionAnswered = true;

    // Post time's up message
    await this.gameState.thread.send({ 
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
    if (!this.gameState || !this.gameState.thread) {
      return;
    }

    this.gameState.status = round === 1 ? 'ROUND_1_BREAK' : 'ROUND_2_BREAK';

    const leaderboard = this.getCurrentLeaderboard();
    const embed = createRoundBreakEmbed(round, leaderboard);
    await this.gameState.thread.send({ 
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
    if (!this.gameState || !this.gameState.thread || !this.gameState.questions.final) {
      return;
    }

    this.gameState.status = 'FINAL_WAGERING';
    this.gameState.currentRound = 'final';

    const leaderboard = this.getCurrentLeaderboard();
    const embed = createFinalJeopardyCategoryEmbed(
      this.gameState.questions.final.category || 'Unknown',
      leaderboard
    );

    await this.gameState.thread.send({ 
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
    if (!this.gameState || !this.gameState.thread || !this.gameState.questions.final) {
      return;
    }

    this.gameState.status = 'FINAL_ANSWERING';

    const embed = createFinalJeopardyQuestionEmbed(
      this.gameState.questions.final.category || 'Unknown',
      this.gameState.questions.final.question
    );

    await this.gameState.thread.send({ 
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

    // Post results to thread only
    const resultsEmbed = createFinalJeopardyResultsEmbed(
      this.gameState.questions.final.answer,
      results
    );
    
    if (this.gameState.thread) {
      await this.gameState.thread.send({ 
        embeds: [resultsEmbed],
        flags: MessageFlags.SuppressNotifications
      });
    }

    // Post final leaderboard to both thread and main channel
    const leaderboard = this.getCurrentLeaderboard();
    const leaderboardEmbed = createFinalLeaderboardEmbed(leaderboard);
    
    // Post to thread
    if (this.gameState.thread) {
      await this.gameState.thread.send({ 
        embeds: [leaderboardEmbed],
        flags: MessageFlags.SuppressNotifications
      });
    }
    
    // Post to main channel
    if (this.gameState.channel) {
      await this.gameState.channel.send({ 
        embeds: [leaderboardEmbed],
        flags: MessageFlags.SuppressNotifications
      });
    }

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
      const round1QuestionIds = this.gameState.questions.round1
        .map(q => q.id)
        .filter((id): id is number => id !== undefined);
      const round2QuestionIds = this.gameState.questions.round2
        .map(q => q.id)
        .filter((id): id is number => id !== undefined);
      const finalQuestionId = this.gameState.questions.final?.id ?? null;

      // Debug: Log question IDs to verify they're being captured correctly
      logger.debug(`[ARCHIVE DEBUG] Round 1 Question IDs: ${JSON.stringify(round1QuestionIds)}`);
      logger.debug(`[ARCHIVE DEBUG] Round 2 Question IDs: ${JSON.stringify(round2QuestionIds)}`);
      logger.debug(`[ARCHIVE DEBUG] Final Question ID: ${finalQuestionId}`);
      logger.debug(`[ARCHIVE DEBUG] Round 1 questions count: ${this.gameState.questions.round1.length}, IDs extracted: ${round1QuestionIds.length}`);
      logger.debug(`[ARCHIVE DEBUG] Round 2 questions count: ${this.gameState.questions.round2.length}, IDs extracted: ${round2QuestionIds.length}`);

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

      // Only archive if more than 1 player participated (prevent gaming the system)
      if (players.length > 1) {
        await this.databaseService.archiveGame(
          this.gameState.guildId,
          this.gameState.channelId,
          this.gameState.startTime,
          new Date(),
          'completed',
          round1QuestionIds,
          round2QuestionIds,
          finalQuestionId,
          players
        );

        logger.info(`Game ${this.gameState.gameId} archived successfully`);
      } else {
        logger.info(`Game ${this.gameState.gameId} not archived - only 1 player participated`);
      }
    } catch (error) {
      logger.error('Error archiving game:', error);
    } finally {
      // Schedule thread deletion before clearing game state
      const thread = this.gameState?.thread;
      if (thread) {
        this.scheduleThreadDeletion(thread);
      }
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

    // Post "Game Ended Early" message to thread
    if (this.gameState.thread) {
      await this.gameState.thread.send({ 
        embeds: [createInfoEmbed(
          '🛑 Game Ended Early',
          'The trivia game has been ended early. Final leaderboard below.'
        )],
        flags: MessageFlags.SuppressNotifications
      });
    }

    // Post final leaderboard to both thread and main channel
    const leaderboard = this.getCurrentLeaderboard();
    const threadEmbed = createFinalLeaderboardEmbed(leaderboard);
    threadEmbed.setTitle('🛑 Game Ended Early - Final Leaderboard');
    threadEmbed.setFooter({ text: 'Game has been archived.' });
    
    const channelEmbed = createFinalLeaderboardEmbed(leaderboard);
    channelEmbed.setFooter({ text: 'Game has been archived.' });
    
    // Post to thread
    if (this.gameState.thread) {
      await this.gameState.thread.send({ 
        embeds: [threadEmbed],
        flags: MessageFlags.SuppressNotifications
      });
    }
    
    // Post to main channel (without "Game Ended Early" in title)
    if (this.gameState.channel) {
      await this.gameState.channel.send({ 
        embeds: [channelEmbed],
        flags: MessageFlags.SuppressNotifications
      });
    }

    // Archive with 'abandoned' status
    this.gameState.status = 'ARCHIVING';
    try {
      const round1QuestionIds = this.gameState.questions.round1
        .map(q => q.id)
        .filter((id): id is number => id !== undefined);
      const round2QuestionIds = this.gameState.questions.round2
        .map(q => q.id)
        .filter((id): id is number => id !== undefined);
      const finalQuestionId = this.gameState.questions.final?.id ?? null;

      // Debug: Log question IDs to verify they're being captured correctly
      logger.debug(`[ARCHIVE DEBUG] Round 1 Question IDs: ${JSON.stringify(round1QuestionIds)}`);
      logger.debug(`[ARCHIVE DEBUG] Round 2 Question IDs: ${JSON.stringify(round2QuestionIds)}`);
      logger.debug(`[ARCHIVE DEBUG] Final Question ID: ${finalQuestionId}`);
      logger.debug(`[ARCHIVE DEBUG] Round 1 questions count: ${this.gameState.questions.round1.length}, IDs extracted: ${round1QuestionIds.length}`);
      logger.debug(`[ARCHIVE DEBUG] Round 2 questions count: ${this.gameState.questions.round2.length}, IDs extracted: ${round2QuestionIds.length}`);

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

      // Only archive if more than 1 player participated (prevent gaming the system)
      if (players.length > 1) {
        await this.databaseService.archiveGame(
          this.gameState.guildId,
          this.gameState.channelId,
          this.gameState.startTime,
          new Date(),
          'abandoned',
          round1QuestionIds,
          round2QuestionIds,
          finalQuestionId,
          players
        );
      } else {
        logger.info(`Game ${this.gameState.gameId} not archived - only 1 player participated`);
      }
    } catch (error) {
      logger.error('Error archiving abandoned game:', error);
    } finally {
      // Schedule thread deletion before clearing game state
      const thread = this.gameState?.thread;
      if (thread) {
        this.scheduleThreadDeletion(thread);
      }
      this.clearAllTimers();
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

    // Get normalized answer spec if available
    const normalizedSpec = this.gameState.questions.final?.id 
      ? this.gameState.normalizedAnswers.get(this.gameState.questions.final.id) 
      : undefined;
    
    // Validate answer (use normalized spec if available, otherwise fallback)
    const isCorrect = validateAnswer(answer, this.gameState.questions.final.answer, normalizedSpec);
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
   * Schedule thread deletion 5 minutes after game ends
   */
  private scheduleThreadDeletion(thread: ThreadChannel): void {
    // Schedule deletion in 5 minutes (300000 ms)
    // Note: Timer is not stored in gameState since gameState will be cleared
    // The closure keeps a reference to the thread, which is sufficient
    setTimeout(async () => {
      try {
        await thread.delete('Trivia game completed - auto-cleanup');
        logger.info(`Thread ${thread.id} deleted successfully after game completion`);
      } catch (error) {
        logger.error(`Failed to delete thread ${thread.id}:`, error);
        // Thread might have already been deleted or bot lacks permissions
      }
    }, 300000); // 5 minutes
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
    if (this.gameState.timers.threadDeletionTimer) {
      clearTimeout(this.gameState.timers.threadDeletionTimer);
    }

    this.gameState.timers = {};
  }
}
