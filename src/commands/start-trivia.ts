import { ChatInputCommandInteraction, TextChannel, MessageFlags, GuildMember, PermissionFlagsBits, ThreadChannel, ModalSubmitInteraction, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, ComponentType, ButtonInteraction } from 'discord.js';
import { DatabaseService } from '../services/database';
import { GameManager } from '../services/game-manager';
import { SchedulerService } from '../services/scheduler';
import { createErrorEmbed, createSuccessEmbed, createRulesEmbed, createInfoEmbed } from '../utils/formatters';
import { logger } from '../utils/logger';
import { formatDateTime } from '../utils/datetime-parser';
import { LMStudioService } from '../services/lmstudio';
import { Question } from '../../helper-scripts/types';


/**
 * Handle modal submission for scheduling trivia
 */
export async function handleScheduleTriviaModal(
  interaction: ModalSubmitInteraction,
  databaseService: DatabaseService,
  gameManager: GameManager,
  schedulerService: SchedulerService
): Promise<void> {
  try {
    const dateInput = interaction.fields.getTextInputValue('schedule-date').trim();
    const timeInput = interaction.fields.getTextInputValue('schedule-time').trim();

    // Validate date format (YYYY-MM-DD)
    const dateMatch = dateInput.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!dateMatch) {
      await interaction.reply({
        embeds: [createErrorEmbed(
          'Invalid Date Format',
          '**Date must be in YYYY-MM-DD format**\n\n' +
          'Example: `2024-01-15` (January 15, 2024)\n' +
          'Please enter the date in the format shown above.'
        )],
        ephemeral: true
      });
      return;
    }

    const year = parseInt(dateMatch[1], 10);
    const month = parseInt(dateMatch[2], 10);
    const day = parseInt(dateMatch[3], 10);

    // Validate date values
    if (month < 1 || month > 12) {
      await interaction.reply({
        embeds: [createErrorEmbed(
          'Invalid Date',
          '**Month must be between 1 and 12**\n\n' +
          'Example: `2024-01-15` (January = 01)'
        )],
        ephemeral: true
      });
      return;
    }

    if (day < 1 || day > 31) {
      await interaction.reply({
        embeds: [createErrorEmbed(
          'Invalid Date',
          '**Day must be between 1 and 31**\n\n' +
          'Please check the day value in your date.'
        )],
        ephemeral: true
      });
      return;
    }

    // Validate time format (HH:MM)
    const timeMatch = timeInput.match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) {
      await interaction.reply({
        embeds: [createErrorEmbed(
          'Invalid Time Format',
          '**Time must be in HH:MM format (24-hour)**\n\n' +
          'Examples:\n' +
          '• `20:00` = 8:00 PM\n' +
          '• `14:30` = 2:30 PM\n' +
          '• `09:00` = 9:00 AM\n\n' +
          'Please use 24-hour format (00:00 to 23:59).'
        )],
        ephemeral: true
      });
      return;
    }

    const hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);

    if (hours < 0 || hours > 23) {
      await interaction.reply({
        embeds: [createErrorEmbed(
          'Invalid Time',
          '**Hours must be between 0 and 23**\n\n' +
          'Examples:\n' +
          '• `00:00` = Midnight\n' +
          '• `12:00` = Noon\n' +
          '• `20:00` = 8:00 PM\n' +
          '• `23:59` = 11:59 PM'
        )],
        ephemeral: true
      });
      return;
    }

    if (minutes < 0 || minutes > 59) {
      await interaction.reply({
        embeds: [createErrorEmbed(
          'Invalid Time',
          '**Minutes must be between 0 and 59**\n\n' +
          'Please check the minutes value in your time.'
        )],
        ephemeral: true
      });
      return;
    }

    // Create date object to validate it's a real date
    const scheduledDate = new Date(year, month - 1, day, hours, minutes, 0);
    
    // Check if date is valid (handles invalid dates like Feb 30)
    if (scheduledDate.getFullYear() !== year || 
        scheduledDate.getMonth() !== month - 1 || 
        scheduledDate.getDate() !== day) {
      await interaction.reply({
        embeds: [createErrorEmbed(
          'Invalid Date',
          '**This date does not exist**\n\n' +
          'Please check your date. Examples of invalid dates:\n' +
          '• February 30\n' +
          '• April 31\n' +
          '• Invalid leap year dates'
        )],
        ephemeral: true
      });
      return;
    }

    const now = new Date();
    
    // Check if scheduled time is in the future
    if (scheduledDate.getTime() <= now.getTime()) {
      await interaction.reply({
        embeds: [createErrorEmbed(
          'Invalid Scheduled Time',
          '**Scheduled time must be in the future**\n\n' +
          `Current time: ${formatDateTime(now)}\n` +
          `You entered: ${formatDateTime(scheduledDate)}\n\n` +
          'Please choose a date and time that is later than now.'
        )],
        ephemeral: true
      });
      return;
    }

    // Check if scheduled time is too far in the future (more than 365 days)
    const maxDays = 365;
    const maxTime = new Date(now.getTime() + maxDays * 24 * 60 * 60 * 1000);
    if (scheduledDate.getTime() > maxTime.getTime()) {
      await interaction.reply({
        embeds: [createErrorEmbed(
          'Scheduled Time Too Far',
          `**Scheduled time cannot be more than ${maxDays} days (1 year) in the future**\n\n` +
          `You can schedule games up to ${formatDateTime(maxTime)}.\n` +
          `You entered: ${formatDateTime(scheduledDate)}`
        )],
        ephemeral: true
      });
      return;
    }

    // Respond to modal immediately (Discord requires response within 3 seconds)
    const formattedTime = formatDateTime(scheduledDate);
    await interaction.reply({
      content: 'Trivia Scheduled!',
      embeds: [createSuccessEmbed(
        'Game Scheduled',
        `Trivia game scheduled for ${formattedTime}!\n\nProcessing questions and creating thread...`
      )],
      ephemeral: true
    });

    // Process the scheduled game in the background (don't await - let it run async)
    processScheduledGame(interaction, databaseService, gameManager, schedulerService, scheduledDate)
      .catch(error => {
        logger.error('Error processing scheduled game in background:', error);
        // Try to send a follow-up message if possible
        interaction.followUp({
          embeds: [createErrorEmbed(
            'Error Scheduling Game',
            'An error occurred while processing your scheduled game. Please try again or contact an administrator.'
          )],
          ephemeral: true
        }).catch(err => {
          logger.error('Failed to send error follow-up:', err);
        });
      });
  } catch (error: any) {
    logger.error('Error handling schedule modal:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        embeds: [createErrorEmbed('Error', 'An error occurred while processing your scheduled game.')],
        ephemeral: true
      });
    }
  }
}

