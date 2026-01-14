// Flexible question interface for database
export interface Question {
  id?: number;                       // Optional: database ID (included when loaded from DB)
  source: string;                    // Required: source identifier
  question: string;                  // Required: the question text
  answer: string;                    // Required: the answer
  category?: string | null;          // Optional: category/topic
  dollar_amount?: number | null;     // Optional: dollar amount
  round?: string | null;             // Optional: round identifier
  game_id?: number | null;           // Optional: game/episode ID
  season?: string | null;            // Optional: season identifier
  clue_order?: number | null;         // Optional: order within round
  metadata?: string | null;          // Optional: JSON string for extra data
  air_date?: string | null;          // Optional: original air date (YYYY-MM-DD format)
}

// J-Archive specific types
export interface JArchiveQuestion extends Question {
  source: 'j-archive';
  game_id: number;
  season: string;
  round: 'Jeopardy!' | 'Double Jeopardy!' | 'Final Jeopardy!';
  category: string;
  dollar_amount: number | null;
  clue_order: number;
}

export interface GameInfo {
  game_id: number;
  season: string;
}
