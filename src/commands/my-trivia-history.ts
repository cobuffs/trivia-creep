import { ChatInputCommandInteraction } from 'discord.js';
import { DatabaseService } from '../services/database';
import { createPlayerHistoryEmbed, createInfoEmbed, createErrorEmbed } from '../utils/formatters';
import { logger } from '../utils/logger';

export async function handleMyTriviaHistoryCommand(
  interaction: ChatInputCommandInteraction,
  databaseService: DatabaseService
) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const stats = await databaseService.getPlayerStatistics(userId);

    if (!stats) {
      await interaction.editReply({
        embeds: [createInfoEmbed(
          'No History',
          'You haven\'t played any trivia games yet.'
        )]
      });
      return;
    }

    // Get games count for this month and year
    const [gamesThisMonth, gamesThisYear] = await Promise.all([
      databaseService.getPlayerGamesCount(userId, 'month'),
      databaseService.getPlayerGamesCount(userId, 'year')
    ]);

    const averageScore = stats.totalGames > 0 
      ? Math.round(stats.totalScoreAllTime / stats.totalGames) 
      : 0;

    const embed = createPlayerHistoryEmbed(
      stats.totalGames,
      stats.totalScoreAllTime,
      stats.bestScore,
      averageScore,
      gamesThisMonth,
      gamesThisYear
    );

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    logger.error('Error getting player history:', error);
    await interaction.editReply({
      embeds: [createErrorEmbed(
        'Failed to Load History',
        'Failed to load your history. Please try again.'
      )]
    });
  }
}
