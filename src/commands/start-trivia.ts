import { ChatInputCommandInteraction, TextChannel, MessageFlags, GuildMember, PermissionFlagsBits } from 'discord.js';
import { DatabaseService } from '../services/database';
import { GameManager } from '../services/game-manager';
import { createErrorEmbed, createSuccessEmbed } from '../utils/formatters';
import { logger } from '../utils/logger';

export async function handleStartTriviaCommand(
  interaction: ChatInputCommandInteraction,
  databaseService: DatabaseService,
  gameManager: GameManager
) {
  try {
    // Check if channel is configured
    const config = await databaseService.getGuildConfig(interaction.guildId!);
    if (!config || !config.triviaChannelId) {
      await interaction.reply({
        embeds: [createErrorEmbed(
          'Trivia Channel Not Configured',
          'Trivia channel not configured. Use `/config` to set it up.'
        )],
        ephemeral: true
      });
      return;
    }

    // Check if user has required role (if configured)
    if (config.requiredRoleId) {
      let member: GuildMember | null = null;
      
      // Get member from interaction or fetch it
      if (interaction.member instanceof GuildMember) {
        member = interaction.member;
      } else if (interaction.member && 'roles' in interaction.member) {
        // APIInteractionGuildMember - fetch the full GuildMember
        member = await interaction.guild?.members.fetch(interaction.user.id) || null;
      } else if (!interaction.member) {
        // Member not available, fetch it
        member = await interaction.guild?.members.fetch(interaction.user.id) || null;
      }
      
      // Check if member has the required role
      if (!member || !member.roles.cache.has(config.requiredRoleId)) {
        let roleName = 'required';
        try {
          const role = await interaction.guild?.roles.fetch(config.requiredRoleId);
          if (role) {
            roleName = role.name;
          }
        } catch (error) {
          logger.warn(`Could not fetch role ${config.requiredRoleId} for permission check:`, error);
        }
        
        await interaction.reply({
          embeds: [createErrorEmbed(
            'Permission Denied',
            `You need the ${roleName} role to start trivia games.`
          )],
          ephemeral: true
        });
        return;
      }
    }

    // Check if game is already active
    if (gameManager.isGameActive()) {
      const gameState = gameManager.getGameStateForGuild(interaction.guildId!);
      if (gameState) {
        await interaction.reply({
          embeds: [createErrorEmbed(
            'Game Already in Progress',
            'A trivia game is already in progress. Please wait for it to finish.'
          )],
          ephemeral: true
        });
        return;
      }
    }

    // Get the trivia channel
    const channel = await interaction.guild?.channels.fetch(config.triviaChannelId);
    if (!channel || channel.type !== 0) { // 0 = GUILD_TEXT
      await interaction.reply({
        embeds: [createErrorEmbed(
          'Channel Not Found',
          'The configured trivia channel could not be found.'
        )],
        ephemeral: true
      });
      return;
    }

    // Check bot permissions
    const requiredPermissions = [
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.SendMessagesInThreads,
      PermissionFlagsBits.ManageThreads
    ];
    if (!channel.permissionsFor(interaction.client.user!)?.has(requiredPermissions)) {
      await interaction.reply({
        embeds: [createErrorEmbed(
          'Insufficient Permissions',
          'Bot lacks required permissions. Please ensure the bot has: Send Messages, Embed Links, Create Public Threads, Send Messages in Threads, and Manage Threads and Posts.'
        )],
        ephemeral: true
      });
      return;
    }

    // Reply with success message to user (ephemeral, only they see it)
    await interaction.reply({
      embeds: [createSuccessEmbed(
        'Game Started',
        'Trivia game is starting! Rules posted in the trivia channel.'
      )],
      ephemeral: true
    });

    // Start the game (this will post rules and wait 30 seconds before first question)
    await gameManager.startGame(interaction.guildId!, config.triviaChannelId, channel);

    logger.info(`Game started by ${interaction.user.tag} in guild ${interaction.guildId}`);
  } catch (error: any) {
    logger.error('Error starting trivia game:', error);
    
    let errorMessage = 'Failed to start trivia game. Please try again.';
    if (error.message === 'A trivia game is already in progress') {
      errorMessage = error.message;
    } else if (error.message === 'Not enough questions available in database') {
      errorMessage = 'Not enough questions available. Please ensure questions are scraped.';
    }

    // Only show error if we haven't already replied
    if (!interaction.replied) {
      await interaction.reply({
        embeds: [createErrorEmbed('Failed to Start Game', errorMessage)],
        ephemeral: true
      });
    }
  }
}
