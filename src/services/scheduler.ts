import { Client, TextChannel, ThreadChannel } from 'discord.js';
import { DatabaseService, ScheduledGame } from './database';
import { GameManager } from './game-manager';
import { Question } from '../../helper-scripts/types';
import { logger } from '../utils/logger';
import { createInfoEmbed, createRulesEmbed } from '../utils/formatters';
import { formatDateTime } from '../utils/datetime-parser';

interface ScheduledGameTimer {
  scheduledGame: ScheduledGame;
  reminderTimer?: NodeJS.Timeout;
  welcomeTimer?: NodeJS.Timeout;
  startTimer?: NodeJS.Timeout;
}

export class SchedulerService {
  private static instance: SchedulerService;
  private client: Client | null = null;
  private databaseService: DatabaseService;
  private gameManager: GameManager;
  private scheduledGames: Map<number, ScheduledGameTimer> = new Map();

  private constructor(databaseService: DatabaseService, gameManager: GameManager) {
    this.databaseService = databaseService;
    this.gameManager = gameManager;
  }

  static getInstance(databaseService: DatabaseService, gameManager: GameManager): SchedulerService {
    if (!SchedulerService.instance) {
      SchedulerService.instance = new SchedulerService(databaseService, gameManager);
    }
    return SchedulerService.instance;
  }

  /**
   * Initialize the scheduler with the Discord client and load scheduled games from database
   */
  async initialize(client: Client): Promise<void> {
    this.client = client;
    
    // Load all future scheduled games from database
    await this.loadScheduledGames();

    logger.info(`Scheduler service initialized with ${this.scheduledGames.size} scheduled game(s)`);
  }

  /**
   * Load scheduled games from database and set up timers
   */
  private async loadScheduledGames(): Promise<void> {
    try {
      const futureGames = await this.databaseService.getAllFutureScheduledGames();
      
      for (const scheduledGame of futureGames) {
        this.scheduleGame(scheduledGame);
      }

      logger.info(`Loaded ${futureGames.length} scheduled game(s) from database`);
    } catch (error) {
      logger.error('Error loading scheduled games from database:', error);
    }
  }

  /**
   * Schedule a game (set up timers for reminder and start)
   */
  scheduleGame(scheduledGame: ScheduledGame): void {
    const now = new Date();
    const startTime = scheduledGame.scheduledStartTime.getTime();
    const reminderTime = startTime - (15 * 60 * 1000); // 15 minutes before
    const nowTime = now.getTime();

    // Clear any existing timers for this game
    this.unscheduleGame(scheduledGame.scheduledGameId);

    const timer: ScheduledGameTimer = {
      scheduledGame
    };

    // Set up reminder timer if it hasn't passed and reminder hasn't been sent
    if (reminderTime > nowTime && !scheduledGame.reminderSent) {
      const reminderDelay = reminderTime - nowTime;
      timer.reminderTimer = setTimeout(() => {
        this.sendReminder(scheduledGame).catch(error => {
          logger.error(`Error sending reminder for scheduled game ${scheduledGame.scheduledGameId}:`, error);
        });
      }, reminderDelay);
      logger.debug(`Scheduled reminder for game ${scheduledGame.scheduledGameId} in ${Math.round(reminderDelay / 1000)} seconds`);
    }

    // Set up welcome message timer (60 seconds before start)
    const welcomeTime = startTime - (60 * 1000); // 60 seconds before
    if (welcomeTime > nowTime) {
      const welcomeDelay = welcomeTime - nowTime;
      timer.welcomeTimer = setTimeout(() => {
        this.sendWelcomeMessage(scheduledGame).catch(error => {
          logger.error(`Error sending welcome message for scheduled game ${scheduledGame.scheduledGameId}:`, error);
        });
      }, welcomeDelay);
      logger.debug(`Scheduled welcome message for game ${scheduledGame.scheduledGameId} in ${Math.round(welcomeDelay / 1000)} seconds`);
    }

    // Set up start timer if it hasn't passed
    if (startTime > nowTime) {
      const startDelay = startTime - nowTime;
      timer.startTimer = setTimeout(() => {
        this.startScheduledGame(scheduledGame).catch(error => {
          logger.error(`Error starting scheduled game ${scheduledGame.scheduledGameId}:`, error);
        });
      }, startDelay);
      logger.debug(`Scheduled game ${scheduledGame.scheduledGameId} to start in ${Math.round(startDelay / 1000)} seconds`);
    } else {
      // Game should have already started, start it immediately
      logger.warn(`Scheduled game ${scheduledGame.scheduledGameId} start time has passed, starting immediately`);
      this.startScheduledGame(scheduledGame).catch(error => {
        logger.error(`Error starting overdue scheduled game ${scheduledGame.scheduledGameId}:`, error);
      });
      return; // Don't store in memory since it's starting now
    }

    // Store in memory
    this.scheduledGames.set(scheduledGame.scheduledGameId, timer);
  }

