# Game Flow & State Management

## Game States

### State Machine
```
IDLE → STARTING → ROUND_1 → ROUND_1_BREAK → ROUND_2 → ROUND_2_BREAK → 
FINAL_WAGERING → FINAL_ANSWERING → FINAL_RESULTS → ARCHIVING → IDLE

Note: `/end-trivia` command can transition from any active state (except IDLE) 
directly to ARCHIVING → IDLE
```

### State Descriptions

1. **IDLE** - No active game
2. **STARTING** - Game initialization (fetching questions, setting up state)
3. **ROUND_1** - Round 1 in progress (questions 1-10)
4. **ROUND_1_BREAK** - 30-second break between Round 1 and Round 2
5. **ROUND_2** - Round 2 in progress (questions 11-20)
6. **ROUND_2_BREAK** - 30-second break before Final Jeopardy
7. **FINAL_WAGERING** - Final Jeopardy wagering phase (30 seconds)
8. **FINAL_ANSWERING** - Final Jeopardy answering phase (30 seconds)
9. **FINAL_RESULTS** - Displaying final results
10. **ARCHIVING** - Saving game to database
11. **IDLE** - Return to idle state

## In-Memory Game State Structure

```typescript
interface GameState {
  gameId: string; // Temporary ID for this game session
  guildId: string;
  channelId: string;
  status: GameStatus;
  currentRound: 'round1' | 'round2' | 'final';
  currentQuestionIndex: number; // 0-9 for round1, 0-9 for round2, -1 for final
  questions: {
    round1: Question[];
    round2: Question[];
    final: Question;
  };
  players: Map<string, PlayerState>; // Key: user_id
  startTime: Date;
  currentQuestionStartTime?: Date;
  wageringPhaseEndTime?: Date;
  answeringPhaseEndTime?: Date;
  timers: {
    questionTimer?: NodeJS.Timeout;
    breakTimer?: NodeJS.Timeout;
    wageringTimer?: NodeJS.Timeout;
    answeringTimer?: NodeJS.Timeout;
  };
}

interface PlayerState {
  userId: string;
  username: string;
  score: number;
  finalWager?: number;
  finalAnswer?: string;
  finalCorrect?: boolean;
  participated: boolean; // True if they've sent any message during the game
}
```

## Game Flow Details

### Starting a Game (`/start-trivia`)

1. **Validation**
   - Check guild config for trivia channel
   - Check no active game exists
   - Query database for questions

2. **Initialization**
   - Create `GameState` object
   - Store in singleton/global state manager
   - Set status to `STARTING`

3. **Post Game Rules**
   ```
   🎮 Welcome to Trivia Creep!
   ━━━━━━━━━━━━━━━━━━━━━━━━━
   Rules:
   • 20 questions + 1 Final Jeopardy
   • Answer in chat (no need to phrase as question)
   • First correct answer wins the points
   • 30 seconds per question
   • Final Jeopardy: Wager first, then answer
   ```

4. **Begin Round 1**
   - Set status to `ROUND_1`
   - Set `currentQuestionIndex` to 0
   - Start first question

### Round 1 & 2 Question Flow

For each question (1-10 in Round 1, 11-20 in Round 2):

1. **Pre-Question**
   - Display current leaderboard (if players exist)
   - Wait 5 seconds (if not first question)

2. **Post Question**
   ```
   ━━━━━━━━━━━━━━━━━━━━━━━━━
   Round 1 - Question 1
   Category: HISTORY
   Value: $200
   ━━━━━━━━━━━━━━━━━━━━━━━━━
   [Question text]
   ```

3. **Monitor Answers (30 seconds)**
   - Listen to all messages in channel
   - Validate answers in real-time
   - First correct answer:
     - Award points
     - Update player score
     - Mark player as participated
     - Post success message:
       ```
       ✅ @PlayerName got it! +$200
       [Updated leaderboard]
       ```
   - If multiple correct answers with identical timestamps:
     - Award all players
     - Post message listing all winners

4. **Question Timeout (30 seconds)**
   - Post correct answer:
     ```
     ⏰ Time's up!
     Correct answer: [answer]
     ```
   - Move to next question

5. **Between Questions**
   - 5-second break (except before Round 2 break)

### Round 1 → Round 2 Transition

