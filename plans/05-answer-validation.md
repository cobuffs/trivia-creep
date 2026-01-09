# Answer Validation Logic

## Validation Rules

### Core Rules
1. **Case-insensitive** - "Paris" matches "paris", "PARIS", "PaRiS"
2. **Ignore common words** - Remove "the", "a", "an" from both answer and player input
3. **Parenthetical content** - Handle answers like "(Tom) Hanks" which accepts both "Tom Hanks" and "Hanks"
4. **No question phrasing required** - Players answer directly, not "What is...?"

## Validation Process

### Step 1: Normalize Input
1. Convert to lowercase
2. Trim whitespace
3. Remove common words: "the", "a", "an"
4. Remove punctuation (optional - TBD based on testing)

### Step 2: Handle Parenthetical Content
If answer contains parentheses:
- Extract content inside parentheses: `(Tom) Hanks` → `["Tom", "Hanks"]`
- Extract content outside parentheses: `(Tom) Hanks` → `["Hanks"]`
- Accept if player input matches either:
  - Full answer without parentheses: "Tom Hanks"
  - Answer without parenthetical part: "Hanks"
  - Answer with only parenthetical part: "Tom" (if it makes sense)

**Examples:**
- Answer: `(Tom) Hanks`
  - ✅ "Tom Hanks"
  - ✅ "Hanks"
  - ✅ "tom hanks"
  - ❌ "Tom" (alone - too ambiguous)

- Answer: `Alexander (the Great)`
  - ✅ "Alexander the Great"
  - ✅ "Alexander"
  - ✅ "alexander the great"

### Step 3: Handle Common Variations

#### Common Word Variations
- `&` ↔ `and`
- `+` ↔ `and`
- `'` ↔ (removed or handled)
- `-` ↔ (space or removed)

#### Common Spelling Variations
- Common misspellings (TBD - may need a dictionary)
- Accented characters: `é` ↔ `e`, `ñ` ↔ `n`

#### Formatting Variations
- Extra spaces: "New  York" → "New York"
- Trailing/leading spaces: already handled in normalization

### Step 4: Comparison

Compare normalized player input against normalized answer:
1. Exact match (after normalization)
2. Partial match (if answer contains parenthetical content)

## Implementation Pseudocode

```typescript
function normalizeAnswer(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\b(the|a|an)\b/gi, '') // Remove common words
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/[.,!?;:'"]/g, '') // Remove punctuation (optional)
    .trim();
}

function extractParentheticalVariants(answer: string): string[] {
  const variants: string[] = [];
  const normalized = normalizeAnswer(answer);
  
  // Extract content with and without parentheses
  const withParens = answer.match(/\(([^)]+)\)/g);
  if (withParens) {
    // Full answer without parentheses
    const withoutParens = answer.replace(/\([^)]+\)/g, '').trim();
    variants.push(normalizeAnswer(withoutParens));
    
    // Answer with parenthetical content
    variants.push(normalizeAnswer(answer.replace(/[()]/g, '')));
  } else {
    variants.push(normalized);
  }
  
  return variants;
}

function validateAnswer(playerInput: string, correctAnswer: string): boolean {
  const normalizedInput = normalizeAnswer(playerInput);
  const variants = extractParentheticalVariants(correctAnswer);
  
  // Check exact match against all variants
  for (const variant of variants) {
    if (normalizedInput === variant) {
      return true;
    }
  }
  
  // Check common variations
  const inputVariations = generateVariations(normalizedInput);
  for (const variant of variants) {
    for (const inputVar of inputVariations) {
      if (inputVar === variant) {
        return true;
      }
    }
  }
  
  return false;
}

function generateVariations(text: string): string[] {
  const variations = [text];
  
  // & ↔ and
  variations.push(text.replace(/&/g, 'and'));
  variations.push(text.replace(/\band\b/g, '&'));
  
  // Remove hyphens
  variations.push(text.replace(/-/g, ' '));
  variations.push(text.replace(/-/g, ''));
  
  return [...new Set(variations)]; // Remove duplicates
}
```

## Edge Cases

### Ambiguous Parenthetical Content
- Answer: `(The) Beatles`
  - ✅ "The Beatles"
  - ✅ "Beatles"
  - ❌ "The" (alone)

**Rule**: If parenthetical content alone is too short (< 3 characters) or is a common word, don't accept it alone.

### Multiple Parentheses
- Answer: `(Tom) (Hanks) Movie` → Handle each parenthetical separately

### Special Characters
- Handle Unicode characters (accents, special symbols)
- Handle em dashes, en dashes

### Empty/Nonsense Answers
- Empty string → ❌
- Only whitespace → ❌
- Only common words → ❌

## Testing Considerations

### Test Cases Needed
1. Basic case-insensitive matching
2. Parenthetical content handling
3. Common word removal
4. Punctuation variations
5. Special characters
6. Edge cases (empty, whitespace, etc.)
7. Real Jeopardy answers from database

### Validation Testing Strategy
- Unit tests for `validateAnswer()` function
- Integration tests with real questions from database
- Manual testing with various answer formats

## Future Enhancements
- Fuzzy matching for typos (Levenshtein distance)
- Synonym matching (e.g., "USA" ↔ "United States")
- Abbreviation expansion (e.g., "U.S.A." ↔ "United States of America")
- Common misspelling dictionary
