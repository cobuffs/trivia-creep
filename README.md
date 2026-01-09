# Trivia Creep

A Discord trivia bot with scrapers for various trivia sources, starting with Jeopardy questions from j-archive.com.

## Project Structure

- `helper-scripts/` - Utility scripts for scraping trivia data
- `src/` - Main Discord bot source code (scaffolded for future development)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file from `.env.example` and fill in your database credentials and Discord bot token:
```bash
cp .env.example .env
```

3. Ensure your MSSQL database `triviacreep` exists and is accessible.

## Usage

### Scraping J-Archive Data

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

The `questions` table stores trivia questions with the following flexible schema:

- `source` (required) - Source identifier (e.g., 'j-archive')
- `question` (required) - The question text
- `answer` (required) - The correct answer
- `category` (optional) - Category/topic
- `dollar_amount` (optional) - Dollar amount (for Jeopardy)
- `round` (optional) - Round identifier
- `game_id` (optional) - Game/episode ID
- `season` (optional) - Season identifier
- `clue_order` (optional) - Order within round
- `metadata` (optional) - JSON string for additional data

## Development

Build TypeScript:
```bash
npm run build
```

Run bot in development mode:
```bash
npm run dev
```

## Future Development

- Discord bot implementation
- Additional trivia source scrapers
- Trivia game logic
- Command handlers
