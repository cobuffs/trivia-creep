import * as sql from 'mssql';
import dotenv from 'dotenv';
import { Question } from '../../helper-scripts/types';

dotenv.config();

// Database connection pool
let pool: sql.ConnectionPool | null = null;

async function connect(): Promise<void> {
  if (pool) {
    return;
  }

  const config: sql.config = {
    user: process.env.MSSQL_USER,
    password: process.env.MSSQL_PASSWORD,
    server: process.env.MSSQL_SERVER || 'localhost',
    database: process.env.MSSQL_DATABASE || 'triviacreep',
    port: parseInt(process.env.MSSQL_PORT || '1433', 10),
    options: {
      encrypt: true,
      trustServerCertificate: true,
      enableArithAbort: true
    }
  };

  try {
    pool = await sql.connect(config);
    console.log('Connected to MSSQL database');
  } catch (error) {
    console.error('Database connection error:', error);
    throw error;
  }
}

async function closeConnection(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
    console.log('Database connection closed');
  }
}

function getConnection(): sql.ConnectionPool {
  if (!pool) {
    throw new Error('Database not connected. Call connect() first.');
  }
  return pool;
}

// Types for bot-specific data
export interface GuildConfig {
  guildId: string;
  triviaChannelId: string | null;
  requiredRoleId: string | null;
  updatedAt: Date;
}

export interface TriviaGame {
  gameId: number;
  guildId: string;
  channelId: string;
  startedAt: Date;
  completedAt: Date;
  status: 'completed' | 'abandoned';
  round1Questions: number[];
  round2Questions: number[];
  finalQuestionId: number | null;
}

export interface GamePlayer {
  gamePlayerId: number;
  gameId: number;
  userId: string;
  username: string;
  finalScore: number;
  round1Score: number;
  round2Score: number;
  finalWager: number | null;
  finalCorrect: boolean | null;
  finalScoreChange: number | null;
}

export interface PlayerStatistics {
  userId: string;
  totalGames: number;
  totalScoreAllTime: number;
  bestScore: number;
  lastPlayed: Date | null;
  lastUpdated: Date;
}

export interface LeaderboardEntry {
  userId: string;
  username: string;
  totalScore: number;
  gamesPlayed: number;
}

export class DatabaseService {
  /**
   * Initialize database connection
   */
  async initialize(): Promise<void> {
    await connect();
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await closeConnection();
  }

  // ==================== Guild Config ====================

  /**
   * Get guild configuration
   */
  async getGuildConfig(guildId: string): Promise<GuildConfig | null> {
    const pool = getConnection();
    try {
      const result = await pool
        .request()
        .input('guild_id', sql.NVarChar, guildId)
        .query(`
          SELECT [guild_id], [trivia_channel_id], [required_role_id], [updated_at]
          FROM [dbo].[guild_config]
          WHERE [guild_id] = @guild_id
        `);

      if (result.recordset.length === 0) {
        return null;
      }

      const row = result.recordset[0];
      return {
        guildId: row.guild_id,
        triviaChannelId: row.trivia_channel_id,
        requiredRoleId: row.required_role_id,
        updatedAt: row.updated_at
      };
    } catch (error) {
      console.error('Error getting guild config:', error);
      throw error;
    }
  }

  /**
   * Set guild configuration
   */
  async setGuildConfig(
    guildId: string, 
    triviaChannelId: string | null, 
    requiredRoleId: string | null = null
  ): Promise<void> {
    const pool = getConnection();
    try {
      await pool
        .request()
        .input('guild_id', sql.NVarChar, guildId)
        .input('trivia_channel_id', sql.NVarChar, triviaChannelId)
        .input('required_role_id', sql.NVarChar, requiredRoleId)
        .query(`
          MERGE [dbo].[guild_config] AS target
          USING (SELECT @guild_id AS [guild_id]) AS source
          ON target.[guild_id] = source.[guild_id]
          WHEN MATCHED THEN
            UPDATE SET 
              [trivia_channel_id] = @trivia_channel_id, 
              [required_role_id] = @required_role_id,
              [updated_at] = GETDATE()
          WHEN NOT MATCHED THEN
            INSERT ([guild_id], [trivia_channel_id], [required_role_id], [updated_at])
            VALUES (@guild_id, @trivia_channel_id, @required_role_id, GETDATE());
        `);
    } catch (error) {
      console.error('Error setting guild config:', error);
      throw error;
    }
  }

  // ==================== Questions ====================

  /**
   * Get random questions for a game
   */
  async getRandomQuestions(round: 'Jeopardy!' | 'Double Jeopardy!' | 'Final Jeopardy!', count: number): Promise<Question[]> {
    const pool = getConnection();
    try {
      const result = await pool
        .request()
        .input('round', sql.VarChar, round)
        .input('count', sql.Int, count)
        .query(`
          SELECT TOP (@count) 
            [id], [source], [question], [answer], [category], 
            [dollar_amount], [round], [game_id], [season], 
            [clue_order], [metadata]
          FROM [dbo].[questions]
          WHERE [round] = @round
          ORDER BY NEWID()
        `);

      return result.recordset.map((row: any) => ({
        id: row.id,
        source: row.source,
        question: row.question,
        answer: row.answer,
        category: row.category,
        dollar_amount: row.dollar_amount,
        round: row.round,
        game_id: row.game_id,
        season: row.season,
        clue_order: row.clue_order,
        metadata: row.metadata
      }));
    } catch (error) {
      console.error('Error getting random questions:', error);
      throw error;
    }
  }

