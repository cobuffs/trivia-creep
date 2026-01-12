/**
 * Answer validation service for trivia questions
 * Handles case-insensitive matching, parenthetical content, and common variations
 */

import { AnswerSpec } from './lmstudio';

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
 * Normalize text using the same normalization as LMStudio
 * This matches the normalization used in the normalize-answers script
 */
function normalizeTextForSpec(input: string): string {
  if (!input) return "";
  let s = input.trim().toLowerCase();
  s = s.replace(/&/g, " and ");
  s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/^(the|a|an)\s+/i, "");
  s = s.replace(/[^a-z0-9\s]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Validate answer using normalized AnswerSpec
 */
function validateAnswerWithSpec(playerInput: string, spec: AnswerSpec): boolean {
  const normalizedInput = normalizeTextForSpec(playerInput);
  
  if (!normalizedInput || normalizedInput.trim().length === 0) {
    return false;
  }

  if (spec.answer_mode === "single") {
    // Check against all accepted answers
    for (const accepted of spec.accepted) {
      if (normalizedInput === accepted) {
        return true;
      }
    }
    return false;
  } else if (spec.answer_mode === "n_of_m") {
    // For n_of_m, we need to check if the player provided the required number of options
    const inputTokens = normalizedInput.split(/\s+/).filter(Boolean);
    const matchedOptions = new Set<string>();
    
    // Check each input token against options and aliases
    for (const token of inputTokens) {
      for (const option of spec.options) {
        if (token === option) {
          matchedOptions.add(option);
        }
        // Check aliases
        const aliases = spec.option_aliases[option] || [];
        for (const alias of aliases) {
          if (token === alias) {
            matchedOptions.add(option);
          }
        }
      }
    }
    
    // Check if we have the required count
    if (matchedOptions.size >= spec.required_count) {
      if (spec.allow_more_than_required) {
        return true; // More than required is OK
      } else {
        return matchedOptions.size === spec.required_count; // Must be exactly required
      }
    }
    
    return false;
  }
  
  return false;
}

/**
 * Validate if player's answer matches the correct answer
 * Returns true if match found, false otherwise
 * 
 * @param playerInput - The player's answer input
 * @param correctAnswer - The correct answer from the database
 * @param normalizedSpec - Optional normalized AnswerSpec to use for validation
 */
export function validateAnswer(playerInput: string, correctAnswer: string, normalizedSpec?: AnswerSpec): boolean {
  // If we have a normalized spec, use it
  if (normalizedSpec) {
    return validateAnswerWithSpec(playerInput, normalizedSpec);
  }
  
  // Fallback to original validation logic
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
