import { ChatInputCommandInteraction } from 'discord.js';
import { DatabaseService } from '../services/database';
import { GameManager } from '../services/game-manager';
import { createErrorEmbed, createSuccessEmbed } from '../utils/formatters';
import { logger } from '../utils/logger';

export async function handleStartTriviaCommand(
  interaction: ChatInputCommandInteraction,
  databaseService: DatabaseService,
  gameManager: GameManager
) {
  await interaction.deferReply();

  try {
    // Check if channel is configured
    const config = await databaseService.getGuildConfig(interaction.guildId!);
    if (!config || !config.triviaChannelId) {
      await interaction.editReply({
        embeds: [createErrorEmbed(
          'Trivia Channel Not Configured',
          'Trivia channel not configured. Use `/config` to set it up.'
        )]
      });
      return;
    }

    // Check if game is already active
    if (gameManager.isGameActive()) {
      const gameState = gameManager.getGameStateForGuild(interaction.guildId!);
      if (gameState) {
        await interaction.editReply({
          embeds: [createErrorEmbed(
            'Game Already in Progress',
            'A trivia game is already in progress. Please wait for it to finish.'
          )]
        });
        return;
      }
    }

    // Get the trivia channel
    const channel = await interaction.guild?.channels.fetch(config.triviaChannelId);
    if (!channel || channel.type !== 0) { // 0 = GUILD_TEXT
      await interaction.editReply({
        embeds: [createErrorEmbed(
          'Channel Not Found',
          'The configured trivia channel could not be found.'
        )]
      });
      return;
    }

    // Check bot permissions
    if (!channel.permissionsFor(interaction.client.user!)?.has(['SendMessages', 'EmbedLinks'])) {
      await interaction.editReply({
        embeds: [createErrorEmbed(
          'Insufficient Permissions',
          'Bot lacks permissions to post messages in the configured channel.'
        )]
      });
      return;
    }

    // Start the game
    await gameManager.startGame(interaction.guildId!, config.triviaChannelId, channel);

    await interaction.editReply({
      embeds: [createSuccessEmbed(
        'Game Started',
        `🎮 Starting new trivia game!\nRules posted in ${channel}`
      )]
    });

    logger.info(`Game started by ${interaction.user.tag} in guild ${interaction.guildId}`);
  } catch (error: any) {
    logger.error('Error starting trivia game:', error);
    
    let errorMessage = 'Failed to start trivia game. Please try again.';
    if (error.message === 'A trivia game is already in progress') {
      errorMessage = error.message;
    } else if (error.message === 'Not enough questions available in database') {
      errorMessage = 'Not enough questions available. Please ensure questions are scraped.';
    }

    await interaction.editReply({
      embeds: [createErrorEmbed('Failed to Start Game', errorMessage)]
    });
  }
}
