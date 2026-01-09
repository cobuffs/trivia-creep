# Leaderboard System

## Leaderboard Types

### 1. Per-Game Leaderboard
Displayed during active trivia games.

**Data Source**: In-memory game state (`GameState.players`)

**Display Timing**:
- Before each question (if players exist)
- After each correct answer
- After Round 1 completion
- Before Final Jeopardy (with all participants)
- Final leaderboard after game ends

**Format**:
```
━━━━━━━━━━━━━━━━━━━━━━━━
📊 Current Leaderboard
━━━━━━━━━━━━━━━━━━━━━━━━
1. @Player1 - $5,200
2. @Player2 - $3,800
3. @Player3 - $2,100
4. @Player4 - $400
```

**Sorting**: Descending by score
**Display Limit**: All players (or top 10 if too many)

---

### 2. All-Time Leaderboard (`/leaderboard timeframe:all-time`)

**Data Source**: `game_players` table, aggregated by `user_id`

**Query**:
```sql
SELECT 
  gp.user_id,
  MAX(gp.username) as username, -- Most recent username
  SUM(gp.final_score) as total_score,
  COUNT(*) as games_played
FROM game_players gp
INNER JOIN trivia_games tg ON gp.game_id = tg.game_id
GROUP BY gp.user_id
ORDER BY total_score DESC
```

**Format** (Embed):
```
🏆 All-Time Leaderboard
━━━━━━━━━━━━━━━━━━━━━━━━
1. @Player1 - $125,000 (5 games)
2. @Player2 - $98,500 (4 games)
3. @Player3 - $87,200 (6 games)
...
```

**Display Limit**: Top 10 (configurable)

---

### 3. Monthly Leaderboard (`/leaderboard timeframe:month`)

**Data Source**: `game_players` table, filtered by current month

**Query**:
```sql
SELECT 
  gp.user_id,
  MAX(gp.username) as username,
  SUM(gp.final_score) as total_score,
  COUNT(*) as games_played
FROM game_players gp
INNER JOIN trivia_games tg ON gp.game_id = tg.game_id
WHERE YEAR(tg.completed_at) = YEAR(GETDATE())
  AND MONTH(tg.completed_at) = MONTH(GETDATE())
GROUP BY gp.user_id
ORDER BY total_score DESC
```

**Format** (Embed):
```
🏆 Monthly Leaderboard (January 2026)
━━━━━━━━━━━━━━━━━━━━━━━━
1. @Player1 - $45,000 (2 games)
2. @Player2 - $32,500 (2 games)
...
```

---

### 4. Yearly Leaderboard (`/leaderboard timeframe:year`)

**Data Source**: `game_players` table, filtered by current year

**Query**:
```sql
SELECT 
  gp.user_id,
  MAX(gp.username) as username,
  SUM(gp.final_score) as total_score,
  COUNT(*) as games_played
FROM game_players gp
INNER JOIN trivia_games tg ON gp.game_id = tg.game_id
WHERE YEAR(tg.completed_at) = YEAR(GETDATE())
GROUP BY gp.user_id
ORDER BY total_score DESC
```

**Format** (Embed):
```
🏆 Yearly Leaderboard (2026)
━━━━━━━━━━━━━━━━━━━━━━━━
1. @Player1 - $125,000 (5 games)
2. @Player2 - $98,500 (4 games)
...
```

---

## Leaderboard Display Logic

### During Active Game

**When to Show**:
1. Before first question (if any players have already participated)
2. After each correct answer (updated leaderboard)
3. After Round 1 completion
4. Before Final Jeopardy (showing all participants)

**Who is Included**:
- All players who have:
  - Answered a question (correctly or incorrectly)
  - Sent any message in the trivia channel during the active game
  - Placed a wager in Final Jeopardy

**Sorting**: Descending by current score

**Formatting**:
- Use Discord embeds for better formatting
- Include rank, username, score
- Highlight current leader (optional)

### Empty Leaderboard Handling

**During Game**:
- If no players have participated yet, don't show leaderboard
- Show message: "No players have participated yet."

**Historical Leaderboards**:
- If no games in timeframe: "No games have been played [timeframe] yet."

---

## Performance Considerations

### Caching Strategy

**Option 1: Real-time Calculation**
- Calculate leaderboards on-demand from database
- Slower but always accurate

**Option 2: Cached Aggregates**
- Use `player_statistics` table for all-time leaderboard
- Update on game completion
- Faster queries

**Recommendation**: Hybrid approach
- All-time: Use `player_statistics` table (cached)
- Monthly/Yearly: Calculate on-demand (less frequent queries)
- Per-game: In-memory (fast)

### Query Optimization

**Indexes Needed**:
- `game_players.user_id` (for grouping)
- `game_players.game_id` (for joins)
- `trivia_games.completed_at` (for date filtering)
- Composite index: `(user_id, game_id)` for faster lookups

---

## Leaderboard Embed Design

### Color Scheme
- All-time: Gold (#FFD700)
- Monthly: Silver (#C0C0C0)
- Yearly: Bronze (#CD7F32)
- Per-game: Blue (#0099FF)

### Embed Structure
```typescript
{
  title: "🏆 [Leaderboard Type]",
  description: "Top players by total score",
  color: [color code],
  fields: [
    {
      name: "Rank",
      value: "1\n2\n3\n...",
      inline: true
    },
    {
      name: "Player",
      value: "@Player1\n@Player2\n@Player3\n...",
      inline: true
    },
    {
      name: "Score",
      value: "$125,000\n$98,500\n$87,200\n...",
      inline: true
    }
  ],
  footer: {
    text: "Games played: X | Last updated: [timestamp]"
  }
}
```

---

## Edge Cases

### Ties
- Same score: Sort by games played (fewer games = higher rank)
- Same score and games: Sort alphabetically by username

### Deleted Users
- If user_id no longer exists in Discord, show as "Unknown User" or "[Deleted User]"
- Still include in leaderboard with their historical data

### Negative Scores
- Players can have negative scores (Final Jeopardy wagers)
- Include in leaderboard, sorted appropriately

### Very Large Leaderboards
- Limit display to top 10-25 players
- Add pagination if needed (future enhancement)
