# Final Jeopardy Implementation

## Overview

Final Jeopardy is a two-phase round:
1. **Wagering Phase** (30 seconds) - Players place wagers
2. **Answering Phase** (30 seconds) - Players submit answers

## Wagering Phase

### State
- Game status: `FINAL_WAGERING`
- Duration: 30 seconds
- Command: `/final-wager`

### Flow

1. **Transition from Round 2**
   - After Round 2, Question 10 completes
   - Display current leaderboard with all participants
   - Post Final Jeopardy category

2. **Post Category Message**
   ```
   ━━━━━━━━━━━━━━━━━━━━━━━━━
   🎯 FINAL JEOPARDY
   ━━━━━━━━━━━━━━━━━━━━━━━━━
   Category: [Category Name]
   
   📊 Current Leaderboard:
   1. @Player1 - $12,000
   2. @Player2 - $8,500
   3. @Player3 - $5,200
   4. @Player4 - $0
   
   💰 You have 30 seconds to place your wager using /final-wager
   ```

3. **Wager Validation Rules**
   - Minimum: $1
   - Maximum: 
     - If score > 0: Current score
     - If score = 0: $2,000
   - Must be whole integer
   - Player can only wager once

4. **Wager Storage**
   - Store in `PlayerState.finalWager`
   - Mark player as participated in Final Jeopardy

5. **Confirmation Message** (Ephemeral)
   ```
   ✅ Wager placed: $5,000
   
   Your current score: $12,000
   If correct: $17,000
   If incorrect: $7,000
   ```

6. **Timer**
   - 30-second countdown
   - After timer expires, transition to answering phase

### Error Handling

- **No active game**: "No active trivia game."
- **Wrong phase**: "Wagering phase is not active."
- **Invalid amount**: "Invalid wager amount. You can wager between $1 and $[max]."
- **Already wagered**: "You have already placed your wager."
- **Negative score edge case**: If player has negative score, they can still wager up to $2,000

---

## Answering Phase

### State
- Game status: `FINAL_ANSWERING`
- Duration: 30 seconds
- Command: `/final-guess`

### Flow

1. **Transition from Wagering Phase**
   - After 30 seconds, wagering phase ends
   - Post Final Jeopardy question

2. **Post Question Message**
   ```
   ━━━━━━━━━━━━━━━━━━━━━━━━━
   🎯 FINAL JEOPARDY
   ━━━━━━━━━━━━━━━━━━━━━━━━━
   Category: [Category Name]
   
   [Question text]
   
   Submit your answer using /final-guess
   You have 30 seconds.
   ```

3. **Answer Validation**
   - Only players who placed a wager can answer
   - Player can only answer once
   - Answer stored in `PlayerState.finalAnswer`

4. **Confirmation Message** (Ephemeral)
   ```
   ✅ Answer submitted: "[answer]"
   
   Your wager: $5,000
   Results will be revealed after the answering phase ends.
   ```

5. **Timer**
   - 30-second countdown
   - After timer expires, transition to results phase

### Error Handling

- **No active game**: "No active trivia game."
- **Wrong phase**: "Answering phase is not active."
- **No wager**: "You must place a wager first using `/final-wager`."
- **Already answered**: "You have already submitted your answer."

---

## Results Phase

### State
- Game status: `FINAL_RESULTS`
- Calculate final scores
- Display results

### Flow

1. **Calculate Final Scores**
   For each player who participated in Final Jeopardy:
   ```typescript
   if (player.finalCorrect) {
     player.finalScore = player.currentScore + player.finalWager;
     player.finalScoreChange = +player.finalWager;
   } else {
     player.finalScore = player.currentScore - player.finalWager;
     player.finalScoreChange = -player.finalWager;
   }
   ```

2. **Post Results Message**
   ```
   ━━━━━━━━━━━━━━━━━━━━━━━━━
   🎯 FINAL JEOPARDY RESULTS
   ━━━━━━━━━━━━━━━━━━━━━━━━━
   Correct Answer: [answer]
   
   @Player1: "[answer]" ✅ +$5,000 → $17,000
   @Player2: "[answer]" ❌ -$3,000 → $5,500
   @Player3: "[answer]" ✅ +$2,000 → $7,200
   @Player4: "[answer]" ❌ -$1,500 → -$1,500
   ```

3. **Post Final Leaderboard**
   ```
   ━━━━━━━━━━━━━━━━━━━━━━━━━
   🏆 FINAL LEADERBOARD
   ━━━━━━━━━━━━━━━━━━━━━━━━━
   1. @Player1 - $17,000
   2. @Player3 - $7,200
   3. @Player2 - $5,500
   4. @Player4 - -$1,500
   ```

4. **Archive Game**
   - Save to database (see Game Flow document)
   - Clear in-memory state

---

## Edge Cases

### No Players Wager
- If no players place a wager, skip to final leaderboard
- Still archive game with Final Jeopardy question

### Players Who Didn't Wager
- Excluded from Final Jeopardy answering phase
- Keep their Round 1 + Round 2 scores
- Included in final leaderboard

### Multiple Correct Answers
- All players who answer correctly get points
- All players who answer incorrectly lose points
- No "first to answer" bonus in Final Jeopardy

### Answer Validation
- Use same answer validation logic as Rounds 1 & 2
- Case-insensitive, handle parenthetical content, etc.

### Timer Expiration
- If wagering phase expires: Move to answering phase (even if no wagers)
- If answering phase expires: Calculate results (players who didn't answer lose their wager)

### Negative Final Scores
- Players can end with negative scores
- Display negative scores in final leaderboard
- Archive negative scores to database

---

## Data Storage

### In-Memory (During Game)
```typescript
PlayerState {
  finalWager?: number;      // Wager amount
  finalAnswer?: string;      // Player's answer
  finalCorrect?: boolean;    // Whether answer was correct
  finalScoreChange?: number; // Points gained/lost
}
```

### Database (After Game)
```sql
game_players {
  final_wager INT NULL,           // Wager amount (NULL if didn't participate)
  final_correct BIT NULL,         // Correct/incorrect (NULL if didn't participate)
  final_score_change INT NULL,    // Points gained/lost
  final_score INT NOT NULL        // Final score after Final Jeopardy
}
```

---

## User Experience Considerations

### Wagering Phase
- Show current leaderboard to help players decide wager amount
- Ephemeral confirmations so other players don't see wagers
- Clear instructions on wager limits

### Answering Phase
- Ephemeral confirmations for privacy
- Clear indication of time remaining (optional countdown message)

### Results Phase
- Show both individual results and final leaderboard
- Highlight winners
- Show answer correctness clearly (✅/❌)
