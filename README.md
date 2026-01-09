# Trivia Creep

A Discord trivia bot with scrapers for various trivia sources, starting with Jeopardy questions from j-archive.com.

## Project Structure

- `helper-scripts/` - Utility scripts for scraping trivia data and database setup
- `src/` - Main Discord bot source code
  - `bot/` - Bot initialization and startup
  - `commands/` - Slash command handlers
  - `events/` - Discord event handlers
  - `services/` - Core services (database, game manager, answer validator)
  - `utils/` - Utility functions (logger, formatters)

## Setup

### Prerequisites

1. Node.js (v18 or higher recommended)
2. MSSQL Server database
3. Discord Bot Token (see Discord Developer Portal setup below)

### 1. Install Dependencies

```bash
npm install
```

### 2. Discord Developer Portal Configuration

Before running the bot, you need to create and configure a Discord application:

1. **Create Application**
   - Go to https://discord.com/developers/applications
   - Click "New Application"
   - Give it a name (e.g., "Trivia Creep")
   - Click "Create"

2. **Create Bot User**
   - Navigate to the "Bot" section in the left sidebar
   - Click "Add Bot" and confirm
   - Under "Token", click "Reset Token" and copy the token (you'll need this for `.env`)
   - **Important**: Keep this token secret! Never commit it to version control.

3. **Enable Required Intents**
   - Still in the "Bot" section, scroll down to "Privileged Gateway Intents"
   - Enable the following intents:
     - ✅ **GUILDS** - Required for slash commands and guild data
     - ✅ **GUILD_MESSAGES** - Required for monitoring messages in channels
     - ✅ **MESSAGE_CONTENT** - Required for reading message content
   - Click "Save Changes"

4. **Set Bot Permissions**
   - Navigate to the "OAuth2" → "URL Generator" section
   - Under "Scopes", select:
     - ✅ `bot`
     - ✅ `applications.commands`
   - Under "Bot Permissions", select:
     - ✅ Send Messages
     - ✅ Embed Links
     - ✅ Read Message History
     - ✅ Use Slash Commands
   - Copy the generated URL at the bottom
   - Open the URL in your browser to invite the bot to your server
   - Make sure you have "Manage Server" permissions on the server

### 3. Environment Configuration

Create a `.env` file from `.env.example` and fill in your credentials:

```bash
cp .env.example .env
```

Required environment variables:

```env
# Discord Bot Token (from Developer Portal)
DISCORD_BOT_TOKEN=your_bot_token_here

# Database Configuration
MSSQL_USER=your_username
MSSQL_PASSWORD=your_password
MSSQL_SERVER=localhost
MSSQL_DATABASE=triviacreep
MSSQL_PORT=1433
```

### 4. Database Setup

1. Ensure your MSSQL database `triviacreep` exists and is accessible.

2. Create the bot tables:

```bash
npm run setup:database
```

This will create the following tables:
- `trivia_games` - Stores completed game sessions
- `game_players` - Tracks player participation and scores
- `player_statistics` - Aggregated player statistics
- `guild_config` - Per-guild configuration (trivia channel)

3. (Optional) Scrape some questions to get started:

```bash
npm run scrape:jarchive
```

## Usage

### Running the Bot

**Development mode:**
```bash
npm run dev
```

**Production mode:**
```bash
npm run build
npm start
```

### Bot Commands

Once the bot is running and invited to your server:

#### `/config` (Admin Only)
Configure the trivia channel for your server.

- **Options:**
  - `channel` (required) - The Discord channel to use for trivia games

**Example:**
```
/config channel:#trivia
```

#### `/start-trivia`
Start a new trivia game. The game will:
- Pull 10 random questions from Round 1 (Jeopardy!)
- Pull 10 random questions from Round 2 (Double Jeopardy!)
- Pull 1 random question for Final Jeopardy
- Display game rules and begin Round 1

**Note:** Only one trivia game can be active at a time per server.

#### `/end-trivia` (Admin Only)
End the current trivia game early and archive it. Useful if a game needs to be stopped.

#### `/leaderboard`
Display leaderboard statistics.

- **Options:**
  - `timeframe` (optional) - `all-time` (default), `month`, or `year`

**Examples:**
```
/leaderboard
/leaderboard timeframe:month
/leaderboard timeframe:year
```

#### `/my-trivia-history`
Display your personal trivia statistics, including:
- Total games played
- All-time score
- Best score
- Average score
- Games played this month/year

#### `/final-wager`
Place a wager for Final Jeopardy (only available during Final Jeopardy wagering phase).

- **Options:**
  - `amount` (required) - Wager amount
    - Minimum: $1
    - Maximum: Your current score (or $2,000 if your score is $0)
    - Must be a whole number

**Example:**
```
/final-wager amount:5000
```

#### `/final-guess`
Submit your answer for Final Jeopardy (only available during Final Jeopardy answering phase).

- **Options:**
  - `answer` (required) - Your answer to the Final Jeopardy question

**Note:** You must place a wager first using `/final-wager`.

**Example:**
```
/final-guess answer:Paris
```

### Game Flow

1. **Round 1 & 2:**
   - Bot posts a question with category and dollar amount
   - Players answer in the chat (no need to phrase as a question)
   - First correct answer wins the points
   - 30 seconds per question
   - 5 second break between questions
   - 30 second break between rounds

2. **Final Jeopardy:**
   - Bot posts the category
   - 30-second wagering phase (players use `/final-wager`)
   - Bot posts the question
   - 30-second answering phase (players use `/final-guess`)
   - Bot calculates final scores and displays results

### Answer Validation

The bot uses intelligent answer matching:
- **Case-insensitive** - "Paris" matches "paris", "PARIS", "PaRiS"
- **Ignores common words** - Removes "the", "a", "an" from both answer and input
- **Handles parenthetical content** - "(Tom) Hanks" accepts both "Tom Hanks" and "Hanks"
- **Common variations** - Handles & ↔ and, hyphens, etc.

## Scraping J-Archive Data

Scrape all seasons and games:
```bash
npm run scrape:jarchive
```

Scrape a specific season:
```bash
npm run scrape:jarchive:season 42
# or
ts-node helper-scripts/j-archive-scraper.ts --season 42
```

Scrape a specific game:
```bash
npm run scrape:jarchive:game 173
# or
ts-node helper-scripts/j-archive-scraper.ts --game-id 173
```

The scraper is idempotent - it will skip games that are already in the database, so it's safe to run multiple times.

## Database Schema

### `questions` Table
Stores trivia questions with the following flexible schema:

- `source` (required) - Source identifier (e.g., 'j-archive')
- `question` (required) - The question text
- `answer` (required) - The correct answer
- `category` (optional) - Category/topic
- `dollar_amount` (optional) - Dollar amount (for Jeopardy)
- `round` (optional) - Round identifier ('Jeopardy!', 'Double Jeopardy!', 'Final Jeopardy!')
- `game_id` (optional) - Game/episode ID
- `season` (optional) - Season identifier
- `clue_order` (optional) - Order within round
- `metadata` (optional) - JSON string for additional data

### Bot Tables

- `trivia_games` - Completed game sessions
- `game_players` - Player participation and scores per game
- `player_statistics` - Aggregated player statistics
- `guild_config` - Per-guild configuration

See [plans/02-database-schema.md](plans/02-database-schema.md) for detailed schema information.

## Development

Build TypeScript:
```bash
npm run build
```

Run bot in development mode:
```bash
npm run dev
```

## Troubleshooting

### Bot doesn't respond to commands
- Make sure the bot is online (check the Discord Developer Portal)
- Verify the bot has been invited to your server with the correct permissions
- Check that slash commands are registered (may take up to 1 hour for global commands)
- Ensure the bot has the required intents enabled

### "Trivia channel not configured" error
- Use `/config` to set up the trivia channel first
- Make sure you have administrator permissions

### "Not enough questions available" error
- Run the scraper to populate the database: `npm run scrape:jarchive`
- Ensure you have questions for all three rounds (Jeopardy!, Double Jeopardy!, Final Jeopardy!)

### Database connection errors
- Verify your database credentials in `.env`
- Ensure the database server is running and accessible
- Check that the `triviacreep` database exists
- Run `npm run setup:database` to create required tables

### Bot can't send messages
- Check bot permissions in the configured trivia channel
- Ensure the bot has "Send Messages" and "Embed Links" permissions
- Verify the channel still exists and hasn't been deleted

## Future Development

- Additional trivia source scrapers
- Game statistics and analytics
- Customizable question counts
- Different game modes
- Team play support
- Bot restart recovery (persist game state)

## Planning Documents

See the `plans/` directory for detailed planning documents covering:
- Architecture overview
- Database schema
- Slash commands specification
- Game flow and state management
- Answer validation logic
- Leaderboard system
- Final Jeopardy implementation
- Message formatting
- Error handling
