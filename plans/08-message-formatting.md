# Message Formatting & UI

## Message Types

### 1. Game Rules Message
**When**: At the start of every new game

**Format**:
```
🎮 Welcome to Trivia Creep!
━━━━━━━━━━━━━━━━━━━━━━━━
Rules:
• 20 questions + 1 Final Jeopardy
• Answer in chat (no need to phrase as question)
• First correct answer wins the points
• 30 seconds per question
• 5 second break between questions
• 30 second break between rounds
• Final Jeopardy: Wager first, then answer

Let's begin!
```

**Style**: Embed with blue color, title, description

---

### 2. Question Message
**When**: Before each question in Rounds 1 & 2

**Format**:
```
━━━━━━━━━━━━━━━━━━━━━━━━
Round 1 - Question 1 of 10
Category: HISTORY
Value: $200
━━━━━━━━━━━━━━━━━━━━━━━━

[Question text]

⏱️ 30 seconds to answer
```

**Style**: Embed with category color (optional), clear formatting

---

### 3. Leaderboard Message (During Game)
**When**: Before questions, after correct answers, between rounds

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

**Style**: Embed or formatted text block

---

### 4. Correct Answer Message
**When**: First correct answer in Rounds 1 & 2

**Format**:
```
✅ @PlayerName got it! +$200

━━━━━━━━━━━━━━━━━━━━━━━━
📊 Updated Leaderboard
━━━━━━━━━━━━━━━━━━━━━━━━
1. @PlayerName - $5,400
2. @Player1 - $5,200
3. @Player2 - $3,800
...
```

**Style**: Success message with updated leaderboard

---

### 5. Time's Up Message
**When**: 30 seconds elapse without correct answer

**Format**:
```
⏰ Time's up!

Correct answer: [answer]

Moving to next question...
```

**Style**: Info message

---

### 6. Round Break Message
**When**: Between Round 1 and Round 2

**Format**:
```
━━━━━━━━━━━━━━━━━━━━━━━━
Round 1 Complete!
━━━━━━━━━━━━━━━━━━━━━━━━

📊 Final Round 1 Leaderboard:
1. @Player1 - $8,500
2. @Player2 - $6,200
3. @Player3 - $4,100
...

Round 2 starting in 30 seconds...
```

**Style**: Embed with round summary

---

### 7. Final Jeopardy Category Message
**When**: Start of Final Jeopardy wagering phase

**Format**:
```
━━━━━━━━━━━━━━━━━━━━━━━━
🎯 FINAL JEOPARDY
━━━━━━━━━━━━━━━━━━━━━━━━
Category: [Category Name]

📊 Current Leaderboard:
1. @Player1 - $12,000
2. @Player2 - $8,500
3. @Player3 - $5,200
4. @Player4 - $0

💰 You have 30 seconds to place your wager using /final-wager
```

**Style**: Embed with special Final Jeopardy styling (gold color?)

---

### 8. Final Jeopardy Question Message
**When**: Start of Final Jeopardy answering phase

**Format**:
```
━━━━━━━━━━━━━━━━━━━━━━━━
🎯 FINAL JEOPARDY
━━━━━━━━━━━━━━━━━━━━━━━━
Category: [Category Name]

[Question text]

Submit your answer using /final-guess
You have 30 seconds.
```

**Style**: Embed with question prominently displayed

---

### 9. Final Jeopardy Results Message
**When**: After answering phase ends

**Format**:
```
━━━━━━━━━━━━━━━━━━━━━━━━
🎯 FINAL JEOPARDY RESULTS
━━━━━━━━━━━━━━━━━━━━━━━━
Correct Answer: [answer]

@Player1: "[answer]" ✅ +$5,000 → $17,000
@Player2: "[answer]" ❌ -$3,000 → $5,500
@Player3: "[answer]" ✅ +$2,000 → $7,200
@Player4: "[answer]" ❌ -$1,500 → -$1,500
```

**Style**: Embed showing individual results

---

### 10. Final Leaderboard Message
**When**: After Final Jeopardy results

**Format**:
```
━━━━━━━━━━━━━━━━━━━━━━━━
🏆 FINAL LEADERBOARD
━━━━━━━━━━━━━━━━━━━━━━━━
1. 🥇 @Player1 - $17,000
2. 🥈 @Player3 - $7,200
3. 🥉 @Player2 - $5,500
4. @Player4 - -$1,500

Game complete! Thanks for playing!
```

**Style**: Embed with winner highlighting

---

## Discord Embed Design

### Color Scheme
- **Game Rules**: Blue (#0099FF)
- **Questions**: Purple (#9B59B6)
- **Leaderboard**: Green (#2ECC71)
- **Correct Answer**: Gold (#FFD700)
- **Time's Up**: Orange (#FF9500)
- **Final Jeopardy**: Gold (#FFD700)
- **Final Results**: Gold (#FFD700)
- **Errors**: Red (#E74C3C)

### Embed Structure Template
```typescript
{
  title: "[Title]",
  description: "[Description]",
  color: [color code],
  fields: [
    // Optional fields for structured data
  ],
  footer: {
    text: "[Optional footer]"
  },
  timestamp: new Date().toISOString() // Optional
}
```

---

## Ephemeral Messages

### Commands with Ephemeral Responses
- `/final-wager` - Confirmation (private)
- `/final-guess` - Confirmation (private)
- `/my-trivia-history` - User's stats (private)

### Public Responses
- `/config` - Public confirmation
- `/start-trivia` - Public game start
- `/leaderboard` - Public leaderboard

---

## Formatting Helpers

### Currency Formatting
```typescript
function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString()}`;
}
// Examples: $1,200, $0, -$500
```

### Leaderboard Formatting
```typescript
function formatLeaderboard(players: PlayerState[], limit: number = 10): string {
  return players
    .slice(0, limit)
    .map((player, index) => `${index + 1}. @${player.username} - ${formatCurrency(player.score)}`)
    .join('\n');
}
```

### Question Number Formatting
```typescript
function formatQuestionNumber(round: number, questionIndex: number): string {
  const roundName = round === 1 ? 'Round 1' : 'Round 2';
  const questionNum = questionIndex + 1;
  return `${roundName} - Question ${questionNum} of 10`;
}
```

---

## Error Messages

### Format
```
❌ [Error Title]

[Error description]

[Optional: How to fix]
```

### Examples
```
❌ Trivia Channel Not Configured

No trivia channel has been set up for this server.

Use `/config` to configure a channel for trivia games.
```

```
❌ Game Already in Progress

A trivia game is already active.

Please wait for the current game to finish before starting a new one.
```

```
❌ Invalid Wager Amount

You can wager between $1 and $12,000.

Your current score: $12,000
```

---

## Timing Indicators

### Optional Countdown Messages
- 10 seconds remaining: "⏱️ 10 seconds remaining!"
- 5 seconds remaining: "⏱️ 5 seconds remaining!"

### Break Countdown
- "Round 2 starting in 30 seconds..."
- "Round 2 starting in 10 seconds..."
- "Round 2 starting in 5... 4... 3... 2... 1..."

---

## Accessibility Considerations

- Use clear, readable fonts
- High contrast colors
- Emoji for visual indicators (but not required for understanding)
- Clear structure with separators (━━━━━━━━━━━━━━━━━━━━━━━━)
- Consistent formatting across messages
