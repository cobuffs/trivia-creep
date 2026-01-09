# Slash Commands Specification

## `/config`

**Purpose**: Configure the trivia channel for the server.

**Permissions**: Requires administrator permissions (or server-specific role - TBD)

**Options**:
- `channel` (Channel, required) - The Discord channel to use for trivia games

**Behavior**:
- Stores the channel ID in `guild_config` table
- Responds with confirmation message
- If channel already configured, updates existing configuration

**Error Cases**:
- User lacks permissions → Error: "You don't have permission to configure the trivia channel"
- Invalid channel → Error: "Invalid channel specified"

**Response Format**:
```
✅ Trivia channel configured: #channel-name
All trivia games will be played in this channel.
```

---

## `/start-trivia`

**Purpose**: Start a new trivia game.

**Permissions**: Any user (or server-specific role - TBD)

**Options**: None

**Behavior**:
1. Check if trivia channel is configured for the guild
2. Check if an active game already exists
3. Query database for 21 questions (10 Round 1, 10 Round 2, 1 Final)
4. Initialize in-memory game state
5. Post game rules message
6. Begin Round 1, Question 1

**Error Cases**:
- No channel configured → Error: "Trivia channel not configured. Use `/config` to set it up."
- Active game exists → Error: "A trivia game is already in progress. Please wait for it to finish."
- Insufficient questions in database → Error: "Not enough questions available. Please ensure questions are scraped."

**Response Format**:
```
🎮 Starting new trivia game!
Rules: [posted in channel]
```

---

## `/end-trivia`

**Purpose**: End the current trivia game early and archive it.

**Permissions**: Requires administrator permissions (or server-specific role - TBD)

**Options**: None

**Behavior**:
1. Check if an active game exists
2. Stop all active timers (question timer, break timer, wagering timer, answering timer)
3. Calculate final scores for all players (current score at time of ending)
4. Post final leaderboard in the trivia channel
5. Archive game to database with status "completed" (or "abandoned" - TBD)
6. Clear in-memory game state
7. Respond with confirmation message

**Note**: If game is ended during Final Jeopardy:
- Players who wagered but didn't answer: Treat as incorrect (lose wager)
- Players who answered: Calculate normally (correct = +wager, incorrect = -wager)
- Players who didn't wager: Keep current score

**Error Cases**:
- No active game → Error: "No active trivia game to end."
- User lacks permissions → Error: "You don't have permission to end trivia games."

**Response Format**:
```
🛑 Trivia game ended early by @[username]

[Final leaderboard posted in channel]

Game has been archived.
```

**Response Format** (in channel - final leaderboard):
```
━━━━━━━━━━━━━━━━━━━━━━━━
🛑 Game Ended Early
━━━━━━━━━━━━━━━━━━━━━━━━
Game ended by: @[username]

🏆 Final Leaderboard:
1. @Player1 - $8,500
2. @Player2 - $6,200
3. @Player3 - $4,100
...

Game has been archived.
```

---

## `/leaderboard`

**Purpose**: Display leaderboard statistics.

**Permissions**: Any user

**Options**:
- `timeframe` (String, optional) - Options: "all-time" (default), "month", "year"

**Behavior**:
- Queries `game_players` table aggregated by `user_id`
- Filters by timeframe if specified
- Displays top 10 players (or configurable limit)
- Shows rank, username, total score, games played

**Error Cases**:
- Invalid timeframe → Error: "Invalid timeframe. Use: all-time, month, or year"
- No games played → Message: "No games have been played yet."

**Response Format** (Embed):
```
🏆 Leaderboard (All-Time)
━━━━━━━━━━━━━━━━━━━━━━━━
1. @Player1 - $45,000 (3 games)
2. @Player2 - $32,500 (2 games)
3. @Player3 - $28,000 (4 games)
...
```

---

## `/my-trivia-history`

**Purpose**: Display user's personal trivia statistics.

**Permissions**: Any user

**Options**: None

**Behavior**:
- Queries `game_players` table for the user
- Aggregates statistics:
  - Total games played
  - Total score (all-time)
  - Best score
  - Average score
  - Games played this month/year
- Displays in an embed

**Error Cases**:
- User has never played → Message: "You haven't played any trivia games yet."

**Response Format** (Embed):
```
📊 Your Trivia History
━━━━━━━━━━━━━━━━━━━━━━━━
Total Games: 5
All-Time Score: $125,000
Best Score: $35,000
Average Score: $25,000
This Month: 2 games
This Year: 5 games
```

---

## `/final-wager`

**Purpose**: Place a wager for Final Jeopardy.

**Permissions**: Any user

**Options**:
- `amount` (Integer, required) - Wager amount (must be between $1 and player's current score, or up to $2000 if score is $0)

**Behavior**:
1. Check if active game exists
2. Check if game is in Final Jeopardy wagering phase
3. Validate wager amount:
   - Must be ≥ $1
   - Must be whole integer
   - If player score > 0: wager ≤ current score
   - If player score = 0: wager ≤ $2000
4. Store wager in game state
5. Respond with confirmation (ephemeral)

**Error Cases**:
- No active game → Error: "No active trivia game."
- Not in wagering phase → Error: "Wagering phase is not active."
- Invalid amount → Error: "Invalid wager amount. You can wager between $1 and $[max]."
- Already wagered → Error: "You have already placed your wager."

**Response Format** (Ephemeral):
```
✅ Wager placed: $[amount]
Your current score: $[score]
If correct: $[score + wager]
If incorrect: $[score - wager]
```

---

## `/final-guess`

**Purpose**: Submit answer for Final Jeopardy.

**Permissions**: Any user

**Options**:
- `answer` (String, required) - Player's answer to the Final Jeopardy question

**Behavior**:
1. Check if active game exists
2. Check if game is in Final Jeopardy answering phase
3. Check if player placed a wager
4. Store answer in game state
5. Respond with confirmation (ephemeral)

**Error Cases**:
- No active game → Error: "No active trivia game."
- Not in answering phase → Error: "Answering phase is not active."
- No wager placed → Error: "You must place a wager first using `/final-wager`."
- Already answered → Error: "You have already submitted your answer."

**Response Format** (Ephemeral):
```
✅ Answer submitted: "[answer]"
Your wager: $[wager]
Results will be revealed after the answering phase ends.
```
