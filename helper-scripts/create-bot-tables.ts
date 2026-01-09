import * as sql from 'mssql';
import { connect, getConnection, close } from './database';

async function createBotTables(): Promise<void> {
  try {
    await connect();
    const pool = getConnection();

    // Create trivia_games table
    const createTriviaGamesTable = `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[trivia_games]') AND type in (N'U'))
      BEGIN
        CREATE TABLE [dbo].[trivia_games] (
          [game_id] INT IDENTITY(1,1) PRIMARY KEY,
          [guild_id] NVARCHAR(255) NOT NULL,
          [channel_id] NVARCHAR(255) NOT NULL,
          [started_at] DATETIME2 NOT NULL,
          [completed_at] DATETIME2 NOT NULL,
          [status] NVARCHAR(50) NOT NULL,
          [round1_questions] NVARCHAR(MAX) NULL,
          [round2_questions] NVARCHAR(MAX) NULL,
          [final_question_id] INT NULL
        );
        
        CREATE INDEX IX_trivia_games_guild_id ON [dbo].[trivia_games]([guild_id]);
        CREATE INDEX IX_trivia_games_completed_at ON [dbo].[trivia_games]([completed_at]);
      END
    `;

    // Create game_players table
    const createGamePlayersTable = `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[game_players]') AND type in (N'U'))
      BEGIN
        CREATE TABLE [dbo].[game_players] (
          [game_player_id] INT IDENTITY(1,1) PRIMARY KEY,
          [game_id] INT NOT NULL,
          [user_id] NVARCHAR(255) NOT NULL,
          [username] NVARCHAR(255) NOT NULL,
          [final_score] INT NOT NULL DEFAULT 0,
          [round1_score] INT NOT NULL DEFAULT 0,
          [round2_score] INT NOT NULL DEFAULT 0,
          [final_wager] INT NULL,
          [final_correct] BIT NULL,
          [final_score_change] INT NULL,
          CONSTRAINT FK_game_players_game_id FOREIGN KEY ([game_id]) REFERENCES [dbo].[trivia_games]([game_id]) ON DELETE CASCADE
        );
        
        CREATE INDEX IX_game_players_game_id ON [dbo].[game_players]([game_id]);
        CREATE INDEX IX_game_players_user_id ON [dbo].[game_players]([user_id]);
        CREATE INDEX IX_game_players_user_game ON [dbo].[game_players]([user_id], [game_id]);
      END
    `;

    // Create player_statistics table
    const createPlayerStatisticsTable = `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[player_statistics]') AND type in (N'U'))
      BEGIN
        CREATE TABLE [dbo].[player_statistics] (
          [stat_id] INT IDENTITY(1,1) PRIMARY KEY,
          [user_id] NVARCHAR(255) NOT NULL UNIQUE,
          [total_games] INT NOT NULL DEFAULT 0,
          [total_score_all_time] INT NOT NULL DEFAULT 0,
          [best_score] INT NOT NULL DEFAULT 0,
          [last_played] DATETIME2 NULL,
          [last_updated] DATETIME2 NOT NULL DEFAULT GETDATE()
        );
        
        CREATE INDEX IX_player_statistics_user_id ON [dbo].[player_statistics]([user_id]);
        CREATE INDEX IX_player_statistics_total_score ON [dbo].[player_statistics]([total_score_all_time]);
      END
    `;

    // Create guild_config table
    const createGuildConfigTable = `
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[guild_config]') AND type in (N'U'))
      BEGIN
        CREATE TABLE [dbo].[guild_config] (
          [config_id] INT IDENTITY(1,1) PRIMARY KEY,
          [guild_id] NVARCHAR(255) NOT NULL UNIQUE,
          [trivia_channel_id] NVARCHAR(255) NULL,
          [required_role_id] NVARCHAR(255) NULL,
          [updated_at] DATETIME2 NOT NULL DEFAULT GETDATE()
        );
        
        CREATE INDEX IX_guild_config_guild_id ON [dbo].[guild_config]([guild_id]);
      END
    `;

    // Add required_role_id column if table exists but column doesn't
    const addRequiredRoleColumn = `
      IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[guild_config]') AND type in (N'U'))
      BEGIN
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[guild_config]') AND name = 'required_role_id')
        BEGIN
          ALTER TABLE [dbo].[guild_config] ADD [required_role_id] NVARCHAR(255) NULL;
        END
      END
    `;

    console.log('Creating bot tables...');
    await pool.request().query(createTriviaGamesTable);
    console.log('✓ trivia_games table created');
    
    await pool.request().query(createGamePlayersTable);
    console.log('✓ game_players table created');
    
    await pool.request().query(createPlayerStatisticsTable);
    console.log('✓ player_statistics table created');
    
    await pool.request().query(createGuildConfigTable);
    console.log('✓ guild_config table created');
    
    await pool.request().query(addRequiredRoleColumn);
    console.log('✓ required_role_id column added (if needed)');
    
    console.log('\nAll bot tables created successfully!');
  } catch (error) {
    console.error('Error creating bot tables:', error);
    throw error;
  } finally {
    await close();
  }
}

// Run if executed directly
if (require.main === module) {
  createBotTables()
    .then(() => {
      console.log('Database setup complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Database setup failed:', error);
      process.exit(1);
    });
}

export { createBotTables };
