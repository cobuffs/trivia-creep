import { ChatInputCommandInteraction } from 'discord.js';
import { DatabaseService } from '../services/database';
import { createHistoricalLeaderboardEmbed, createErrorEmbed, createInfoEmbed } from '../utils/formatters';
import { logger } from '../utils/logger';

export async function handleLeaderboardCommand(
  interaction: ChatInputCommandInteraction,
  databaseService: DatabaseService
) {
  await interaction.deferReply();

  try {
    const timeframe = (interaction.options.getString('timeframe') || 'all-time') as 'all-time' | 'month' | 'year';

    if (!['all-time', 'month', 'year'].includes(timeframe)) {
      await interaction.editReply({
        embeds: [createErrorEmbed(
          'Invalid Timeframe',
          'Invalid timeframe. Use: all-time, month, or year.'
        )]
      });
      return;
    }

    const entries = await databaseService.getLeaderboard(timeframe, 10);

    if (entries.length === 0) {
      await interaction.editReply({
        embeds: [createInfoEmbed(
          'No Games Played',
          `No games have been played ${timeframe === 'all-time' ? 'yet' : `this ${timeframe}`}.`
        )]
      });
      return;
    }

    const embed = createHistoricalLeaderboardEmbed(entries, timeframe);
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    logger.error('Error getting leaderboard:', error);
    await interaction.editReply({
      embeds: [createErrorEmbed(
        'Failed to Load Leaderboard',
        'Failed to load leaderboard. Please try again.'
      )]
    });
  }
}
