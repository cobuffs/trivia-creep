import { Client, GatewayIntentBits, Collection } from 'discord.js';
import dotenv from 'dotenv';
import { DatabaseService } from '../services/database';
import { GameManager } from '../services/game-manager';
import { SchedulerService } from '../services/scheduler';
import { logger } from '../utils/logger';
import { handleReady } from '../events/ready';
import { handleInteraction } from '../events/interactionCreate';
import { handleMessage } from '../events/messageCreate';

dotenv.config();

// Extend Client to include commands collection
declare module 'discord.js' {
  export interface Client {
    commands: Collection<string, any>;
  }
}

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Initialize services
const databaseService = new DatabaseService();
const gameManager = GameManager.getInstance(databaseService);
const schedulerService = SchedulerService.getInstance(databaseService, gameManager);

// Initialize commands collection
client.commands = new Collection();

// Set up event handlers
client.once('ready', () => handleReady(client, databaseService, gameManager, schedulerService));
client.on('interactionCreate', (interaction) => handleInteraction(interaction, databaseService, gameManager, schedulerService));
client.on('messageCreate', (message) => handleMessage(message, gameManager));

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down bot...');
  await databaseService.close();
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down bot...');
  await databaseService.close();
  client.destroy();
  process.exit(0);
});

// Start bot
async function startBot() {
  try {
    // Initialize database connection
    await databaseService.initialize();
    logger.info('Database connected');

    // Login to Discord
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
      throw new Error('DISCORD_BOT_TOKEN not found in environment variables');
    }

    await client.login(token);
    logger.info('Bot logged in successfully');
  } catch (error) {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  }
}

// Start the bot
startBot();

export { client, databaseService, gameManager, schedulerService };