/**
 * Process a scheduled game (shared logic)
 */
async function processScheduledGame(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  databaseService: DatabaseService,
  gameManager: GameManager,
  schedulerService: SchedulerService,
  scheduledTime: Date
): Promise<void> {
  const now = new Date();

  // Helper function to send error messages (use followUp if already replied)
  const sendError = async (title: string, message: string) => {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        embeds: [createErrorEmbed(title, message)],
        ephemeral: true
      });
    } else {
      await interaction.reply({
        embeds: [createErrorEmbed(title, message)],
        ephemeral: true
      });
    }
  };

  // Check if scheduled time is in the future
  if (scheduledTime.getTime() <= now.getTime()) {
    await sendError('Invalid Scheduled Time', 'Scheduled time must be in the future.');
    return;
  }

  // Check if scheduled time is too far in the future (more than 365 days)
  const maxDays = 365;
  const maxTime = new Date(now.getTime() + maxDays * 24 * 60 * 60 * 1000);
  if (scheduledTime.getTime() > maxTime.getTime()) {
    await sendError('Scheduled Time Too Far', `Scheduled time cannot be more than ${maxDays} days (1 year) in the future.`);
    return;
  }

  // Get guild config
  const config = await databaseService.getGuildConfig(interaction.guildId!);
  if (!config || !config.triviaChannelId) {
    await sendError('Trivia Channel Not Configured', 'Trivia channel not configured. Use `/config` to set it up.');
    return;
  }

  // Get the trivia channel
  const channel = await interaction.guild?.channels.fetch(config.triviaChannelId);
  if (!channel || channel.type !== 0) {
    await sendError('Channel Not Found', 'The configured trivia channel could not be found.');
    return;
  }

  const textChannel = channel as TextChannel;

  // Fetch questions and normalize them now
  const [round1Questions, round2Questions, finalQuestions] = await Promise.all([
    databaseService.getRandomQuestions('Jeopardy!', 10),
    databaseService.getRandomQuestions('Double Jeopardy!', 10),
    databaseService.getRandomQuestions('Final Jeopardy!', 1)
  ]);

  if (round1Questions.length < 10 || round2Questions.length < 10 || finalQuestions.length < 1) {
    await sendError('Not Enough Questions', 'Not enough questions available. Please ensure questions are scraped.');
    return;
  }

  const finalQuestion = finalQuestions[0];

  // Normalize answers in the background
  const lmStudioService = new LMStudioService();
  const normalizedAnswers = new Map<number, any>();
  
  // Load existing normalized answers
  const allQuestionIds = [
    ...round1Questions.map(q => q.id).filter((id): id is number => id !== undefined),
    ...round2Questions.map(q => q.id).filter((id): id is number => id !== undefined),
    finalQuestion.id
  ].filter((id): id is number => id !== undefined);

  const existingSpecs = await databaseService.getAnswerSpecs(allQuestionIds);
  for (const [questionId, spec] of existingSpecs) {
    normalizedAnswers.set(questionId, spec);
  }

  // Create thread immediately
  const formattedTime = formatDateTime(scheduledTime);
  const thread = await textChannel.threads.create({
    name: `Trivia ${formattedTime}`,
    autoArchiveDuration: 60,
    reason: 'Scheduled trivia game thread'
  });

  // Post initial message to thread
  const threadLink = `https://discord.com/channels/${interaction.guildId}/${thread.id}`;
  
  // Find and mention the trivia-nerds role
  const triviaNerdsRole = textChannel.guild.roles.cache.find(role => role.name === 'trivia-nerds');
  const roleMention = triviaNerdsRole ? `<@&${triviaNerdsRole.id}>` : '';
  
  await textChannel.send({
    content: roleMention ? `${roleMention} A trivia game has been scheduled!` : undefined,
    embeds: [createInfoEmbed(
      '📅 Trivia Game Scheduled',
      `A trivia game has been scheduled!\n\n**Start time:** ${formattedTime}\n\n**Join the thread:** ${threadLink}`
    )]
  });

  await thread.send({
    embeds: [createRulesEmbed(threadLink, scheduledTime)]
  });

  // Store scheduled game in database (with initial normalized answers - will be updated as more are normalized)
  const scheduledGameId = await databaseService.createScheduledGame(
    interaction.guildId!,
    config.triviaChannelId,
    thread.id,
    scheduledTime,
    round1Questions.map(q => q.id!).filter((id): id is number => id !== undefined),
    round2Questions.map(q => q.id!).filter((id): id is number => id !== undefined),
    finalQuestion.id!,
    normalizedAnswers,
    interaction.user.id
  );

  // Normalize remaining questions if LMStudio is running
  // For scheduled games, we normalize in the background so answers are ready when the game starts
  const lmStudioRunning = await lmStudioService.isServerRunning();
  if (lmStudioRunning) {
    // Normalize all questions that need it in the background (don't wait)
    const questionsToNormalize = [...round1Questions, ...round2Questions, finalQuestion].filter(
      q => q.id && !normalizedAnswers.has(q.id)
    );

    if (questionsToNormalize.length > 0) {
      logger.info(`Normalizing ${questionsToNormalize.length} answers for scheduled game ${scheduledGameId} in background...`);
      
      // Normalize in background - don't block
      (async () => {
        for (const question of questionsToNormalize) {
          if (question.id) {
            try {
              const spec = await lmStudioService.normalizeAnswer(
                question.question,
                question.answer,
                question.category ?? null
              );
              normalizedAnswers.set(question.id, spec);
              await databaseService.storeAnswerSpec(question.id, spec);
              logger.debug(`Normalized answer for question_id=${question.id}`);
            } catch (error) {
              logger.error(`Failed to normalize answer for question_id=${question.id}:`, error);
              // Continue with next question even if one fails
            }
          }
        }
        
        // Update the scheduled game with normalized answers once complete
        try {
          await databaseService.updateScheduledGameNormalizedAnswers(
            scheduledGameId,
            normalizedAnswers
          );
          logger.info(`Updated scheduled game ${scheduledGameId} with normalized answers`);
        } catch (error) {
          logger.error('Error updating scheduled game with normalized answers:', error);
        }
        
        logger.info(`Background normalization complete for scheduled game ${scheduledGameId}. ${normalizedAnswers.size} answers ready.`);
      })().catch(error => {
        logger.error('Error in background normalization for scheduled game:', error);
      });
    } else {
      logger.info('All answers already normalized for scheduled game');
    }
  } else {
    // LMStudio is not running - we'll use answers directly from the questions table
    const questionsNeedingNormalization = allQuestionIds.length - normalizedAnswers.size;
    if (questionsNeedingNormalization > 0) {
      logger.info(`LMStudio not running. ${questionsNeedingNormalization} questions will use answers directly from the questions table (no normalization).`);
    } else {
      logger.info(`LMStudio not running, but all answers already have normalized specs from previous runs.`);
    }
  }

  // Load the scheduled game from database and schedule it in memory
  const futureGames = await databaseService.getAllFutureScheduledGames();
  const newScheduledGame = futureGames.find(g => g.scheduledGameId === scheduledGameId);
  
  if (newScheduledGame) {
    // Schedule the game in memory
    schedulerService.scheduleGame(newScheduledGame);
  }

  // Only reply if this wasn't called from a modal (modals already replied)
  if (!interaction.isModalSubmit()) {
    await interaction.reply({
      embeds: [createSuccessEmbed(
        'Game Scheduled',
        `Trivia game scheduled for ${formattedTime}!\n\nThread created and questions prepared. A reminder will be sent 15 minutes before the game starts.`
      )],
      ephemeral: true
    });
  } else {
    // For modal submissions, update the initial reply with final success message
    // Also try to update the original button message if we can access it
    try {
      await interaction.editReply({
        content: 'Trivia Scheduled!',
        embeds: [createSuccessEmbed(
          'Game Scheduled',
          `Trivia game scheduled for ${formattedTime}!\n\nThread created and questions prepared. A reminder will be sent 15 minutes before the game starts.`
        )]
      });
    } catch (error) {
      // If edit fails, try followUp instead
      logger.warn('Failed to edit modal reply, using followUp instead:', error);
      await interaction.followUp({
        content: 'Trivia Scheduled!',
        embeds: [createSuccessEmbed(
          'Game Scheduled',
          `Trivia game scheduled for ${formattedTime}!\n\nThread created and questions prepared. A reminder will be sent 15 minutes before the game starts.`
        )],
        ephemeral: true
      });
    }
  }

  logger.info(`Scheduled game created by ${interaction.user.tag} in guild ${interaction.guildId} for ${formattedTime}`);
}

