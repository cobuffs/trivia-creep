import * as sql from 'mssql';
import dotenv from 'dotenv';
import { Question } from './types';

dotenv.config();

let pool: sql.ConnectionPool | null = null;

export async function connect(): Promise<void> {
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

export async function close(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
    console.log('Database connection closed');
  }
}

export function getConnection(): sql.ConnectionPool {
  if (!pool) {
    throw new Error('Database not connected. Call connect() first.');
  }
  return pool;
}

export async function createTableIfNotExists(): Promise<void> {
  const pool = getConnection();
  
  const createTableQuery = `
    IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[questions]') AND type in (N'U'))
    BEGIN
      CREATE TABLE [dbo].[questions] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [source] VARCHAR(100) NOT NULL,
        [question] NVARCHAR(MAX) NOT NULL,
        [answer] NVARCHAR(MAX) NOT NULL,
        [category] NVARCHAR(500) NULL,
        [dollar_amount] INT NULL,
        [round] VARCHAR(50) NULL,
        [game_id] INT NULL,
        [season] VARCHAR(50) NULL,
        [clue_order] INT NULL,
        [metadata] NVARCHAR(MAX) NULL,
        [created_at] DATETIME NOT NULL DEFAULT GETDATE()
      );
      
      CREATE INDEX IX_questions_source ON [dbo].[questions]([source]);
      CREATE INDEX IX_questions_source_game_id ON [dbo].[questions]([source], [game_id]);
      CREATE INDEX IX_questions_source_season ON [dbo].[questions]([source], [season]);
    END
  `;

  try {
    await pool.request().query(createTableQuery);
    console.log('Questions table ready');
  } catch (error) {
    console.error('Error creating table:', error);
    throw error;
  }
}

export async function gameExists(source: string, gameId: number): Promise<boolean> {
  const pool = getConnection();
  
  try {
    const result = await pool
      .request()
      .input('source', sql.VarChar, source)
      .input('game_id', sql.Int, gameId)
      .query('SELECT COUNT(*) as count FROM [dbo].[questions] WHERE [source] = @source AND [game_id] = @game_id');
    
    return (result.recordset[0] as { count: number }).count > 0;
  } catch (error) {
    console.error('Error checking if game exists:', error);
    throw error;
  }
}

export async function insertQuestions(questions: Question[]): Promise<void> {
  if (questions.length === 0) {
    return;
  }

  const pool = getConnection();
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    for (const question of questions) {
      const request = new sql.Request(transaction);
      
      request.input('source', sql.VarChar, question.source);
      request.input('question', sql.NVarChar, question.question);
      request.input('answer', sql.NVarChar, question.answer);
      request.input('category', sql.NVarChar, question.category || null);
      request.input('dollar_amount', sql.Int, question.dollar_amount || null);
      request.input('round', sql.VarChar, question.round || null);
      request.input('game_id', sql.Int, question.game_id || null);
      request.input('season', sql.VarChar, question.season || null);
      request.input('clue_order', sql.Int, question.clue_order || null);
      request.input('metadata', sql.NVarChar, question.metadata || null);

      await request.query(`
        INSERT INTO [dbo].[questions] 
        ([source], [question], [answer], [category], [dollar_amount], [round], [game_id], [season], [clue_order], [metadata])
        VALUES 
        (@source, @question, @answer, @category, @dollar_amount, @round, @game_id, @season, @clue_order, @metadata)
      `);
    }

    await transaction.commit();
    console.log(`Inserted ${questions.length} questions`);
  } catch (error) {
    await transaction.rollback();
    console.error('Error inserting questions:', error);
    throw error;
  }
}
