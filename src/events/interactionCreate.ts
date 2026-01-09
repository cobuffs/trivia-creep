import { Interaction } from 'discord.js';
import { DatabaseService } from '../services/database';
import { GameManager } from '../services/game-manager';
import { logger } from '../utils/logger';
import { handleConfigCommand } from '../commands/config';
import { handleStartTriviaCommand } from '../commands/start-trivia';
import { handleEndTriviaCommand } from '../commands/end-trivia';
import { handleLeaderboardCommand } from '../commands/leaderboard';
import { handleMyTriviaHistoryCommand } from '../commands/my-trivia-history';
import { handleFinalWagerCommand } from '../commands/final-wager';
import { handleFinalGuessCommand } from '../commands/final-guess';

export async function handleInteraction(
  interaction: Interaction,
  databaseService: DatabaseService,
  gameManager: GameManager
) {
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
        await handleStartTriviaCommand(interaction, databaseService, gameManager);
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
        await interaction.reply({ content: 'Unknown command.', ephemeral: true });
    }
  } catch (error) {
    logger.error(`Error handling command ${commandName}:`, error);
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ 
        content: 'An error occurred while processing your command.', 
        ephemeral: true 
      });
    } else {
      await interaction.reply({ 
        content: 'An error occurred while processing your command.', 
        ephemeral: true 
      });
    }
  }
}