/**
 * Start a trivia game immediately (called from button click)
 */
export async function handleStartNowButton(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction | ButtonInteraction,
  databaseService: DatabaseService,
  gameManager: GameManager
): Promise<void> {
  try {
    // Check if channel is configured
    const config = await databaseService.getGuildConfig(interaction.guildId!);
    if (!config || !config.triviaChannelId) {
      await interaction.reply({
        embeds: [createErrorEmbed(
          'Trivia Channel Not Configured',
          'Trivia channel not configured. Use `/config` to set it up.'
        )],
        ephemeral: true
      });
      return;
    }

    // Check if user has required role (if configured)
    if (config.requiredRoleId) {
      let member: GuildMember | null = null;
      
      // Get member from interaction or fetch it
      if (interaction.member instanceof GuildMember) {
        member = interaction.member;
      } else if (interaction.member && 'roles' in interaction.member) {
        // APIInteractionGuildMember - fetch the full GuildMember
        member = await interaction.guild?.members.fetch(interaction.user.id) || null;
      } else if (!interaction.member) {
        // Member not available, fetch it
        member = await interaction.guild?.members.fetch(interaction.user.id) || null;
      }
      
      // Check if member has the required role
      if (!member || !member.roles.cache.has(config.requiredRoleId)) {
        let roleName = 'required';
        try {
          const role = await interaction.guild?.roles.fetch(config.requiredRoleId);
          if (role) {
            roleName = role.name;
          }
        } catch (error) {
          logger.warn(`Could not fetch role ${config.requiredRoleId} for permission check:`, error);
        }
        
        await interaction.reply({
          embeds: [createErrorEmbed(
            'Permission Denied',
            `You need the ${roleName} role to start trivia games.`
          )],
          ephemeral: true
        });
        return;
      }
    }

    // Check if game is already active
    if (gameManager.isGameActive()) {
      const gameState = gameManager.getGameStateForGuild(interaction.guildId!);
      if (gameState) {
        await interaction.reply({
          embeds: [createErrorEmbed(
            'Game Already in Progress',
            'A trivia game is already in progress. Please wait for it to finish.'
          )],
          ephemeral: true
        });
        return;
      }
    }

    // Get the trivia channel
    const channel = await interaction.guild?.channels.fetch(config.triviaChannelId);
    if (!channel || channel.type !== 0) { // 0 = GUILD_TEXT
      await interaction.reply({
        embeds: [createErrorEmbed(
          'Channel Not Found',
          'The configured trivia channel could not be found.'
        )],
        ephemeral: true
      });
      return;
    }

    // Check bot permissions
    const requiredPermissions = [
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.SendMessagesInThreads,
      PermissionFlagsBits.ManageThreads
    ];
    if (!channel.permissionsFor(interaction.client.user!)?.has(requiredPermissions)) {
      await interaction.reply({
        embeds: [createErrorEmbed(
          'Insufficient Permissions',
          'Bot lacks required permissions. Please ensure the bot has: Send Messages, Embed Links, Create Public Threads, Send Messages in Threads, and Manage Threads and Posts.'
        )],
        ephemeral: true
      });
      return;
    }

    // Update to show simple message and remove buttons if it's a button interaction
    if (interaction.isButton()) {
      try {
        await interaction.update({
          content: 'Game Starting!',
          embeds: [],
          components: []
        });
      } catch (error) {
        logger.error('Failed to update button interaction:', error);
        // If update fails, try to reply instead
        await interaction.reply({
          content: 'Game Starting!',
          ephemeral: true
        });
      }
    } else {
      await interaction.reply({
        embeds: [createInfoEmbed(
          'Starting Game',
          '**Starting game now...**\n\nRules will be posted in the trivia channel.'
        )],
        ephemeral: true
      });
    }

    // Start the game (this will post rules and wait 60 seconds before first question)
    await gameManager.startGame(interaction.guildId!, config.triviaChannelId, channel as TextChannel);

    logger.info(`Game started by ${interaction.user.tag} in guild ${interaction.guildId}`);
  } catch (error: any) {
    logger.error('Error starting trivia game:', error);
    
    let errorMessage = 'Failed to start trivia game. Please try again.';
    if (error.message === 'A trivia game is already in progress') {
      errorMessage = error.message;
    } else if (error.message === 'Not enough questions available in database') {
      errorMessage = 'Not enough questions available. Please ensure questions are scraped.';
    }

    // Only show error if we haven't already replied
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        embeds: [createErrorEmbed('Failed to Start Game', errorMessage)],
        ephemeral: true
      });
    } else if (interaction.isButton()) {
      await interaction.followUp({
        embeds: [createErrorEmbed('Failed to Start Game', errorMessage)],
        ephemeral: true
      });
    }
  }
}

