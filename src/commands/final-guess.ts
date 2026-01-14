import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { GameManager } from '../services/game-manager';
import { createErrorEmbed, createSuccessEmbed, formatCurrency } from '../utils/formatters';
import { logger } from '../utils/logger';

export async function handleFinalGuessCommand(
  interaction: ChatInputCommandInteraction,
  gameManager: GameManager
) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const answer = interaction.options.getString('answer', true);

    if (!answer || answer.trim().length === 0) {
      await interaction.editReply({
        embeds: [createErrorEmbed(
          'Invalid Answer',
          'Answer cannot be empty.'
        )]
      });
      return;
    }

    gameManager.submitFinalAnswer(interaction.user.id, interaction.user.username, answer.trim());

    const gameState = gameManager.getGameState();
    if (!gameState) {
      throw new Error('Game state not found');
    }

    const player = gameState.players.get(interaction.user.id);
    if (!player || player.finalWager === undefined) {
      throw new Error('Player or wager not found');
    }

    await interaction.editReply({
      embeds: [createSuccessEmbed(
        'Answer Submitted',
        `✅ Answer submitted: "${answer.trim()}"\n\n` +
        `Your wager: ${formatCurrency(player.finalWager)}\n` +
        `Results will be revealed after the answering phase ends.`
      )]
    });
  } catch (error: any) {
    logger.error('Error submitting final guess:', error);
    
    let errorMessage = 'Failed to submit answer. Please try again.';
    if (error.message.includes('not active')) {
      errorMessage = 'Answering phase is not active.';
    } else if (error.message.includes('must place a wager')) {
      errorMessage = 'You must place a wager first using `/final-wager`.';
    } else if (error.message.includes('already submitted')) {
      errorMessage = 'You have already submitted your answer.';
    } else if (error.message.includes('No active game')) {
      errorMessage = 'No active trivia game.';
    }

    await interaction.editReply({
      embeds: [createErrorEmbed('Submission Failed', errorMessage)]
    });
  }
}
