# Architecture Overview

## System Components

### Core Services
1. **Discord Bot Service** - Handles Discord API interactions, slash commands, message monitoring
2. **Trivia Game Manager** - Manages active game state, question flow, timing
3. **Answer Validator** - Validates player answers against correct answers
4. **Leaderboard Service** - Calculates and formats leaderboards
5. **Database Service** - Handles all database operations (questions, games, players, scores)

### State Management
- **In-Memory Game State**: Active game data (current question, players, scores, timers)
- **Database**: Persistent storage for questions, game history, player statistics

## Data Flow

### Starting a Game
1. User executes `/start-trivia` command
2. Bot validates no active game exists
3. Bot queries database for 10 Round 1 questions, 10 Round 2 questions, 1 Final Jeopardy question
4. Bot initializes in-memory game state
5. Bot posts game rules and begins Round 1

### During a Question
1. Bot displays current leaderboard
2. Bot posts question with category and dollar amount
3. Bot monitors channel messages for 30 seconds
4. Bot validates answers in real-time
5. First correct answer awards points and updates leaderboard
6. If no correct answers have been given in 30 seconds, bot posts correct answer and moves to next question

### Final Jeopardy
1. Bot posts category
2. 30-second wagering phase (players use `/final-wager`)
3. Bot posts question
4. 30-second answering phase (players use `/final-guess`)
5. Bot calculates final scores
6. Bot archives game to database
7. Bot posts final leaderboard

## Key Constraints
- Only one active trivia game at a time
- Game state stored in memory (except final archival)
- Questions retrieved from database before game starts
- All game data archived to database after completion