/**
 * Create a modal for scheduling trivia with helpful guidance
 */
export function createScheduleTriviaModal(): ModalBuilder {
  const now = new Date();
  // Default to 1 hour from now in local timezone
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
  
  // Format: YYYY-MM-DD (local timezone)
  const year = oneHourFromNow.getFullYear();
  const month = String(oneHourFromNow.getMonth() + 1).padStart(2, '0');
  const day = String(oneHourFromNow.getDate()).padStart(2, '0');
  const defaultDate = `${year}-${month}-${day}`;
  
  // Format: HH:MM (24-hour, local timezone)
  const hours = String(oneHourFromNow.getHours()).padStart(2, '0');
  const minutes = String(oneHourFromNow.getMinutes()).padStart(2, '0');
  const defaultTime = `${hours}:${minutes}`;

  // Calculate max date (365 days from now)
  const maxDate = new Date(now);
  maxDate.setDate(maxDate.getDate() + 365);
  const maxDateStr = maxDate.toISOString().split('T')[0];

  return new ModalBuilder()
    .setCustomId('schedule-trivia-modal')
    .setTitle('Schedule Trivia Game')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>()
        .addComponents(
          new TextInputBuilder()
            .setCustomId('schedule-date')
            .setLabel('Date (YYYY-MM-DD)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(`Example: ${defaultDate} (between today and ${maxDateStr})`)
            .setValue(defaultDate)
            .setRequired(true)
            .setMinLength(10)
            .setMaxLength(10)
        ),
      new ActionRowBuilder<TextInputBuilder>()
        .addComponents(
          new TextInputBuilder()
            .setCustomId('schedule-time')
            .setLabel('Time (HH:MM, 24-hour format)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Example: 20:00 (8:00 PM) or 14:30 (2:30 PM)')
            .setValue(defaultTime)
            .setRequired(true)
            .setMinLength(5)
            .setMaxLength(5)
        )
    );
}

