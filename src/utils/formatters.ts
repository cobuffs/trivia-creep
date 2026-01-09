import { EmbedBuilder, ColorResolvable } from 'discord.js';

/**
 * Format currency amount as dollar string
 */
export function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString()}`;
}

/**
 * Format question number display
 */
export function formatQuestionNumber(round: number, questionIndex: number): string {
  const roundName = round === 1 ? 'Round 1' : 'Round 2';
  const questionNum = questionIndex + 1;
  return `${roundName} - Question ${questionNum} of 10`;
}

/**
 * Format leaderboard entries for display
 */
export function formatLeaderboard(
  entries: Array<{ username: string; score: number }>,
  limit: number = 10
): string {
  if (entries.length === 0) {
    return 'No players have participated yet.';
  }

  return entries
    .slice(0, limit)
    .map((entry, index) => `${index + 1}. @${entry.username} - ${formatCurrency(entry.score)}`)
    .join('\n');
}

/**
 * Create embed for game rules
 */
export function createRulesEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('🎮 Welcome to Trivia Creep!')
    .setDescription(
      '**Rules:**\n' +
      '• 20 questions + 1 Final Jeopardy\n' +
      '• Answer in chat (no need to phrase as question)\n' +
      '• First correct answer wins the points\n' +
      '• 30 seconds per question\n' +
      '• 5 second break between questions\n' +
      '• 30 second break between rounds\n' +
      '• Final Jeopardy: Wager first, then answer\n\n' +
      'We\'ll begin in 30 seconds!'
    )
    .setColor(0x0099FF)
    .setTimestamp();
}

/**
 * Create embed for question display
 */
export function createQuestionEmbed(
  round: number,
  questionIndex: number,
  category: string,
  dollarAmount: number,
  question: string
): EmbedBuilder {
  const roundName = round === 1 ? 'Round 1' : 'Round 2';
  const questionNum = questionIndex + 1;

  return new EmbedBuilder()
    .setTitle(`${roundName} - Question ${questionNum} of 10`)
    .addFields(
      { name: 'Category', value: category, inline: true },
      { name: 'Value', value: formatCurrency(dollarAmount), inline: true }
    )
    .setDescription(question)
    .setFooter({ text: '⏱️ 30 seconds to answer' })
    .setColor(0x9B59B6)
    .setTimestamp();
}

/**
 * Create embed for leaderboard display
 */
export function createLeaderboardEmbed(
  entries: Array<{ username: string; score: number }>,
  title: string = '📊 Current Leaderboard',
  color: ColorResolvable = 0x2ECC71
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setTimestamp();

  if (entries.length === 0) {
    embed.setDescription('No players have participated yet.');
    return embed;
  }

  const leaderboardText = entries
    .slice(0, 10)
    .map((entry, index) => `${index + 1}. @${entry.username} - ${formatCurrency(entry.score)}`)
    .join('\n');

  embed.setDescription(leaderboardText);
  return embed;
}

/**
 * Create embed for correct answer message
 */
export function createCorrectAnswerEmbed(
  username: string,
  dollarAmount: number
): EmbedBuilder {
  return new EmbedBuilder()
    .setDescription(`✅ @${username} got it! +${formatCurrency(dollarAmount)}`)
    .setColor(0xFFD700)
    .setTimestamp();
}

/**
 * Create embed for time's up message
 */
export function createTimesUpEmbed(correctAnswer: string): EmbedBuilder {
  return new EmbedBuilder()
    .setDescription(`⏰ Time's up!\n\n**Correct answer:** ${correctAnswer}\n\nMoving to next question...`)
    .setColor(0xFF9500)
    .setTimestamp();
}

/**
 * Create embed for round break
 */
export function createRoundBreakEmbed(
  round: number,
  leaderboard: Array<{ username: string; score: number }>
): EmbedBuilder {
  const roundName = round === 1 ? 'Round 1' : 'Round 2';
  const nextRound = round === 1 ? 'Round 2' : 'Final Jeopardy';

  return new EmbedBuilder()
    .setTitle(`${roundName} Complete!`)
    .addFields({
      name: `📊 Final ${roundName} Leaderboard:`,
      value: formatLeaderboard(leaderboard)
    })
    .setDescription(`${nextRound} starting in 30 seconds...`)
    .setColor(0x0099FF)
    .setTimestamp();
}

/**
 * Create embed for Final Jeopardy category
 */
export function createFinalJeopardyCategoryEmbed(
  category: string,
  leaderboard: Array<{ username: string; score: number }>
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('🎯 FINAL JEOPARDY')
    .addFields(
      { name: 'Category', value: category, inline: false },
      {
        name: '📊 Current Leaderboard:',
        value: formatLeaderboard(leaderboard)
      }
    )
    .setDescription('💰 You have 30 seconds to place your wager using `/final-wager`')
    .setColor(0xFFD700)
    .setTimestamp();
}

/**
 * Create embed for Final Jeopardy question
 */
export function createFinalJeopardyQuestionEmbed(category: string, question: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('🎯 FINAL JEOPARDY')
    .addFields({ name: 'Category', value: category, inline: false })
    .setDescription(question)
    .setFooter({ text: 'Submit your answer using /final-guess\nYou have 30 seconds.' })
    .setColor(0xFFD700)
    .setTimestamp();
}

/**
 * Create embed for Final Jeopardy results
 */