  /**
   * Unschedule a game (clear timers and remove from memory)
   */
  unscheduleGame(scheduledGameId: number): void {
    const timer = this.scheduledGames.get(scheduledGameId);
    if (timer) {
      if (timer.reminderTimer) {
        clearTimeout(timer.reminderTimer);
      }
      if (timer.welcomeTimer) {
        clearTimeout(timer.welcomeTimer);
      }
      if (timer.startTimer) {
        clearTimeout(timer.startTimer);
      }
      this.scheduledGames.delete(scheduledGameId);
    }
  }

  /**
   * Stop the scheduler and clear all timers
   */
  stop(): void {
    for (const scheduledGameId of this.scheduledGames.keys()) {
      this.unscheduleGame(scheduledGameId);
    }
    logger.info('Scheduler service stopped');
  }

  /**
   * Start a scheduled game
   */
  private async startScheduledGame(scheduledGame: ScheduledGame): Promise<void> {
    if (!this.client) {
      throw new Error('Client not initialized');
    }

    // Remove from memory and clear timers
    this.unscheduleGame(scheduledGame.scheduledGameId);

    // Check if a game is already active
    if (this.gameManager.isGameActive()) {
      logger.warn(`Cannot start scheduled game ${scheduledGame.scheduledGameId} - game already active`);
      // Don't delete from database, might retry later
      return;
    }

    // Get the guild and channel
    const guild = await this.client.guilds.fetch(scheduledGame.guildId);
    if (!guild) {
      throw new Error(`Guild ${scheduledGame.guildId} not found`);
    }

    const channel = await guild.channels.fetch(scheduledGame.channelId);
    if (!channel || channel.type !== 0) { // 0 = GUILD_TEXT
      throw new Error(`Channel ${scheduledGame.channelId} not found or is not a text channel`);
    }

    const textChannel = channel as TextChannel;

    // Get the thread
    let thread: ThreadChannel | null = null;
    try {
      thread = await textChannel.threads.fetch(scheduledGame.threadId);
    } catch (error) {
      logger.error(`Thread ${scheduledGame.threadId} not found for scheduled game ${scheduledGame.scheduledGameId}`);
      throw new Error(`Thread ${scheduledGame.threadId} not found`);
    }

    if (!thread) {
      throw new Error(`Thread ${scheduledGame.threadId} not found`);
    }

    // Fetch questions from database
    const round1Questions: Question[] = [];
    const round2Questions: Question[] = [];
    let finalQuestion: Question | null = null;

    for (const questionId of scheduledGame.round1Questions) {
      const question = await this.databaseService.getQuestionById(questionId);
      if (question) {
        round1Questions.push(question);
      }
    }

    for (const questionId of scheduledGame.round2Questions) {
      const question = await this.databaseService.getQuestionById(questionId);
      if (question) {
        round2Questions.push(question);
      }
    }

    if (scheduledGame.finalQuestionId) {
      finalQuestion = await this.databaseService.getQuestionById(scheduledGame.finalQuestionId);
    }

    if (round1Questions.length < 10 || round2Questions.length < 10 || !finalQuestion) {
      throw new Error('Not enough questions available for scheduled game');
    }

    // Start the game using GameManager's internal method
    await this.gameManager.startScheduledGame(
      scheduledGame.guildId,
      scheduledGame.channelId,
      textChannel,
      thread,
      round1Questions,
      round2Questions,
      finalQuestion,
      scheduledGame.normalizedAnswers || new Map()
    );

    // Delete from database after successful start
    await this.databaseService.deleteScheduledGame(scheduledGame.scheduledGameId);
    logger.info(`Started scheduled game ${scheduledGame.scheduledGameId}`);
  }

