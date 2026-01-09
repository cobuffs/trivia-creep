import axios from 'axios';
import * as cheerio from 'cheerio';
import { JArchiveQuestion, GameInfo } from './types';
import { connect, close, createTableIfNotExists, gameExists, insertQuestions } from './database';

const BASE_URL = 'https://j-archive.com';
const SOURCE = 'j-archive';

/**
 * Fetch and parse the list of all seasons from j-archive
 */
export async function getAllSeasons(): Promise<string[]> {
  try {
    const response = await axios.get(`${BASE_URL}/listseasons.php`);
    const $ = cheerio.load(response.data);
    const seasons: string[] = [];

    // Parse the table rows to extract season identifiers
    $('table tr').each((_, row) => {
      const link = $(row).find('a[href*="showseason.php"]');
      if (link.length > 0) {
        const href = link.attr('href');
        if (href) {
          // Extract season parameter from URL (e.g., "showseason.php?season=1" or "showseason.php?season=jm")
          const match = href.match(/season=([^&]+)/);
          if (match && match[1]) {
            seasons.push(match[1]);
          }
        }
      }
    });

    console.log(`Found ${seasons.length} seasons`);
    return seasons;
  } catch (error) {
    console.error('Error fetching seasons:', error);
    throw error;
  }
}

/**
 * Fetch and parse all game IDs for a specific season
 */
export async function getGamesForSeason(season: string): Promise<GameInfo[]> {
  try {
    const response = await axios.get(`${BASE_URL}/showseason.php?season=${season}`);
    const $ = cheerio.load(response.data);
    const games: GameInfo[] = [];

    // Parse table rows to extract game_id from links
    $('table tr').each((_, row) => {
      const link = $(row).find('a[href*="showgame.php"]');
      if (link.length > 0) {
        const href = link.attr('href');
        if (href) {
          const match = href.match(/game_id=(\d+)/);
          if (match && match[1]) {
            const gameId = parseInt(match[1], 10);
            games.push({ game_id: gameId, season });
          }
        }
      }
    });

    console.log(`Found ${games.length} games for season ${season}`);
    return games;
  } catch (error) {
    console.error(`Error fetching games for season ${season}:`, error);
    throw error;
  }
}

/**
 * Parse dollar amount from clue text (e.g., "$200" -> 200)
 */
function parseDollarAmount(text: string): number | null {
  const match = text.match(/\$(\d+)/);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  return null;
}

/**
 * Parse a game page and extract all questions
 */
