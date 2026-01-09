/**
 * Answer validation service for trivia questions
 * Handles case-insensitive matching, parenthetical content, and common variations
 */

/**
 * Normalize text for comparison
 * - Convert to lowercase
 * - Trim whitespace
 * - Remove common words (the, a, an)
 * - Normalize whitespace
 * - Remove punctuation
 */
export function normalizeAnswer(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\b(the|a|an)\b/gi, '') // Remove common words
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/[.,!?;:'"]/g, '') // Remove punctuation
    .trim();
}

/**
 * Extract variants from answers with parenthetical content
 * Example: "(Tom) Hanks" -> ["hanks", "tom hanks"]
 */
export function extractParentheticalVariants(answer: string): string[] {
  const variants: string[] = [];
  
  // Check if answer contains parentheses
  const parenMatch = answer.match(/\(([^)]+)\)/);
  if (!parenMatch) {
    // No parentheses, just normalize
    variants.push(normalizeAnswer(answer));
    return variants;
  }

  // Extract content inside parentheses
  const parenContent = parenMatch[1];
  
  // Full answer without parentheses
  const withoutParens = answer.replace(/\([^)]+\)/g, '').trim();
  if (withoutParens.length > 0) {
    variants.push(normalizeAnswer(withoutParens));
  }
  
  // Answer with parenthetical content included (remove parentheses)
  const withParens = answer.replace(/[()]/g, '').trim();
  if (withParens.length > 0) {
    variants.push(normalizeAnswer(withParens));
  }
  
  // Only parenthetical content (if it's meaningful - at least 3 chars and not a common word)
  const commonWords = ['the', 'a', 'an'];
  if (parenContent.length >= 3 && !commonWords.includes(parenContent.toLowerCase().trim())) {
    variants.push(normalizeAnswer(parenContent));
  }

  return [...new Set(variants)]; // Remove duplicates
}

/**
 * Generate common variations of text
 * Handles & ↔ and, hyphens, etc.
 */
export function generateVariations(text: string): string[] {
  const variations = new Set<string>([text]);
  
  // & ↔ and
  variations.add(text.replace(/&/g, 'and'));
  variations.add(text.replace(/\band\b/g, '&'));
  
  // Remove hyphens (replace with space or nothing)
  variations.add(text.replace(/-/g, ' '));
  variations.add(text.replace(/-/g, ''));
  
  // Add hyphens to spaces (for compound words)
  if (text.includes(' ')) {
    variations.add(text.replace(/\s+/g, '-'));
  }
  
  return Array.from(variations);
}

/**
 * Validate if player's answer matches the correct answer
 * Returns true if match found, false otherwise
 */
export function validateAnswer(playerInput: string, correctAnswer: string): boolean {
  // Normalize player input
  const normalizedInput = normalizeAnswer(playerInput);
  
  // Empty or whitespace-only input is invalid
  if (!normalizedInput || normalizedInput.trim().length === 0) {
    return false;
  }
  
  // Get all valid variants of the correct answer
  const answerVariants = extractParentheticalVariants(correctAnswer);
  
  // Check exact match against all variants
  for (const variant of answerVariants) {
    if (normalizedInput === variant) {
      return true;
    }
  }
  
  // Check with common variations
  const inputVariations = generateVariations(normalizedInput);
  for (const variant of answerVariants) {
    for (const inputVar of inputVariations) {
      if (inputVar === variant) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Check if input is valid (not empty, not just common words)
 */
export function isValidInput(input: string): boolean {
  const normalized = normalizeAnswer(input);
  return normalized.length > 0;
}
