import { ChatInputCommandInteraction, PermissionFlagsBits, TextChannel, MessageFlags } from 'discord.js';
import { DatabaseService } from '../services/database';
import { createSuccessEmbed, createErrorEmbed, createBotOverviewEmbed } from '../utils/formatters';
import { logger } from '../utils/logger';

export async function handleConfigCommand(
  interaction: ChatInputCommandInteraction,
  databaseService: DatabaseService
) {
  // Check permissions
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      embeds: [createErrorEmbed(
        'Permission Denied',
        'You don\'t have permission to configure the trivia channel.'
      )],
      ephemeral: true
    });
    return;
  }

  const channel = interaction.options.getChannel('channel', true);

  if (!channel || channel.type !== 0) { // 0 = GUILD_TEXT
    await interaction.reply({
      embeds: [createErrorEmbed(
        'Invalid Channel',
        'Invalid channel specified. Please select a text channel.'
      )],
      ephemeral: true
    });
    return;
  }

  try {
    await databaseService.setGuildConfig(interaction.guildId!, channel.id);

    await interaction.reply({
      embeds: [createSuccessEmbed(
        'Trivia Channel Configured',
        `Trivia channel configured: ${channel}\nAll trivia games will be played in this channel.`
      )]
    });

    logger.info(`Guild ${interaction.guildId} configured trivia channel: ${channel.id}`);

    // Post bot overview to the configured channel
    try {
      const textChannel = channel as TextChannel;
      if (textChannel && textChannel.isTextBased() && 'send' in textChannel) {
        await textChannel.send({
          embeds: [createBotOverviewEmbed()],
          flags: MessageFlags.SuppressNotifications
        });
        logger.info(`Posted bot overview to channel ${channel.id} in guild ${interaction.guildId}`);
      }
    } catch (overviewError) {
      logger.error('Error posting bot overview to channel:', overviewError);
      // Don't fail the config command if overview posting fails
    }
  } catch (error) {
    logger.error('Error setting guild config:', error);
    await interaction.reply({
      embeds: [createErrorEmbed(
        'Configuration Failed',
        'Failed to save configuration. Please try again.'
      )],
      ephemeral: true
    });
  }
}