export async function handleStartTriviaCommand(
  interaction: ChatInputCommandInteraction,
  databaseService: DatabaseService,
  gameManager: GameManager,
  schedulerService: SchedulerService
) {
  try {
    // Check if channel is configured
    const config = await databaseService.getGuildConfig(interaction.guildId!);
    if (!config || !config.triviaChannelId) {
      await interaction.reply({
        embeds: [createErrorEmbed(
          'Trivia Channel Not Configured',
          'Trivia channel not configured. Use `/config` to set it up.'
        )],
        ephemeral: true
      });
      return;
    }

    // Check if user has required role (if configured)
    if (config.requiredRoleId) {
      let member: GuildMember | null = null;
      
      // Get member from interaction or fetch it
      if (interaction.member instanceof GuildMember) {
        member = interaction.member;
      } else if (interaction.member && 'roles' in interaction.member) {
        // APIInteractionGuildMember - fetch the full GuildMember
        member = await interaction.guild?.members.fetch(interaction.user.id) || null;
      } else if (!interaction.member) {
        // Member not available, fetch it
        member = await interaction.guild?.members.fetch(interaction.user.id) || null;
      }
      
      // Check if member has the required role
      if (!member || !member.roles.cache.has(config.requiredRoleId)) {
        let roleName = 'required';
        try {
          const role = await interaction.guild?.roles.fetch(config.requiredRoleId);
          if (role) {
            roleName = role.name;
          }
        } catch (error) {
          logger.warn(`Could not fetch role ${config.requiredRoleId} for permission check:`, error);
        }
        
        await interaction.reply({
          embeds: [createErrorEmbed(
            'Permission Denied',
            `You need the ${roleName} role to start trivia games.`
          )],
          ephemeral: true
        });
        return;
      }
    }

    // Check if game is already active
    if (gameManager.isGameActive()) {
      const gameState = gameManager.getGameStateForGuild(interaction.guildId!);
      if (gameState) {
        await interaction.reply({
          embeds: [createErrorEmbed(
            'Game Already in Progress',
            'A trivia game is already in progress. Please wait for it to finish.'
          )],
          ephemeral: true
        });
        return;
      }
    }

    // Get the trivia channel
    const channel = await interaction.guild?.channels.fetch(config.triviaChannelId);
    if (!channel || channel.type !== 0) { // 0 = GUILD_TEXT
      await interaction.reply({
        embeds: [createErrorEmbed(
          'Channel Not Found',
          'The configured trivia channel could not be found.'
        )],
        ephemeral: true
      });
      return;
    }

    // Check bot permissions
    const requiredPermissions = [
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.SendMessagesInThreads,
      PermissionFlagsBits.ManageThreads
    ];
    if (!channel.permissionsFor(interaction.client.user!)?.has(requiredPermissions)) {
      await interaction.reply({
        embeds: [createErrorEmbed(
          'Insufficient Permissions',
          'Bot lacks required permissions. Please ensure the bot has: Send Messages, Embed Links, Create Public Threads, Send Messages in Threads, and Manage Threads and Posts.'
        )],
        ephemeral: true
      });
      return;
    }

    // Show buttons for user to choose
    const startNowButton = new ButtonBuilder()
      .setCustomId('start-now-button')
      .setLabel('Start Now')
      .setStyle(ButtonStyle.Success)
      .setEmoji('▶️');

    const scheduleButton = new ButtonBuilder()
      .setCustomId('schedule-trivia-button')
      .setLabel('Schedule for Later')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📅');

    await interaction.reply({
      embeds: [createInfoEmbed(
        'Start Trivia Game',
        '**Choose an option:**\n\n' +
        '• **Start Now** - Begin the game immediately\n' +
        '• **Schedule for Later** - Pick a date and time (up to 365 days in the future)'
      )],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(startNowButton, scheduleButton)
      ],
      ephemeral: true
    });
  } catch (error: any) {
    logger.error('Error starting trivia game:', error);
    
    let errorMessage = 'Failed to start trivia game. Please try again.';
    if (error.message === 'A trivia game is already in progress') {
      errorMessage = error.message;
    } else if (error.message === 'Not enough questions available in database') {
      errorMessage = 'Not enough questions available. Please ensure questions are scraped.';
    }

    // Only show error if we haven't already replied
    if (!interaction.replied) {
      await interaction.reply({
        embeds: [createErrorEmbed('Failed to Start Game', errorMessage)],
        ephemeral: true
      });
    }
  }
}
