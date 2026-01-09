import { Client, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { logger } from '../utils/logger';

// Command definitions
const commands = [
  new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure the trivia channel for this server')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('The Discord channel to use for trivia games')
        .setRequired(true)
    )
    .addRoleOption(option =>
      option
        .setName('required-role')
        .setDescription('Role required to start trivia games (optional, leave empty to allow anyone)')
        .setRequired(false)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('start-trivia')
    .setDescription('Start a new trivia game')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('end-trivia')
    .setDescription('End the current trivia game early (admin only)')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Display leaderboard statistics')
    .addStringOption(option =>
      option
        .setName('timeframe')
        .setDescription('Time period for leaderboard')
        .setRequired(false)
        .addChoices(
          { name: 'All-Time', value: 'all-time' },
          { name: 'Month', value: 'month' },
          { name: 'Year', value: 'year' }
        )
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('my-trivia-history')
    .setDescription('Display your personal trivia statistics')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('final-wager')
    .setDescription('Place a wager for Final Jeopardy')
    .addIntegerOption(option =>
      option
        .setName('amount')
        .setDescription('Wager amount (between $1 and your current score, or up to $2000 if score is $0)')
        .setRequired(true)
        .setMinValue(1)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('final-guess')
    .setDescription('Submit your answer for Final Jeopardy')
    .addStringOption(option =>
      option
        .setName('answer')
        .setDescription('Your answer to the Final Jeopardy question')
        .setRequired(true)
    )
    .toJSON()
];

export async function handleReady(client: Client) {
  logger.info(`Bot is ready! Logged in as ${client.user?.tag}`);

  // Register slash commands
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN!);

  try {
    logger.info('Started refreshing application (/) commands.');

    // Register commands globally (can take up to 1 hour to propagate)
    // For faster updates during development, use guild-specific commands
    const clientId = client.user?.id;
    if (!clientId) {
      throw new Error('Client ID not found');
    }

    await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands }
    );

    logger.info(`Successfully registered ${commands.length} application (/) commands.`);

    // Set bot status
    client.user?.setActivity('Trivia Games', { type: 0 }); // Playing
  } catch (error) {
    logger.error('Error registering commands:', error);
  }
}
