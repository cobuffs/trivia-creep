import axios from 'axios';
import * as cheerio from 'cheerio';
import * as sql from 'mssql';
import dotenv from 'dotenv';

dotenv.config();

const BASE_URL = 'https://j-archive.com';

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

async function close(): Promise<void> {
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

/**
 * Get all unique game_ids from the database that don't have an air_date
 */
async function getGameIdsWithoutAirDate(): Promise<number[]> {
  const pool = getConnection();
  
  const result = await pool.request().query(`
    SELECT DISTINCT [game_id] 
    FROM [dbo].[questions] 
    WHERE [game_id] IS NOT NULL 
      AND [air_date] IS NULL
    ORDER BY [game_id]
  `);

  return result.recordset.map((row: { game_id: number }) => row.game_id);
}

/**
 * Extract air_date from j-archive.com game page HTML
 * Title format: "J! Archive - Show #9459, aired 2025-12-18"
 */
function extractAirDateFromHtml(html: string): string | null {
  const $ = cheerio.load(html);
  const title = $('title').text();
  
  // Match "aired YYYY-MM-DD" pattern
  const match = title.match(/aired\s+(\d{4}-\d{2}-\d{2})/);
  
  if (match && match[1]) {
    return match[1];
  }
  
  return null;
}

/**
 * Fetch air_date for a game_id from j-archive.com
 */
async function fetchAirDateForGame(gameId: number): Promise<string | null> {
  try {
    const response = await axios.get(`${BASE_URL}/showgame.php?game_id=${gameId}`, {
      timeout: 10000 // 10 second timeout
    });
    
    return extractAirDateFromHtml(response.data);
  } catch (error) {
    console.error(`Error fetching game ${gameId}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Update all questions with a specific game_id to set the air_date
 */
async function updateAirDateForGameId(gameId: number, airDate: string): Promise<number> {
  const pool = getConnection();
  
  const result = await pool
    .request()
    .input('game_id', sql.Int, gameId)
    .input('air_date', sql.Date, airDate)
    .query(`
      UPDATE [dbo].[questions]
      SET [air_date] = @air_date
      WHERE [game_id] = @game_id
    `);

  return result.rowsAffected[0];
}

/**
 * Add a delay between requests to be respectful to j-archive.com
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main function to backfill air dates
 */
async function main() {
  console.log('=== Air Date Backfill Script ===\n');

  try {
    // Connect to database
    await connect();

    // Get all game_ids that need air dates
    console.log('Fetching game_ids that need air dates...');
    const gameIds = await getGameIdsWithoutAirDate();
    console.log(`Found ${gameIds.length} games that need air dates\n`);

    if (gameIds.length === 0) {
      console.log('All games already have air dates. Nothing to do.');
      return;
    }

    let successCount = 0;
    let errorCount = 0;
    let totalRowsUpdated = 0;

    // Process each game_id
    for (let i = 0; i < gameIds.length; i++) {
      const gameId = gameIds[i];
      const progress = `[${i + 1}/${gameIds.length}]`;

      // Fetch air date from j-archive.com
      const airDate = await fetchAirDateForGame(gameId);

      if (airDate) {
        // Update database
        const rowsUpdated = await updateAirDateForGameId(gameId, airDate);
        totalRowsUpdated += rowsUpdated;
        successCount++;
        console.log(`${progress} Game ${gameId}: air_date=${airDate}, updated ${rowsUpdated} rows`);
      } else {
        errorCount++;
        console.log(`${progress} Game ${gameId}: Could not extract air date`);
      }

      // Log progress every 100 games
      if ((i + 1) % 100 === 0) {
        console.log(`\n--- Progress: ${i + 1}/${gameIds.length} games processed ---\n`);
      }

      // Add delay between requests to be respectful (500ms)
      await delay(500);
    }

    // Summary
    console.log('\n=== Backfill Complete ===');
    console.log(`Games processed: ${gameIds.length}`);
    console.log(`Successful updates: ${successCount}`);
    console.log(`Failed/skipped: ${errorCount}`);
    console.log(`Total rows updated: ${totalRowsUpdated}`);

  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await close();
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}
