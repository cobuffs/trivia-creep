-- Add air_date column to questions table
-- Run this SQL script against your database before running the backfill script

-- Add the new air_date column (nullable DATE)
IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[questions]') 
    AND name = 'air_date'
)
BEGIN
    ALTER TABLE [dbo].[questions]
    ADD [air_date] DATE NULL;
    
    PRINT 'Column air_date added successfully';
END
ELSE
BEGIN
    PRINT 'Column air_date already exists';
END

-- Create an index on game_id for faster lookups during backfill
-- (This index may already exist from the original schema)
IF NOT EXISTS (
    SELECT * FROM sys.indexes 
    WHERE object_id = OBJECT_ID(N'[dbo].[questions]') 
    AND name = 'IX_questions_game_id'
)
BEGIN
    CREATE INDEX IX_questions_game_id ON [dbo].[questions]([game_id]);
    PRINT 'Index IX_questions_game_id created';
END
ELSE
BEGIN
    PRINT 'Index IX_questions_game_id already exists';
END