1. After Round 1, Question 10 completes
2. Set status to `ROUND_1_BREAK`
3. Post break message:
   ```
   ━━━━━━━━━━━━━━━━━━━━━━━━━
   Round 1 Complete!
   ━━━━━━━━━━━━━━━━━━━━━━━━━
   [Final Round 1 Leaderboard]
   
   Round 2 starting in 30 seconds...
   ```
4. Wait 30 seconds
5. Set status to `ROUND_2`
6. Begin Round 2, Question 1

### Final Jeopardy Flow

#### Wagering Phase

1. After Round 2, Question 10 completes
2. Set status to `FINAL_WAGERING`
3. Post Final Jeopardy category:
   ```
   ━━━━━━━━━━━━━━━━━━━━━━━━━
   🎯 FINAL JEOPARDY
   ━━━━━━━━━━━━━━━━━━━━━━━━━
   Category: [Category Name]
   
   Current Leaderboard:
   [Leaderboard with all players who participated]
   
   You have 30 seconds to place your wager using /final-wager
   ```
4. Start 30-second timer
5. Accept `/final-wager` commands
6. Validate wagers (store in player state)

#### Answering Phase

1. After 30 seconds, wagering phase ends
2. Set status to `FINAL_ANSWERING`
3. Post Final Jeopardy question:
   ```
   ━━━━━━━━━━━━━━━━━━━━━━━━━
   🎯 FINAL JEOPARDY
   ━━━━━━━━━━━━━━━━━━━━━━━━━
   Category: [Category Name]
   
   [Question text]
   
   Submit your answer using /final-guess
   You have 30 seconds.
   ```
4. Start 30-second timer
5. Accept `/final-guess` commands (only from players who wagered)
6. Store answers in player state

#### Results Phase

1. After 30 seconds, answering phase ends
2. Set status to `FINAL_RESULTS`
3. Calculate final scores:
   - For each player who answered:
     - If correct: `final_score = current_score + wager`
     - If incorrect: `final_score = current_score - wager`
4. Post results:
   ```
   ━━━━━━━━━━━━━━━━━━━━━━━━━
   🎯 FINAL JEOPARDY RESULTS
   ━━━━━━━━━━━━━━━━━━━━━━━━━
   Correct Answer: [answer]
   
   @Player1: [answer] ✅ +$5,000 → $25,000
   @Player2: [answer] ❌ -$3,000 → $12,000
   @Player3: [answer] ✅ +$2,000 → $15,000
   
   ━━━━━━━━━━━━━━━━━━━━━━━━━
   🏆 FINAL LEADERBOARD
   ━━━━━━━━━━━━━━━━━━━━━━━━━
   1. @Player1 - $25,000
   2. @Player3 - $15,000
   3. @Player2 - $12,000
   ```

### Archiving

1. Set status to `ARCHIVING`
2. Insert into `trivia_games` table
3. Insert all players into `game_players` table
4. Update/insert into `player_statistics` table
5. Clear in-memory game state
6. Set status to `IDLE`

### Ending Game Early (`/end-trivia`)

**When**: Can be called from any active game state (except IDLE)

**Flow**:
1. Validate command (permissions, active game exists)
2. Stop all active timers:
   - Clear `questionTimer`
   - Clear `breakTimer`
   - Clear `wageringTimer`
   - Clear `answeringTimer`
3. Calculate final scores:
   - **If in Rounds 1 or 2**: Use current scores
   - **If in Final Jeopardy wagering phase**: 
     - Players who wagered: Keep current score (no Final Jeopardy calculation)
     - Players who didn't wager: Keep current score
   - **If in Final Jeopardy answering phase**:
     - Players who answered: Calculate normally (correct = +wager, incorrect = -wager)
     - Players who wagered but didn't answer: Treat as incorrect (lose wager)
     - Players who didn't wager: Keep current score
4. Post final leaderboard in channel
5. Archive game to database (same as normal archiving)
6. Clear in-memory game state
7. Set status to `IDLE`

**Note**: Games ended early are still archived with status "completed" (or consider "abandoned" status - TBD)

## Timing Constants

- **Question Time**: 30 seconds
- **Between Questions Break**: 5 seconds
- **Round Break**: 30 seconds
- **Final Wagering Phase**: 30 seconds
- **Final Answering Phase**: 30 seconds

## Error Handling

- **Bot Restart During Game**: Game state lost, game must be restarted (future: persist state to database)
- **Database Error During Archive**: Log error, attempt retry, notify admin
- **No Players Participate**: Still archive game with zero participants
