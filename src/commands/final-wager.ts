import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { GameManager } from '../services/game-manager';
import { createErrorEmbed, createSuccessEmbed, formatCurrency } from '../utils/formatters';
import { logger } from '../utils/logger';

export async function handleFinalWagerCommand(
  interaction: ChatInputCommandInteraction,
  gameManager: GameManager
) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const amount = interaction.options.getInteger('amount', true);

    gameManager.placeFinalWager(interaction.user.id, interaction.user.username, amount);

    const gameState = gameManager.getGameState();
    if (!gameState) {
      throw new Error('Game state not found');
    }

    const player = gameState.players.get(interaction.user.id);
    if (!player) {
      throw new Error('Player not found');
    }

    const currentScore = player.score;
    const ifCorrect = currentScore + amount;
    const ifIncorrect = currentScore - amount;

    await interaction.editReply({
      embeds: [createSuccessEmbed(
        'Wager Placed',
        `✅ Wager placed: ${formatCurrency(amount)}\n\n` +
        `Your current score: ${formatCurrency(currentScore)}\n` +
        `If correct: ${formatCurrency(ifCorrect)}\n` +
        `If incorrect: ${formatCurrency(ifIncorrect)}`
      )]
    });
  } catch (error: any) {
    logger.error('Error placing final wager:', error);
    
    let errorMessage = 'Failed to place wager. Please try again.';
    if (error.message.includes('not active')) {
      errorMessage = 'Wagering phase is not active.';
    } else if (error.message.includes('already placed')) {
      errorMessage = 'You have already placed your wager.';
    } else if (error.message.includes('Invalid wager')) {
      errorMessage = error.message;
    } else if (error.message.includes('No active game')) {
      errorMessage = 'No active trivia game.';
    }

    await interaction.editReply({
      embeds: [createErrorEmbed('Wager Failed', errorMessage)]
    });
  }
}