export async function parseGamePage(html: string, gameId: number, season: string): Promise<JArchiveQuestion[]> {
  const $ = cheerio.load(html);
  const questions: JArchiveQuestion[] = [];

  // Process each round (Jeopardy!, Double Jeopardy!, Final Jeopardy!)
  const rounds = [
    { name: 'Jeopardy!' as const, selector: '#jeopardy_round', prefix: 'J' },
    { name: 'Double Jeopardy!' as const, selector: '#double_jeopardy_round', prefix: 'DJ' },
    { name: 'Final Jeopardy!' as const, selector: '#final_jeopardy_round', prefix: 'FJ' }
  ];

  for (const round of rounds) {
    const roundElement = $(round.selector);
    if (roundElement.length === 0) {
      continue; // Round doesn't exist in this game
    }

    if (round.name === 'Final Jeopardy!') {
      // Final Jeopardy has a different structure
      const category = roundElement.find('.category_name').first().text().trim();
      const clueText = $('#clue_FJ.clue_text').text().trim();
      const answerText = $('#clue_FJ_r .correct_response').text().trim();

      if (clueText && answerText) {
        questions.push({
          source: SOURCE,
          game_id: gameId,
          season,
          round: round.name,
          category,
          dollar_amount: null, // Final Jeopardy doesn't have dollar amounts
          question: clueText,
          answer: answerText,
          clue_order: 0
        });
      }
    } else {
      // Regular rounds: parse categories first (they're in the first row)
      const categories: string[] = [];
      
      // Try multiple selector strategies to find categories
      // Categories are in table.round > tbody > tr:first-child > td.category > table > tbody > tr > td.category_name
      const categorySelectors = [
        'table.round tbody tr:first-child td.category .category_name',
        'table.round tr:first-child td.category .category_name',
        '.category_name'
      ];
      
      for (const selector of categorySelectors) {
        roundElement.find(selector).each((_, el) => {
          const catName = $(el).text().trim();
          if (catName && !categories.includes(catName)) {
            categories.push(catName);
          }
        });
        
        // If we found categories, break
        if (categories.length > 0) {
          break;
        }
      }
      
      // If still no categories, try finding them by traversing the table structure more explicitly
      if (categories.length === 0) {
        // Find the round table
        const roundTable = roundElement.find('table.round').first();
        if (roundTable.length > 0) {
          // Get the first row (category row)
          const firstRow = roundTable.find('tbody tr:first-child, tr:first-child').first();
          if (firstRow.length > 0) {
            // Find all category cells in the first row
            firstRow.find('td.category').each((_, catCell) => {
              const $catCell = $(catCell);
              // Look for category_name in nested tables
              const catName = $catCell.find('.category_name').first().text().trim();
              if (catName && !categories.includes(catName)) {
                categories.push(catName);
              }
            });
          }
        }
      }
      
      if (categories.length === 0) {
        console.warn(`Warning: No categories found for ${round.name}. Clues will have empty categories.`);
      } else {
        console.log(`Found ${categories.length} categories for ${round.name}: ${categories.join(', ')}`);
      }

      // Parse clues - find all clue text elements with IDs matching the pattern
      // Clue IDs are like "clue_J_1_1" (round_category_row)
      let clueOrder = 0;
      
      // Find all clue text elements that match the round prefix pattern
      const cluePattern = new RegExp('^clue_' + round.prefix + '_\\d+_\\d+$');
      roundElement.find('[id]').each((_, el) => {
        const $el = $(el);
        const id = $el.attr('id') || '';
        
        // Check if this is a clue text element (not the response element which ends with _r)
        if (!cluePattern.test(id) || id.endsWith('_r') || id.endsWith('_stuck')) {
          return;
        }
        
        // Extract clue text (the question) - this element has class "clue_text"
        const clueText = $el.text().trim();
        if (!clueText) {
          return;
        }
        
        // Find the corresponding response element (id + "_r")
        const responseId = id + '_r';
        const $responseEl = $('#' + responseId);
        const answerText = $responseEl.find('.correct_response').text().trim();
        
        if (!answerText) {
          return; // Skip if no answer found
        }
        
        // Find the dollar amount - it's in the clue cell's header
        // The clue cell is a parent td.clue that contains this clue
        const $clueCell = $el.closest('td.clue');
        const dollarText = $clueCell.find('.clue_value').text().trim() || 
                          $clueCell.find('.clue_value_daily_double').text().trim() ||
                          '';

        // Determine category from clue ID
        // Clue IDs are like "clue_J_1_1" or "clue_DJ_2_3" where:
        // - J is Jeopardy, DJ is Double Jeopardy
        // - First number is category index (1-based)
        // - Second number is row (1-5 for dollar amounts)
        let category = '';
        // Match both "clue_J_" and "clue_DJ_" patterns
        const idMatch = id.match(/clue_(?:DJ|J)_(\d+)_\d+/);
        if (idMatch) {
          const catIndex = parseInt(idMatch[1], 10) - 1;
          if (catIndex >= 0 && catIndex < categories.length) {
            category = categories[catIndex];
          }
        }
        
        // Debug logging if category not found
        if (!category && categories.length > 0) {
          console.warn(`Warning: Could not map category for clue ${id}. Categories available: ${categories.join(', ')}`);
        }

        const dollarAmount = dollarText ? parseDollarAmount(dollarText) : null;

        questions.push({
          source: SOURCE,
          game_id: gameId,
          season,
          round: round.name,
          category,
          dollar_amount: dollarAmount,
          question: clueText,
          answer: answerText,
          clue_order: clueOrder
        });

        clueOrder++;
      });
    }
  }

  return questions;
}

/**
 * Extract season from game page HTML
 */
function extractSeasonFromGamePage(html: string): string {
  const $ = cheerio.load(html);
  // Try to find season link in the page
  const seasonLink = $('a[href*="showseason.php"]').first();
  if (seasonLink.length > 0) {
    const href = seasonLink.attr('href');
    if (href) {
      const match = href.match(/season=([^&]+)/);
      if (match && match[1]) {
        return match[1];
      }
    }
  }
  // Fallback: try to extract from page title or other metadata
  return 'unknown';
}

/**
 * Scrape a single game by game_id
 */
