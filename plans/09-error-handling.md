# Error Handling & Edge Cases

## Command Error Handling

### `/config`
**Errors**:
- User lacks permissions
  - Response: "❌ You don't have permission to configure the trivia channel."
  - Log: Warning level
- Invalid channel
  - Response: "❌ Invalid channel specified."
  - Log: Warning level
- Database error
  - Response: "❌ Failed to save configuration. Please try again."
  - Log: Error level with details
  - Retry: Not automatic, user must retry

---

### `/start-trivia`
**Errors**:
- No channel configured
  - Response: "❌ Trivia channel not configured. Use `/config` to set it up."
  - Log: Info level
- Active game exists
  - Response: "❌ A trivia game is already in progress. Please wait for it to finish."
  - Log: Info level
- Insufficient questions in database
  - Response: "❌ Not enough questions available. Please ensure questions are scraped."
  - Log: Warning level
- Database query failure
  - Response: "❌ Failed to load questions. Please try again."
  - Log: Error level with details
  - Retry: User can retry command
- Bot lacks permissions in channel
  - Response: "❌ Bot lacks permissions to post messages in the configured channel."
  - Log: Error level

---

### `/end-trivia`
**Errors**:
- No active game
  - Response: "❌ No active trivia game to end."
  - Log: Info level
- User lacks permissions
  - Response: "❌ You don't have permission to end trivia games."
  - Log: Warning level
- Database error during archive
  - Response: "❌ Game ended but failed to archive. Game state has been cleared."
  - Log: Error level with details
  - Retry: Not automatic, game state already cleared
- Message send failure (final leaderboard)
  - Response: "❌ Game ended but failed to post final leaderboard. Game has been archived."
  - Log: Error level
  - Game still archived despite message failure

---

### `/leaderboard`
**Errors**:
- Invalid timeframe
  - Response: "❌ Invalid timeframe. Use: all-time, month, or year."
  - Log: Info level
- Database query failure
  - Response: "❌ Failed to load leaderboard. Please try again."
  - Log: Error level
  - Retry: User can retry command
- No games played
  - Response: "ℹ️ No games have been played [timeframe] yet."
  - Log: Info level (not an error)

---

### `/my-trivia-history`
**Errors**:
- Database query failure
  - Response: "❌ Failed to load your history. Please try again."
  - Log: Error level
  - Retry: User can retry command
- User has never played
  - Response: "ℹ️ You haven't played any trivia games yet."
  - Log: Info level (not an error)

---

### `/final-wager`
**Errors**:
- No active game
  - Response: "❌ No active trivia game."
  - Log: Info level
- Not in wagering phase
  - Response: "❌ Wagering phase is not active."
  - Log: Info level
- Invalid amount
  - Response: "❌ Invalid wager amount. You can wager between $1 and $[max]."
  - Log: Info level
- Already wagered
  - Response: "❌ You have already placed your wager."
  - Log: Info level
- Non-integer amount
  - Response: "❌ Wager must be a whole number."
  - Log: Info level

---

### `/final-guess`
**Errors**:
- No active game
  - Response: "❌ No active trivia game."
  - Log: Info level
- Not in answering phase
  - Response: "❌ Answering phase is not active."
  - Log: Info level
- No wager placed
  - Response: "❌ You must place a wager first using `/final-wager`."
  - Log: Info level
- Already answered
  - Response: "❌ You have already submitted your answer."
  - Log: Info level
- Empty answer
  - Response: "❌ Answer cannot be empty."
  - Log: Info level

---

## Game Flow Error Handling

### Bot Restart During Game
**Scenario**: Bot crashes or restarts while game is active

**Current Behavior**:
- Game state is lost (stored in memory)
- Game cannot be resumed
- New game can be started

**Future Enhancement**:
- Persist game state to database periodically
- On restart, check for active games and allow resume/abandon

**Handling**:
- Log warning when game state is lost
- Allow `/start-trivia` to work (clears old state)
- Notify users if they try to interact with non-existent game

---

### Database Error During Archive
**Scenario**: Game completes but fails to save to database