  /**
   * Get question by ID
   */
  async getQuestionById(questionId: number): Promise<Question | null> {
    const pool = getConnection();
    try {
      const result = await pool
        .request()
        .input('id', sql.Int, questionId)
        .query(`
          SELECT [id], [source], [question], [answer], [category], 
            [dollar_amount], [round], [game_id], [season], 
            [clue_order], [metadata]
          FROM [dbo].[questions]
          WHERE [id] = @id
        `);

      if (result.recordset.length === 0) {
        return null;
      }

      const row = result.recordset[0];
      return {
        id: row.id,
        source: row.source,
        question: row.question,
        answer: row.answer,
        category: row.category,
        dollar_amount: row.dollar_amount,
        round: row.round,
        game_id: row.game_id,
        season: row.season,
        clue_order: row.clue_order,
        metadata: row.metadata
      };
    } catch (error) {
      console.error('Error getting question by ID:', error);
      throw error;
    }
  }

  // ==================== Games ====================

  /**
   * Archive a completed game
   */
  async archiveGame(
    guildId: string,
    channelId: string,
    startedAt: Date,
    completedAt: Date,
    status: 'completed' | 'abandoned',
    round1QuestionIds: number[],
    round2QuestionIds: number[],
    finalQuestionId: number | null,
    players: Array<{
      userId: string;
      username: string;
      finalScore: number;
      round1Score: number;
      round2Score: number;
      finalWager: number | null;
      finalCorrect: boolean | null;
      finalScoreChange: number | null;
    }>
  ): Promise<number> {
    const pool = getConnection();
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      // Insert game
      const gameRequest = new sql.Request(transaction);
      gameRequest.input('guild_id', sql.NVarChar, guildId);
      gameRequest.input('channel_id', sql.NVarChar, channelId);
      gameRequest.input('started_at', sql.DateTime2, startedAt);
      gameRequest.input('completed_at', sql.DateTime2, completedAt);
      gameRequest.input('status', sql.NVarChar, status);
      gameRequest.input('round1_questions', sql.NVarChar, JSON.stringify(round1QuestionIds));
      gameRequest.input('round2_questions', sql.NVarChar, JSON.stringify(round2QuestionIds));
      gameRequest.input('final_question_id', sql.Int, finalQuestionId);

      const gameResult = await gameRequest.query(`
        INSERT INTO [dbo].[trivia_games] 
        ([guild_id], [channel_id], [started_at], [completed_at], [status], [round1_questions], [round2_questions], [final_question_id])
        OUTPUT INSERTED.[game_id]
        VALUES (@guild_id, @channel_id, @started_at, @completed_at, @status, @round1_questions, @round2_questions, @final_question_id)
      `);

      const gameId = gameResult.recordset[0].game_id;

      // Insert players
      for (const player of players) {
        const playerRequest = new sql.Request(transaction);
        playerRequest.input('game_id', sql.Int, gameId);
        playerRequest.input('user_id', sql.NVarChar, player.userId);
        playerRequest.input('username', sql.NVarChar, player.username);
        playerRequest.input('final_score', sql.Int, player.finalScore);
        playerRequest.input('round1_score', sql.Int, player.round1Score);
        playerRequest.input('round2_score', sql.Int, player.round2Score);
        playerRequest.input('final_wager', sql.Int, player.finalWager);
        playerRequest.input('final_correct', sql.Bit, player.finalCorrect);
        playerRequest.input('final_score_change', sql.Int, player.finalScoreChange);

        await playerRequest.query(`
          INSERT INTO [dbo].[game_players]
          ([game_id], [user_id], [username], [final_score], [round1_score], [round2_score], [final_wager], [final_correct], [final_score_change])
          VALUES (@game_id, @user_id, @username, @final_score, @round1_score, @round2_score, @final_wager, @final_correct, @final_score_change)
        `);
      }

      // Update player statistics
      for (const player of players) {
        const statsRequest = new sql.Request(transaction);
        statsRequest.input('user_id', sql.NVarChar, player.userId);
        statsRequest.input('final_score', sql.Int, player.finalScore);
        statsRequest.input('completed_at', sql.DateTime2, completedAt);

        await statsRequest.query(`
          MERGE [dbo].[player_statistics] AS target
          USING (SELECT @user_id AS [user_id], @final_score AS [final_score], @completed_at AS [completed_at]) AS source
          ON target.[user_id] = source.[user_id]
          WHEN MATCHED THEN
            UPDATE SET 
              [total_games] = [total_games] + 1,
              [total_score_all_time] = [total_score_all_time] + @final_score,
              [best_score] = CASE WHEN @final_score > [best_score] THEN @final_score ELSE [best_score] END,
              [last_played] = @completed_at,
              [last_updated] = GETDATE()
          WHEN NOT MATCHED THEN
            INSERT ([user_id], [total_games], [total_score_all_time], [best_score], [last_played], [last_updated])
            VALUES (@user_id, 1, @final_score, @final_score, @completed_at, GETDATE());
        `);
      }

      await transaction.commit();
      return gameId;
    } catch (error) {
      await transaction.rollback();
      console.error('Error archiving game:', error);
      throw error;
    }
  }

  // ==================== Leaderboards ====================

  /**
   * Get leaderboard entries
   */
  async getLeaderboard(timeframe: 'all-time' | 'month' | 'year', limit: number = 10): Promise<LeaderboardEntry[]> {
    const pool = getConnection();
    try {
      let dateFilter = '';
      if (timeframe === 'month') {
        dateFilter = `AND YEAR(tg.[completed_at]) = YEAR(GETDATE()) AND MONTH(tg.[completed_at]) = MONTH(GETDATE())`;
      } else if (timeframe === 'year') {
        dateFilter = `AND YEAR(tg.[completed_at]) = YEAR(GETDATE())`;
      }

      const result = await pool
        .request()
        .input('limit', sql.Int, limit)
        .query(`
          SELECT TOP (@limit)
            gp.[user_id],
            MAX(gp.[username]) AS [username],
            SUM(gp.[final_score]) AS [total_score],
            COUNT(*) AS [games_played]
          FROM [dbo].[game_players] gp
          INNER JOIN [dbo].[trivia_games] tg ON gp.[game_id] = tg.[game_id]
          WHERE 1=1 ${dateFilter}
          GROUP BY gp.[user_id]
          ORDER BY [total_score] DESC
        `);

      return result.recordset.map((row: any) => ({
        userId: row.user_id,
        username: row.username,
        totalScore: row.total_score,
        gamesPlayed: row.games_played
      }));
    } catch (error) {
      console.error('Error getting leaderboard:', error);
      throw error;
    }
  }

  /**
   * Get player statistics
   */
  async getPlayerStatistics(userId: string): Promise<PlayerStatistics | null> {
    const pool = getConnection();
    try {
      const result = await pool
        .request()
        .input('user_id', sql.NVarChar, userId)
        .query(`
          SELECT [user_id], [total_games], [total_score_all_time], [best_score], [last_played], [last_updated]
          FROM [dbo].[player_statistics]
          WHERE [user_id] = @user_id
        `);

      if (result.recordset.length === 0) {
        return null;
      }

      const row = result.recordset[0];
      return {
        userId: row.user_id,
        totalGames: row.total_games,
        totalScoreAllTime: row.total_score_all_time,
        bestScore: row.best_score,
        lastPlayed: row.last_played,
        lastUpdated: row.last_updated
      };
    } catch (error) {
      console.error('Error getting player statistics:', error);
      throw error;
    }
  }

  /**
   * Get player game history
   */
  async getPlayerGameHistory(userId: string): Promise<Array<{
    gameId: number;
    finalScore: number;
    completedAt: Date;
    status: string;
  }>> {
    const pool = getConnection();
    try {
      const result = await pool
        .request()
        .input('user_id', sql.NVarChar, userId)
        .query(`
          SELECT 
            gp.[game_id],
            gp.[final_score],
            tg.[completed_at],
            tg.[status]
          FROM [dbo].[game_players] gp
          INNER JOIN [dbo].[trivia_games] tg ON gp.[game_id] = tg.[game_id]
          WHERE gp.[user_id] = @user_id
          ORDER BY tg.[completed_at] DESC
        `);

      return result.recordset.map((row: any) => ({
        gameId: row.game_id,
        finalScore: row.final_score,
        completedAt: row.completed_at,
        status: row.status
      }));
    } catch (error) {
      console.error('Error getting player game history:', error);
      throw error;
    }
  }

  /**
   * Get player games count by timeframe
   */
  async getPlayerGamesCount(userId: string, timeframe: 'month' | 'year'): Promise<number> {
    const pool = getConnection();
    try {
      let dateFilter = '';
      if (timeframe === 'month') {
        dateFilter = `AND YEAR(tg.[completed_at]) = YEAR(GETDATE()) AND MONTH(tg.[completed_at]) = MONTH(GETDATE())`;
      } else if (timeframe === 'year') {
        dateFilter = `AND YEAR(tg.[completed_at]) = YEAR(GETDATE())`;
      }

      const result = await pool
        .request()
        .input('user_id', sql.NVarChar, userId)
        .query(`
          SELECT COUNT(*) AS [count]
          FROM [dbo].[game_players] gp
          INNER JOIN [dbo].[trivia_games] tg ON gp.[game_id] = tg.[game_id]
          WHERE gp.[user_id] = @user_id ${dateFilter}
        `);

      return result.recordset[0].count || 0;
    } catch (error) {
      console.error('Error getting player games count:', error);
      throw error;
    }
  }
}