export function createFinalJeopardyResultsEmbed(
  correctAnswer: string,
  results: Array<{
    username: string;
    answer: string;
    correct: boolean;
    wager: number;
    finalScore: number;
  }>
): EmbedBuilder {
  const resultsText = results
    .map(result => {
      const icon = result.correct ? '✅' : '❌';
      const change = result.correct ? `+${formatCurrency(result.wager)}` : `-${formatCurrency(result.wager)}`;
      return `${icon} @${result.username}: "${result.answer}" ${change} → ${formatCurrency(result.finalScore)}`;
    })
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle('🎯 FINAL JEOPARDY RESULTS')
    .addFields({ name: 'Correct Answer', value: correctAnswer, inline: false })
    .setColor(0xFFD700)
    .setTimestamp();

  // Only set description if there are results (Discord.js requires non-empty string or null)
  if (resultsText && resultsText.length > 0) {
    embed.setDescription(resultsText);
  } else {
    embed.setDescription('No players participated in Final Jeopardy.');
  }

  return embed;
}

/**
 * Create embed for final leaderboard
 */
export function createFinalLeaderboardEmbed(
  entries: Array<{ username: string; score: number }>
): EmbedBuilder {
  const medals = ['🥇', '🥈', '🥉'];
  const leaderboardText = entries
    .slice(0, 10)
    .map((entry, index) => {
      const medal = index < 3 ? `${medals[index]} ` : '';
      return `${medal}${index + 1}. @${entry.username} - ${formatCurrency(entry.score)}`;
    })
    .join('\n');

  return new EmbedBuilder()
    .setTitle('🏆 FINAL LEADERBOARD')
    .setDescription(leaderboardText || 'No participants')
    .setFooter({ text: 'Game complete! Thanks for playing!' })
    .setColor(0xFFD700)
    .setTimestamp();
}

/**
 * Create embed for error message
 */
export function createErrorEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`❌ ${title}`)
    .setDescription(description)
    .setColor(0xE74C3C)
    .setTimestamp();
}

/**
 * Create embed for info message
 */
export function createInfoEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`ℹ️ ${title}`)
    .setDescription(description)
    .setColor(0x3498DB)
    .setTimestamp();
}

/**
 * Create embed for success message
 */
export function createSuccessEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`✅ ${title}`)
    .setDescription(description)
    .setColor(0x2ECC71)
    .setTimestamp();
}

/**
 * Create embed for historical leaderboard
 */
export function createHistoricalLeaderboardEmbed(
  entries: Array<{ username: string; totalScore: number; gamesPlayed: number }>,
  timeframe: 'all-time' | 'month' | 'year'
): EmbedBuilder {
  const timeframeNames = {
    'all-time': 'All-Time',
    'month': 'Monthly',
    'year': 'Yearly'
  };

  const title = `🏆 ${timeframeNames[timeframe]} Leaderboard`;
  const color = timeframe === 'all-time' ? 0xFFD700 : timeframe === 'month' ? 0xC0C0C0 : 0xCD7F32;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setTimestamp();

  if (entries.length === 0) {
    embed.setDescription(`No games have been played ${timeframe === 'all-time' ? 'yet' : `this ${timeframe}`}.`);
    return embed;
  }

  const leaderboardText = entries
    .slice(0, 10)
    .map((entry, index) => 
      `${index + 1}. @${entry.username} - ${formatCurrency(entry.totalScore)} (${entry.gamesPlayed} game${entry.gamesPlayed !== 1 ? 's' : ''})`
    )
    .join('\n');

  embed.setDescription(leaderboardText);
  return embed;
}

/**
 * Create embed for player history
 */
export function createPlayerHistoryEmbed(
  totalGames: number,
  totalScore: number,
  bestScore: number,
  averageScore: number,
  gamesThisMonth: number,
  gamesThisYear: number
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('📊 Your Trivia History')
    .addFields(
      { name: 'Total Games', value: totalGames.toString(), inline: true },
      { name: 'All-Time Score', value: formatCurrency(totalScore), inline: true },
      { name: 'Best Score', value: formatCurrency(bestScore), inline: true },
      { name: 'Average Score', value: formatCurrency(averageScore), inline: true },
      { name: 'This Month', value: `${gamesThisMonth} game${gamesThisMonth !== 1 ? 's' : ''}`, inline: true },
      { name: 'This Year', value: `${gamesThisYear} game${gamesThisYear !== 1 ? 's' : ''}`, inline: true }
    )
    .setColor(0x3498DB)
    .setTimestamp();
}

/**
 * Create embed for bot overview and commands
 */
export function createBotOverviewEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('🎮 Welcome to Trivia Creep!')
    .setDescription(
      'A Discord trivia bot featuring Jeopardy-style questions from j-archive.com.\n\n' +
      '**How it works:**\n' +
      '• Play Jeopardy-style trivia games with 20 questions + Final Jeopardy\n' +
      '• Answer questions in chat (do not phrase as a question)\n' +
      '• First correct answer wins the points\n' +
      '• Track your scores and compete on leaderboards\n\n' +
      '**Game Format:**\n' +
      '• Round 1: 10 Jeopardy! questions\n' +
      '• Round 2: 10 Double Jeopardy! questions\n' +
      '• Final Jeopardy: 1 final question with wagering\n\n' +
      '**Timing:**\n' +
      '• 30 seconds per question\n' +
      '• 5 second break between questions\n' +
      '• 30 second break between rounds'
    )
    .addFields(
      {
        name: '📋 Commands',
        value:
          '**`/start-trivia`** - Start a new trivia game\n' +
          '**`/end-trivia`** - End the current game early (Admin only)\n' +
          '**`/leaderboard`** - View leaderboard statistics\n' +
          '**`/my-trivia-history`** - View your personal statistics\n' +
          '**`/final-wager`** - Place a wager for Final Jeopardy\n' +
          '**`/final-guess`** - Submit your Final Jeopardy answer\n' +
          '**`/config`** - Configure trivia channel (Admin only)',
        inline: false
      }
    )
    .setFooter({ text: 'Ready to play? Use /start-trivia to begin!' })
    .setColor(0x0099FF)
    .setTimestamp();
}
