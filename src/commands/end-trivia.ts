import { ChatInputCommandInteraction, PermissionFlagsBits, MessageFlags, TextChannel } from 'discord.js';
import { GameManager } from '../services/game-manager';
import { createErrorEmbed, createSuccessEmbed } from '../utils/formatters';
import { logger } from '../utils/logger';

export async function handleEndTriviaCommand(
  interaction: ChatInputCommandInteraction,
  gameManager: GameManager
) {
  // Check permissions
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      embeds: [createErrorEmbed(
        'Permission Denied',
        'You don\'t have permission to end trivia games.'
      )],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  // Check if game is active
  const gameState = gameManager.getGameStateForGuild(interaction.guildId!);
  if (!gameState) {
    await interaction.reply({
      embeds: [createErrorEmbed(
        'No Active Game',
        'No active trivia game to end.'
      )],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  try {
    await gameManager.endGameEarly();

    // Send ephemeral reply to user
    await interaction.reply({
      embeds: [createSuccessEmbed(
        'Game Ended',
        `🛑 Trivia game ended early by @${interaction.user.username}\n\nFinal leaderboard posted in channel.\n\nGame has been archived.`
      )],
      flags: MessageFlags.Ephemeral
    });

    logger.info(`Game ended early by ${interaction.user.tag} in guild ${interaction.guildId}`);
  } catch (error) {
    logger.error('Error ending trivia game:', error);
    await interaction.reply({
      embeds: [createErrorEmbed(
        'Failed to End Game',
        'An error occurred while ending the game.'
      )],
      flags: MessageFlags.Ephemeral
    });
  }
}
