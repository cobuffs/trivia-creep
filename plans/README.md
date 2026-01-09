# Trivia Creep Bot - Planning Documents

This directory contains planning documents for the Discord trivia bot functionality.

## Document Overview

1. **[01-architecture-overview.md](./01-architecture-overview.md)**
   - High-level system design
   - Component structure
   - Data flow

2. **[02-database-schema.md](./02-database-schema.md)**
   - Database tables needed
   - Schema definitions
   - Query patterns

3. **[03-slash-commands.md](./03-slash-commands.md)**
   - Detailed specifications for each slash command
   - Options, behavior, error cases
   - Response formats

4. **[04-game-flow.md](./04-game-flow.md)**
   - Game state machine
   - Question flow
   - Timing and transitions
   - In-memory state structure

5. **[05-answer-validation.md](./05-answer-validation.md)**
   - Answer matching rules
   - Validation logic
   - Edge cases
   - Implementation approach

6. **[06-leaderboard-system.md](./06-leaderboard-system.md)**
   - Leaderboard types (all-time, month, year, per-game)
   - Display logic
   - Performance considerations
   - Query patterns

7. **[07-final-jeopardy.md](./07-final-jeopardy.md)**
   - Wagering phase
   - Answering phase
   - Results calculation
   - Edge cases

8. **[08-message-formatting.md](./08-message-formatting.md)**
   - Message types and formats
   - Discord embed design
   - Formatting helpers
   - Error messages

9. **[09-error-handling.md](./09-error-handling.md)**
   - Error scenarios
   - Edge cases
   - Recovery strategies
   - Logging approach

## Implementation Order Suggestion

1. **Database Schema** (02)
   - Create new tables
   - Set up indexes
   - Test queries

2. **Answer Validation** (05)
   - Core validation logic
   - Unit tests
   - Edge case handling

3. **Slash Commands - Basic** (03)
   - `/config`
   - `/leaderboard` (basic)
   - `/my-trivia-history`

4. **Game Flow - Core** (04)
   - Game state management
   - Question flow (Rounds 1 & 2)
   - Message monitoring
   - Basic leaderboard display

5. **Final Jeopardy** (07)
   - Wagering phase
   - Answering phase
   - Results calculation

6. **Message Formatting** (08)
   - Polish all messages
   - Embed design
   - Error messages

7. **Error Handling** (09)
   - Comprehensive error handling
   - Logging
   - Recovery strategies

8. **Leaderboard System** (06)
   - All-time, month, year queries
   - Performance optimization
   - Caching strategy

## Key Decisions Made

### Answer Validation
- Case-insensitive
- Ignore common words ("the", "a", "an")
- Handle parenthetical content: "(Tom) Hanks" accepts both "Tom Hanks" and "Hanks"
- Handle common variations (& ↔ and, etc.)
- No penalty for wrong answers in Rounds 1 & 2

### Scoring
- First correct answer wins points in Rounds 1 & 2
- All correct answers get points in Final Jeopardy
- Final Jeopardy: Correct = +wager, Incorrect = -wager
- Minimum wager: $1
- Maximum wager: Current score (or $2,000 if score is $0)

### Game Flow
- 30 seconds per question
- 5 second break between questions
- 30 second break between rounds
- Only one active game at a time
- Game state in memory (archived after completion)

### Leaderboards
- Per-game leaderboard shown during game
- All-time, monthly, yearly via `/leaderboard` command
- Personal history via `/my-trivia-history`
- Top 10 players displayed (configurable)

## Open Questions / Future Enhancements

- Bot restart recovery (persist game state to database)
- Fuzzy matching for typos
- Synonym matching
- Admin commands (abandon game, etc.)
- Game statistics and analytics
- Customizable question counts
- Different game modes
- Team play support
