# Database Schema

## Existing Tables

### `questions` (Already exists)
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

## New Tables to Create

### `trivia_games`
Stores completed trivia game sessions.

**Fields:**
- `game_id` (INT, PRIMARY KEY, IDENTITY) - Unique game identifier
- `guild_id` (NVARCHAR(255), NOT NULL) - Discord server ID
- `channel_id` (NVARCHAR(255), NOT NULL) - Discord channel ID where game was played
- `started_at` (DATETIME2, NOT NULL) - When the game started
- `completed_at` (DATETIME2, NOT NULL) - When the game ended
- `status` (NVARCHAR(50), NOT NULL) - 'completed' (game finished normally), 'abandoned' (game ended early via /end-trivia)
- `round1_questions` (NVARCHAR(MAX)) - JSON array of question IDs used in Round 1
- `round2_questions` (NVARCHAR(MAX)) - JSON array of question IDs used in Round 2
- `final_question_id` (INT) - Foreign key to questions table for Final Jeopardy question

### `game_players`
Tracks which players participated in each game.

**Fields:**
- `game_player_id` (INT, PRIMARY KEY, IDENTITY) - Unique identifier
- `game_id` (INT, NOT NULL) - Foreign key to trivia_games
- `user_id` (NVARCHAR(255), NOT NULL) - Discord user ID
- `username` (NVARCHAR(255), NOT NULL) - Discord username at time of game
- `final_score` (INT, NOT NULL) - Player's final score for this game
- `round1_score` (INT, NOT NULL, DEFAULT 0) - Points earned in Round 1
- `round2_score` (INT, NOT NULL, DEFAULT 0) - Points earned in Round 2
- `final_wager` (INT, NULL) - Wager amount for Final Jeopardy (NULL if didn't participate)
- `final_correct` (BIT, NULL) - Whether they answered Final Jeopardy correctly (NULL if didn't participate)
- `final_score_change` (INT, NULL) - Points gained/lost in Final Jeopardy

**Indexes:**
- Index on `game_id`
- Index on `user_id`
- Composite index on `user_id`, `game_id`

### `player_statistics` (Optional - for caching leaderboard data)
Aggregated statistics per player for faster leaderboard queries.

**Fields:**
- `stat_id` (INT, PRIMARY KEY, IDENTITY)
- `user_id` (NVARCHAR(255), NOT NULL, UNIQUE) - Discord user ID
- `total_games` (INT, NOT NULL, DEFAULT 0) - Total games played
- `total_score_all_time` (INT, NOT NULL, DEFAULT 0) - Sum of all final scores
- `best_score` (INT, NOT NULL, DEFAULT 0) - Highest final score achieved
- `last_played` (DATETIME2, NULL) - Last game participation date
- `last_updated` (DATETIME2, NOT NULL) - When stats were last recalculated

**Indexes:**
- Index on `user_id`
- Index on `total_score_all_time` (for leaderboard queries)

### `guild_config`
Stores per-guild configuration (trivia channel).

**Fields:**
- `config_id` (INT, PRIMARY KEY, IDENTITY)
- `guild_id` (NVARCHAR(255), NOT NULL, UNIQUE) - Discord server ID
- `trivia_channel_id` (NVARCHAR(255), NULL) - Configured channel for trivia games
- `updated_at` (DATETIME2, NOT NULL) - Last update timestamp

**Indexes:**
- Index on `guild_id`

## Query Patterns

### Getting Questions for a Game
```sql
-- Round 1: 10 random questions
SELECT TOP 10 * FROM questions 
WHERE round = 'Jeopardy!' 
ORDER BY NEWID()

-- Round 2: 10 random questions
SELECT TOP 10 * FROM questions 
WHERE round = 'Double Jeopardy!' 
ORDER BY NEWID()

-- Final Jeopardy: 1 random question
SELECT TOP 1 * FROM questions 
WHERE round = 'Final Jeopardy!' 
ORDER BY NEWID()
```

### Archiving a Game
1. Insert into `trivia_games`
2. Insert player records into `game_players`
3. Update `player_statistics` (or recalculate on-demand)

### Leaderboard Queries
- All-time: Sum of `final_score` from `game_players`, grouped by `user_id`
- Month: Same query with date filter on `trivia_games.completed_at`
- Year: Same query with year filter on `trivia_games.completed_at`
