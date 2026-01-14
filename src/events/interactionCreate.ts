import { Interaction, MessageFlags } from 'discord.js';
import { DatabaseService } from '../services/database';
import { GameManager } from '../services/game-manager';
import { SchedulerService } from '../services/scheduler';
import { logger } from '../utils/logger';
import { createInfoEmbed } from '../utils/formatters';
import { handleConfigCommand } from '../commands/config';
import { handleStartTriviaCommand, handleScheduleTriviaModal, createScheduleTriviaModal, handleStartNowButton, storeButtonInteraction } from '../commands/start-trivia';
import { handleEndTriviaCommand } from '../commands/end-trivia';
import { handleLeaderboardCommand } from '../commands/leaderboard';
import { handleMyTriviaHistoryCommand } from '../commands/my-trivia-history';
import { handleFinalWagerCommand } from '../commands/final-wager';
import { handleFinalGuessCommand } from '../commands/final-guess';

export async function handleInteraction(
  interaction: Interaction,
  databaseService: DatabaseService,
  gameManager: GameManager,
  schedulerService: SchedulerService
) {
  // Handle autocomplete interactions
  if (interaction.isAutocomplete()) {
    // No autocomplete needed for start-trivia anymore
    return;
  }

  // Handle button interactions
  if (interaction.isButton()) {
    if (interaction.customId === 'schedule-trivia-button') {
      // The webhook info should already be stored when the command was executed
      // Just show the modal
      const modal = createScheduleTriviaModal();
      await interaction.showModal(modal);
      return;
    }
    if (interaction.customId === 'start-now-button') {
      await handleStartNowButton(interaction, databaseService, gameManager);
      return;
    }
    return;
  }

  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'schedule-trivia-modal') {
      await handleScheduleTriviaModal(interaction, databaseService, gameManager, schedulerService);
      return;
    }
    return;
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

  const { commandName } = interaction;

  try {
    switch (commandName) {
      case 'config':
        await handleConfigCommand(interaction, databaseService);
        break;
      case 'start-trivia':
        await handleStartTriviaCommand(interaction, databaseService, gameManager, schedulerService);
        break;
      case 'end-trivia':
        await handleEndTriviaCommand(interaction, gameManager);
        break;
      case 'leaderboard':
        await handleLeaderboardCommand(interaction, databaseService);
        break;
      case 'my-trivia-history':
        await handleMyTriviaHistoryCommand(interaction, databaseService);
        break;
      case 'final-wager':
        await handleFinalWagerCommand(interaction, gameManager);
        break;
      case 'final-guess':
        await handleFinalGuessCommand(interaction, gameManager);
        break;
      default:
        logger.warn(`Unknown command: ${commandName}`);
        await interaction.reply({ content: 'Unknown command.', flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    logger.error(`Error handling command ${commandName}:`, error);
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ 
        content: 'An error occurred while processing your command.', 
        flags: MessageFlags.Ephemeral 
      });
    } else {
      await interaction.reply({ 
        content: 'An error occurred while processing your command.', 
        flags: MessageFlags.Ephemeral 
      });
    }
  }
}