export async function scrapeGame(gameId: number, season?: string): Promise<JArchiveQuestion[]> {
  try {
    const response = await axios.get(`${BASE_URL}/showgame.php?game_id=${gameId}`);
    
    // If season not provided, try to extract it from the page
    let gameSeason = season;
    if (!gameSeason || gameSeason === 'unknown') {
      gameSeason = extractSeasonFromGamePage(response.data);
    }
    
    const questions = await parseGamePage(response.data, gameId, gameSeason);
    console.log(`Scraped game ${gameId} (season ${gameSeason}): ${questions.length} questions`);
    return questions;
  } catch (error) {
    console.error(`Error scraping game ${gameId}:`, error);
    throw error;
  }
}

/**
 * Main scraping function with idempotency check
 */
export async function scrapeGameWithCheck(gameId: number, season?: string): Promise<JArchiveQuestion[]> {
  // Check if game already exists
  const exists = await gameExists(SOURCE, gameId);
  if (exists) {
    console.log(`Game ${gameId} already exists in database, skipping`);
    return [];
  }

  return await scrapeGame(gameId, season);
}

/**
 * Main entry point - parse CLI args and orchestrate scraping
 */
async function main() {
  // Parse CLI arguments
  const args = process.argv.slice(2);
  let targetSeason: string | null = null;
  let targetGameId: number | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--season' && i + 1 < args.length) {
      targetSeason = args[i + 1];
      i++;
    } else if (args[i] === '--game-id' && i + 1 < args.length) {
      targetGameId = parseInt(args[i + 1], 10);
      if (isNaN(targetGameId)) {
        console.error('Invalid game-id. Must be a number.');
        process.exit(1);
      }
      i++;
    }
  }

  try {
    // Connect to database
    await connect();
    await createTableIfNotExists();

    let totalQuestions = 0;
    let gamesProcessed = 0;
    let gamesSkipped = 0;

    if (targetGameId !== null) {
      // Scrape single game
      console.log(`Scraping game ${targetGameId}...`);
      const questions = await scrapeGameWithCheck(targetGameId);
      if (questions.length > 0) {
        await insertQuestions(questions);
        totalQuestions += questions.length;
        gamesProcessed++;
      } else {
        gamesSkipped++;
      }
    } else if (targetSeason !== null) {
      // Scrape all games in a season
      console.log(`Scraping season ${targetSeason}...`);
      const games = await getGamesForSeason(targetSeason);
      
      for (const game of games) {
        try {
          const questions = await scrapeGameWithCheck(game.game_id, game.season);
          if (questions.length > 0) {
            await insertQuestions(questions);
            totalQuestions += questions.length;
            gamesProcessed++;
          } else {
            gamesSkipped++;
          }
          
          // Log progress every 10 games
          if ((gamesProcessed + gamesSkipped) % 10 === 0) {
            console.log(`Progress: ${gamesProcessed + gamesSkipped}/${games.length} games processed`);
          }
        } catch (error) {
          console.error(`Error processing game ${game.game_id}:`, error);
          // Continue with next game
        }
      }
    } else {
      // Scrape all seasons and games
      console.log('Scraping all seasons and games...');
      const seasons = await getAllSeasons();
      
      for (const season of seasons) {
        console.log(`\nProcessing season: ${season}`);
        try {
          const games = await getGamesForSeason(season);
          
          for (const game of games) {
            try {
              const questions = await scrapeGameWithCheck(game.game_id, game.season);
              if (questions.length > 0) {
                await insertQuestions(questions);
                totalQuestions += questions.length;
                gamesProcessed++;
              } else {
                gamesSkipped++;
              }
              
              // Log progress every 10 games
              if ((gamesProcessed + gamesSkipped) % 10 === 0) {
                console.log(`Progress: ${gamesProcessed + gamesSkipped} games processed (${gamesProcessed} new, ${gamesSkipped} skipped)`);
              }
            } catch (error) {
              console.error(`Error processing game ${game.game_id}:`, error);
              // Continue with next game
            }
          }
        } catch (error) {
          console.error(`Error processing season ${season}:`, error);
          // Continue with next season
        }
      }
    }

    console.log(`\n=== Scraping Complete ===`);
    console.log(`Games processed: ${gamesProcessed}`);
    console.log(`Games skipped (already in DB): ${gamesSkipped}`);
    console.log(`Total questions inserted: ${totalQuestions}`);

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