**Handling**:
1. Log error with full game data
2. Attempt retry (3 attempts with exponential backoff)
3. If all retries fail:
   - Log critical error
   - Store game data in error log file
   - Notify admin (if notification system exists)
   - Still clear in-memory state (can't keep game state forever)

**User Experience**:
- Game completes normally
- Final leaderboard shown
- If archive fails, users don't see error (handled silently)
- Game may not appear in history (known limitation)

---

### Message Send Failures
**Scenario**: Bot cannot send message to channel

**Handling**:
- Check bot permissions before starting game
- If message fails during game:
  - Log error
  - Attempt retry (2-3 attempts)
  - If still fails, pause game and notify admin
  - Game state preserved for potential recovery

---

### Timer Failures
**Scenario**: Timer doesn't fire or fires incorrectly

**Handling**:
- Use reliable timer mechanism (Node.js timers with error handling)
- Log timer events for debugging
- If timer fails:
  - Fallback: Check time elapsed manually
  - Force transition to next state
  - Log error for investigation

---

## Edge Cases

### No Players Participate
**Scenario**: Game starts but no one answers any questions

**Handling**:
- Game still runs through all questions
- Leaderboard shows "No players have participated yet"
- Game still archived (with zero participants)
- Final leaderboard shows empty or "No participants"

---

### All Questions Answered Immediately
**Scenario**: Every question gets answered correctly within 1 second

**Handling**:
- Still wait full 30 seconds before posting correct answer
- Or: If question answered, wait 5 seconds then move on (TBD)
- Current spec: Wait full 30 seconds regardless

---

### Multiple Simultaneous Correct Answers
**Scenario**: Two players answer correctly at exact same timestamp

**Handling**:
- Award points to all players with identical timestamps
- Post message: "✅ @Player1 and @Player2 got it! +$200 each"
- Update leaderboard accordingly

---

### Player Leaves Server During Game
**Scenario**: Player participates, then leaves Discord server

**Handling**:
- Keep their participation in game state
- Use stored username for leaderboard
- Archive with user_id (may be invalid, but preserved)
- Leaderboard shows their username as stored

---

### Channel Deleted During Game
**Scenario**: Trivia channel is deleted while game is active

**Handling**:
- Detect channel deletion (Discord event)
- Pause game
- Log error
- Notify admin
- Game state preserved (can't continue without channel)

---

### Insufficient Questions in Database
**Scenario**: Not enough questions of specific round in database

**Handling**:
- Check before starting game
- If insufficient: Error message, don't start game
- Minimum required:
  - 10 Round 1 questions
  - 10 Round 2 questions
  - 1 Final Jeopardy question

---

### Answer Validation Edge Cases

**Empty/Whitespace Answers**:
- Ignore empty messages
- Ignore messages with only whitespace
- Ignore messages with only common words ("the", "a", "an")

**Very Long Answers**:
- Limit answer length (e.g., 500 characters)
- Truncate for display if needed
- Still validate full answer

**Special Characters**:
- Handle Unicode characters
- Handle emojis (strip or ignore)
- Handle markdown/formatting (strip for validation)

---

### Final Jeopardy Edge Cases

**Player Wagers $0**:
- Not allowed (minimum $1)
- Error message: "Minimum wager is $1"

**Player Wagers More Than Score**:
- Not allowed
- Error message: "You can wager up to $[current_score]"

**Player with $0 Score Wagers $2001**:
- Not allowed
- Error message: "You can wager up to $2,000"

**Player Doesn't Answer Final Jeopardy**:
- Treated as incorrect
- Lose wager amount
- Final score = current_score - wager

**No One Wagers**:
- Skip to final leaderboard
- Still show Final Jeopardy question and answer
- Archive game normally

---

## Logging Strategy

### Log Levels
- **Error**: Critical failures, database errors, unexpected exceptions
- **Warning**: Recoverable issues, missing data, permission problems
- **Info**: Game events, command usage, state transitions
- **Debug**: Detailed flow, answer validation, timer events

### What to Log
- All command executions (user, command, parameters)
- Game state transitions
- Answer validations (correct/incorrect)
- Database operations (queries, inserts, updates)
- Errors with full context (stack traces, game state)
- Timer events (start, end, failures)

### Log Format
```
[Timestamp] [Level] [Component] Message
[Context data if applicable]
```

Example:
```
[2026-01-09 11:30:45] [INFO] [GameManager] Game started: game_12345
[2026-01-09 11:30:50] [INFO] [AnswerValidator] Answer validated: correct
  User: 123456789, Question: 42, Answer: "Paris"
[2026-01-09 11:31:15] [ERROR] [Database] Failed to archive game: game_12345
  Error: Connection timeout
```

---

## Recovery Strategies

### Game State Recovery
- **Current**: None (in-memory only)
- **Future**: Periodic saves to database, resume capability

### Database Recovery
- Retry failed operations (3 attempts)
- Exponential backoff between retries
- Log failures for manual recovery

### Message Recovery
- Retry failed sends (2-3 attempts)
- If channel unavailable, pause game
- Notify admin of persistent issues

---

## Testing Considerations

### Error Scenarios to Test
1. Bot restart during active game
2. Database connection loss during archive
3. Channel deletion during game
4. Invalid command parameters
5. Permission errors
6. Timer failures
7. Message send failures
8. Answer validation edge cases
9. Final Jeopardy edge cases
10. Concurrent command execution

### Test Data Needed
- Questions with various answer formats
- Edge case answers (parentheses, special chars, etc.)
- Simulated database failures
- Simulated network issues
