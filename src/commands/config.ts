import { ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { DatabaseService } from '../services/database';
import { createSuccessEmbed, createErrorEmbed } from '../utils/formatters';
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
