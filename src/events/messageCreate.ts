import { Message } from 'discord.js';
import { GameManager } from '../services/game-manager';
import { logger } from '../utils/logger';

export async function handleMessage(message: Message, gameManager: GameManager) {
  // Only process messages during active games
  if (!gameManager.isGameActive()) {
    return;
  }

  // Ignore bot messages
  if (message.author.bot) {
    return;
  }

  try {
    await gameManager.handleMessage(message);
  } catch (error) {
    logger.error('Error handling message:', error);
  }
}