  /**
   * Send a reminder 15 minutes before the game starts
   */
  private async sendReminder(scheduledGame: ScheduledGame): Promise<void> {
    if (!this.client) {
      throw new Error('Client not initialized');
    }

    // Mark reminder as sent in database
    try {
      await this.databaseService.markReminderSent(scheduledGame.scheduledGameId);
      // Update in-memory copy
      scheduledGame.reminderSent = true;
    } catch (error) {
      logger.error(`Error marking reminder as sent for game ${scheduledGame.scheduledGameId}:`, error);
    }

    // Get the guild and channel
    const guild = await this.client.guilds.fetch(scheduledGame.guildId);
    if (!guild) {
      throw new Error(`Guild ${scheduledGame.guildId} not found`);
    }

    const channel = await guild.channels.fetch(scheduledGame.channelId);
    if (!channel || channel.type !== 0) {
      throw new Error(`Channel ${scheduledGame.channelId} not found or is not a text channel`);
    }

    const textChannel = channel as TextChannel;

    const formattedTime = formatDateTime(scheduledGame.scheduledStartTime);
    const threadLink = `https://discord.com/channels/${scheduledGame.guildId}/${scheduledGame.threadId}`;
    const embed = createInfoEmbed(
      '⏰ Trivia Game Reminder',
      `Trivia game starting in **15 minutes**!\n\n**Start time:** ${formattedTime}\n\n**Join the thread:** ${threadLink}`
    );

    // Find and mention the trivia-nerds role
    const triviaNerdsRole = textChannel.guild.roles.cache.find(role => role.name === 'trivia-nerds');
    const roleMention = triviaNerdsRole ? `<@&${triviaNerdsRole.id}>` : '';

    // Post reminder to main channel
    await textChannel.send({ 
      content: roleMention ? `${roleMention} Trivia game starting in 15 minutes!` : undefined,
      embeds: [embed] 
    });

    logger.info(`Sent reminder for scheduled game ${scheduledGame.scheduledGameId}`);
  }

  /**
   * Send welcome message 60 seconds before the game starts
   */
  private async sendWelcomeMessage(scheduledGame: ScheduledGame): Promise<void> {
    if (!this.client) {
      throw new Error('Client not initialized');
    }

    // Get the guild and channel
    const guild = await this.client.guilds.fetch(scheduledGame.guildId);
    if (!guild) {
      throw new Error(`Guild ${scheduledGame.guildId} not found`);
    }

    const channel = await guild.channels.fetch(scheduledGame.channelId);
    if (!channel || channel.type !== 0) {
      throw new Error(`Channel ${scheduledGame.channelId} not found or is not a text channel`);
    }

    const textChannel = channel as TextChannel;

    // Get the thread
    let thread: ThreadChannel | null = null;
    try {
      thread = await textChannel.threads.fetch(scheduledGame.threadId);
    } catch (error) {
      logger.error(`Thread ${scheduledGame.threadId} not found for scheduled game ${scheduledGame.scheduledGameId}`);
      throw new Error(`Thread ${scheduledGame.threadId} not found`);
    }

    if (!thread) {
      throw new Error(`Thread ${scheduledGame.threadId} not found`);
    }

    const threadLink = `https://discord.com/channels/${scheduledGame.guildId}/${scheduledGame.threadId}`;
    
    // Find and mention the trivia-nerds role
    const triviaNerdsRole = textChannel.guild.roles.cache.find(role => role.name === 'trivia-nerds');
    const roleMention = triviaNerdsRole ? `<@&${triviaNerdsRole.id}>` : '';
    
    // Post welcome message to main channel (with "We'll begin in 60 seconds!")
    await textChannel.send({ 
      content: roleMention ? `${roleMention} Scheduled trivia is starting soon!` : undefined,
      embeds: [createRulesEmbed(threadLink)]
    });

    logger.info(`Sent welcome message for scheduled game ${scheduledGame.scheduledGameId}`);
  }

  /**
   * Get count of scheduled games
   */
  getScheduledGameCount(): number {
    return this.scheduledGames.size;
  }
}
