import * as sql from "mssql";
import pLimit from "p-limit";
import dotenv from "dotenv";

dotenv.config();

type EntityType =
  | "person" | "place" | "organization" | "work_title" | "event"
  | "object" | "concept" | "numeric" | "other";

type SingleSpec = {
  answer_mode: "single";
  accepted: string[];
  required_count: 0;
  allow_more_than_required: false;
  options: [];
  option_aliases: Record<string, string[]>;
  entity_type: EntityType;
};

type NOfMSpec = {
  answer_mode: "n_of_m";
  accepted: [];
  required_count: number;
  allow_more_than_required: boolean;
  options: string[];
  option_aliases: Record<string, string[]>;
  entity_type: EntityType;
};

type Spec = SingleSpec | NOfMSpec;

const CONFIG = {
  SQL_SERVER: process.env.MSSQL_SERVER ?? "localhost",
  SQL_DB: process.env.MSSQL_DATABASE ?? "triviacreep",
  SQL_USER: process.env.MSSQL_USER ?? "",
  SQL_PASSWORD: process.env.MSSQL_PASSWORD ?? "",
  SQL_PORT: parseInt(process.env.MSSQL_PORT || "1433", 10),
  LM_BASE_URL: process.env.LM_BASE_URL ?? "http://localhost:1234/v1",
  LM_MODEL: process.env.LM_MODEL ?? "gemma-3-27b-it-heretic-v2-i1",
  PROMPT_VERSION: Number(process.env.PROMPT_VERSION ?? "1"),
  BATCH_SIZE: Number(process.env.BATCH_SIZE ?? "200"),
  CONCURRENCY: Number(process.env.CONCURRENCY ?? "50"), // Increased to 50 for maximum throughput
  DB_WRITE_BATCH_SIZE: Number(process.env.DB_WRITE_BATCH_SIZE ?? "50"), // Batch database writes
  API_TIMEOUT_MS: Number(process.env.API_TIMEOUT_MS ?? "60000"), // 60 second timeout
  MAX_TOKENS: Number(process.env.MAX_TOKENS ?? "2048"), // Maximum response tokens (JSON responses should be much smaller)
  START_AFTER_ID: Number(process.env.START_AFTER_ID ?? "0"),
  MAX_QUESTIONS: process.env.MAX_QUESTIONS ? Number(process.env.MAX_QUESTIONS) : undefined,
  DRY_RUN: (process.env.DRY_RUN ?? "false").toLowerCase() === "true",
};

// NOTE: System prompt should be configured on LM Studio server side for better performance
// This constant is kept for reference/documentation only - not sent in API calls
const SYSTEM_PROMPT = `You are an offline data-enrichment engine for a Jeopardy-style trivia database.

Input fields:
- clue_text (the clue shown to players)
- category (may be empty)
- answer_text (the database answer; may include parentheses or “(2 of)” markers)

Goal:
Return a JSON object (and ONLY JSON) that defines the exact accepted answers for deterministic matching at runtime.

Critical rules:
- Be conservative: prefer false negatives over false positives.
- Use only information implied by the input. Do not invent facts.
- Output MUST be valid JSON and MUST match the provided schema.
- The game will do exact matching against your outputs (after normalization). Therefore, include all safe equivalent forms that should be accepted.
- Every field value must be a valid JSON value of the correct type. Do not include comments or explanations inside any field.
- For answer_mode="single": required_count must be 0 and allow_more_than_required must be false.
- For answer_mode="n_of_m": accepted must be [].

Normalization to assume the game will apply (you should output strings already normalized this way):
- lowercase
- trim whitespace
- replace "&" with "and"
- remove leading articles: "the", "a", "an"
- remove diacritics
- remove most punctuation by turning it into spaces (keep digits and letters)
- collapse repeated spaces

Answer modes:
1) answer_mode="single"
- Use when there is one correct answer phrase.
- Provide accepted[]: include the normalized canonical answer and any truly equivalent variants.
- If entity_type="person" AND the person has a last name, include the last-name-only form in accepted[] unless the clue clearly requires a fuller name.
- Person-name variants (only when entity_type="person"):
  - If answer_text includes a common nickname/diminutive, include the widely recognized formal given-name expansion when it refers to the same person in this clue context (e.g., "teddy roosevelt" -> also accept "theodore roosevelt").
  - If answer_text includes the formal given name, include the widely recognized nickname form when strongly associated and unambiguous in this clue context.
  - Do NOT invent uncertain expansions.

2) answer_mode="n_of_m"
- Use when the clue/answer indicates “N of these” (e.g., “2 of the 4…”, “name 3…”, “(2 of) …”).
- Set required_count=N.
- Set allow_more_than_required=true unless the clue clearly requires exactly N.
- Provide options[]: the normalized list of acceptable items.
- Provide option_aliases{}: for each option, include any truly equivalent normalized aliases (usually empty).
- Do NOT generate combinations.

entity_type:
Choose exactly one from:
["person","place","organization","work_title","event","object","concept","numeric","other"]

Output JSON schema:
{
  "answer_mode": "single" | "n_of_m",
  "accepted": [string, ...],
  "required_count": integer,
  "allow_more_than_required": boolean,
  "options": [string, ...],
  "option_aliases": { "<option>": [string, ...] },
  "entity_type": "person"|"place"|"organization"|"work_title"|"event"|"object"|"concept"|"numeric"|"other"
}
`;

const RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "answer_spec",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        answer_mode: { type: "string", enum: ["single", "n_of_m"] },
        accepted: { type: "array", items: { type: "string" } },
        required_count: { type: "integer" },
        allow_more_than_required: { type: "boolean" },
        options: { type: "array", items: { type: "string" } },
        option_aliases: {
          type: "object",
          additionalProperties: { type: "array", items: { type: "string" } },
        },
        entity_type: {
          type: "string",
          enum: ["person","place","organization","work_title","event","object","concept","numeric","other"],
        },
      },
      required: [
        "answer_mode",
        "accepted",
        "required_count",
        "allow_more_than_required",
        "options",
        "option_aliases",
        "entity_type",
      ],
    },
  },
} as const;

// Keep small + high-confidence. Expand only as needed.
const NICKNAME_MAP: Record<string, string[]> = {
  teddy: ["theodore"], // keep just the needed one for this use case
  theo: ["theodore"],
  bill: ["william"],
  bob: ["robert"],
  jim: ["james"],
  jack: ["john"],
  liz: ["elizabeth"],
  beth: ["elizabeth"],
  kate: ["katherine", "catherine"],
  mike: ["michael"],
  dave: ["david"],
  tom: ["thomas"],
  joe: ["joseph"],
};

function normalizeText(input: string): string {
  if (!input) return "";
  let s = input.trim().toLowerCase();
  s = s.replace(/&/g, " and ");
  s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/^(the|a|an)\s+/i, "");
  s = s.replace(/[^a-z0-9\s]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function repairJson(jsonText: string): string {
  // Fix common JSON errors from LLM outputs
  let repaired = jsonText;
  
  // Fix missing values after colons (e.g., "required_count": ,)
  repaired = repaired.replace(/:\s*,/g, ': null,');
  repaired = repaired.replace(/:\s*}/g, ': null}');
  repaired = repaired.replace(/:\s*]/g, ': null]');
  
  // Fix trailing commas
  repaired = repaired.replace(/,(\s*[}\]])/g, '$1');
  
  // Fix unquoted keys (shouldn't happen with schema, but just in case)
  repaired = repaired.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
  
  return repaired;
}

function extractFirstJsonObject(s: string): any {
  // Strip markdown code blocks if present
  let cleaned = s.trim();
  
  // Remove ```json and ``` markers
  if (cleaned.startsWith('```')) {
    const lines = cleaned.split('\n');
    // Remove first line if it's ```json or ```
    if (lines[0].match(/^```(json)?$/i)) {
      lines.shift();
    }
    // Remove last line if it's ```
    if (lines.length > 0 && lines[lines.length - 1].trim() === '```') {
      lines.pop();
    }
    cleaned = lines.join('\n').trim();
  }
  
  const start = cleaned.indexOf("{");
  if (start === -1) throw new Error("No JSON object start found");
  
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (ch === '\\') {
      escapeNext = true;
      continue;
    }
    
    if (ch === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }
    
    if (inString) continue;
    
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const jsonText = cleaned.slice(start, i + 1);
        try {
          return JSON.parse(jsonText);
        } catch (e) {
          // Try to repair and parse again
          try {
            const repaired = repairJson(jsonText);
            return JSON.parse(repaired);
          } catch (e2) {
            throw new Error(`Invalid JSON: ${e2 instanceof Error ? e2.message : String(e2)}. Original: ${jsonText.substring(0, 200)}`);
          }
        }
      }
    }
  }
  throw new Error("No complete JSON object found");
}

function toStringArray(x: any): string[] {
  return Array.isArray(x) ? x.filter((v) => typeof v === "string") : [];
}

function toEntityType(x: any): EntityType {
  const allowed: EntityType[] = ["person","place","organization","work_title","event","object","concept","numeric","other"];
  return allowed.includes(x) ? x : "other";
}

function addLastNameAcceptance(spec: SingleSpec): SingleSpec {
  if (spec.entity_type !== "person") return spec;
  const canonical = spec.accepted[0] ?? "";
  const tokens = canonical.split(" ").filter(Boolean);
  if (tokens.length < 2) return spec;

  const suffixes = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
  const filtered = tokens.filter((t) => !suffixes.has(t));
  if (filtered.length < 2) return spec;

  const last = filtered[filtered.length - 1];
  if (last && !spec.accepted.includes(last)) spec.accepted.push(last);
  spec.accepted = Array.from(new Set(spec.accepted));
  return spec;
}

function addNicknameExpansions(spec: SingleSpec): SingleSpec {
  if (spec.entity_type !== "person") return spec;

  const expanded = new Set(spec.accepted);
  for (const a of spec.accepted) {
    const tokens = a.split(" ").filter(Boolean);
    if (tokens.length < 2) continue;

    const first = tokens[0];
    const expansions = NICKNAME_MAP[first];
    if (!expansions) continue;

    const last = tokens[tokens.length - 1];
    for (const formal of expansions) {
      expanded.add([formal, ...tokens.slice(1, tokens.length - 1), last].join(" "));
    }
  }

  spec.accepted = Array.from(expanded);
  return spec;
}

function normalizeSpec(raw: any, dbAnswer: string): Spec {
  const mode = raw?.answer_mode;
  const entity_type = toEntityType(raw?.entity_type);

  if (mode === "single") {
    const acceptedNorm = toStringArray(raw.accepted).map(normalizeText).filter(Boolean);
    const canon = normalizeText(dbAnswer);
    if (canon && !acceptedNorm.includes(canon)) acceptedNorm.unshift(canon);

    let single: SingleSpec = {
      answer_mode: "single",
      accepted: Array.from(new Set(acceptedNorm)),
      required_count: 0,                 // HARD INVARIANT
      allow_more_than_required: false,    // HARD INVARIANT
      options: [],                        // HARD INVARIANT
      option_aliases: {},                 // HARD INVARIANT
      entity_type,
    };

    single = addLastNameAcceptance(single);
    single = addNicknameExpansions(single);
    return single;
  }

  if (mode === "n_of_m") {
    const required = Number.isFinite(raw?.required_count) ? raw.required_count : parseInt(String(raw?.required_count ?? "2"), 10);
    const required_count = Number.isFinite(required) && required > 0 ? required : 2;

    const allow_more_than_required = typeof raw?.allow_more_than_required === "boolean" ? raw.allow_more_than_required : true;

    const options = Array.from(new Set(toStringArray(raw.options).map(normalizeText).filter(Boolean)));

    const option_aliases_in = (raw.option_aliases && typeof raw.option_aliases === "object") ? raw.option_aliases : {};
    const option_aliases: Record<string, string[]> = {};
    for (const opt of options) {
      // note: keys are normalized options; model might output non-normalized keys, but options list is source of truth
      const rawAliases = toStringArray(option_aliases_in[opt] ?? []);
      option_aliases[opt] = Array.from(new Set(rawAliases.map(normalizeText).filter(Boolean)));
    }

    const nOfM: NOfMSpec = {
      answer_mode: "n_of_m",
      accepted: [],                       // HARD INVARIANT
      required_count,
      allow_more_than_required,
      options,
      option_aliases,
      entity_type,
    };
    return nOfM;
  }

  // Fallback
  const canon = normalizeText(dbAnswer);
  const fallback: SingleSpec = {
    answer_mode: "single",
    accepted: canon ? [canon] : [],
    required_count: 0,
    allow_more_than_required: false,
    options: [],
    option_aliases: {},
    entity_type: "other",
  };
  return fallback;
}

async function callLMStudioOnce(userContent: string, useSchema: boolean, signal?: AbortSignal): Promise<string> {
  const body: any = {
    model: CONFIG.LM_MODEL,
    messages: [
      // System prompt is configured on LM Studio server side - not sent here for performance
      { role: "user", content: userContent },
    ],
    temperature: 0.1,
    seed: 42, // Fixed seed for deterministic outputs (even with temp 0, seed ensures reproducibility)
    top_p: 1.0, // Disable nucleus sampling for determinism
    max_tokens: CONFIG.MAX_TOKENS, // Limit response length
  };
  if (useSchema) body.response_format = RESPONSE_FORMAT;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT_MS);
  if (signal) {
    signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const resp = await fetch(`${CONFIG.LM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const text = await resp.text();
    if (!resp.ok) throw new Error(`LM Studio HTTP ${resp.status}: ${text}`);

    const json = JSON.parse(text);
    return json?.choices?.[0]?.message?.content ?? "";
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`API call timed out after ${CONFIG.API_TIMEOUT_MS}ms`);
    }
    throw error;
  }
}

// Optimized string escaping - only escape what's necessary
function escapeJsonString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

async function callLMStudio(row: { question: string; answer: string; category: string | null }): Promise<any> {
  const userContent =
    `clue_text: "${escapeJsonString(row.question)}"\n` +
    `category: "${escapeJsonString(row.category ?? "")}"\n` +
    `answer_text: "${escapeJsonString(row.answer)}"\n\n` +
    `Return the JSON now.`;

  // 1st attempt with schema (most common case)
  try {
    const content = await callLMStudioOnce(userContent, true);
    return extractFirstJsonObject(content);
  } catch {
    // 2nd attempt: skip schema retry, go straight to no-schema (faster)
    // Some models/LM Studio builds ignore response_format, so try without it
    try {
      const content2 = await callLMStudioOnce(userContent, false);
      return extractFirstJsonObject(content2);
    } catch {
      // 3rd attempt: repair prompt without schema
      const repair = userContent + `\n\nOutput ONLY valid JSON. No commentary.`;
      const content3 = await callLMStudioOnce(repair, false);
      return extractFirstJsonObject(content3);
    }
  }
}

async function upsertSpec(pool: sql.ConnectionPool, questionId: number, spec: Spec) {
  const specJson = JSON.stringify(spec);

  if (CONFIG.DRY_RUN) {
    console.log(`[DRY_RUN] question_id=${questionId} spec=${specJson}`);
    return;
  }

  // INSERT only - query already filters out existing records
  // Handle duplicate key errors gracefully (race condition protection)
  try {
    await pool.request()
      .input("question_id", sql.Int, questionId)
      .input("spec_json", sql.NVarChar(sql.MAX), specJson)
      .input("model", sql.VarChar(200), CONFIG.LM_MODEL)
      .input("prompt_version", sql.Int, CONFIG.PROMPT_VERSION)
      .query(`
        INSERT INTO dbo.question_answer_specs (question_id, spec_json, model, prompt_version)
        VALUES (@question_id, @spec_json, @model, @prompt_version);
      `);
  } catch (error: any) {
    // Ignore duplicate key errors (2627 = Primary key violation, 2601 = Unique constraint violation)
    if (error.number === 2627 || error.number === 2601) {
      // Question was already processed (race condition), skip silently
      return;
    }
    throw error;
  }
}

async function upsertSpecsBatch(pool: sql.ConnectionPool, specs: Array<{ questionId: number; spec: Spec }>) {
  if (CONFIG.DRY_RUN) {
    specs.forEach(({ questionId, spec }) => {
      console.log(`[DRY_RUN] question_id=${questionId} spec=${JSON.stringify(spec)}`);
    });
    return;
  }

  if (specs.length === 0) return;

  // INSERT only - query already filters out existing records
  // Use table-valued parameter for efficient batch insert with duplicate handling
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();

    for (const { questionId, spec } of specs) {
      const specJson = JSON.stringify(spec);
      const request = new sql.Request(transaction);
      request.input("question_id", sql.Int, questionId);
      request.input("spec_json", sql.NVarChar(sql.MAX), specJson);
      request.input("model", sql.VarChar(200), CONFIG.LM_MODEL);
      request.input("prompt_version", sql.Int, CONFIG.PROMPT_VERSION);
      
      try {
        await request.query(`
          INSERT INTO dbo.question_answer_specs (question_id, spec_json, model, prompt_version)
          VALUES (@question_id, @spec_json, @model, @prompt_version);
        `);
      } catch (error: any) {
        // Ignore duplicate key errors (2627 = Primary key violation, 2601 = Unique constraint violation)
        // This handles race conditions where the same question might be processed concurrently
        if (error.number !== 2627 && error.number !== 2601) {
          throw error;
        }
        // Otherwise, skip this insert and continue with the batch
      }
    }

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function main() {
  // Parse CLI arguments
  const args = process.argv.slice(2);
  let maxQuestions: number | undefined = CONFIG.MAX_QUESTIONS;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--max-questions' && i + 1 < args.length) {
      const value = parseInt(args[i + 1], 10);
      if (isNaN(value) || value <= 0) {
        console.error('Invalid --max-questions. Must be a positive number.');
        process.exit(1);
      }
      maxQuestions = value;
      i++;
    }
  }

  const sqlConfig: sql.config = {
    server: CONFIG.SQL_SERVER,
    database: CONFIG.SQL_DB,
    user: CONFIG.SQL_USER || undefined,
    password: CONFIG.SQL_PASSWORD || undefined,
    port: CONFIG.SQL_PORT,
    options: {
      encrypt: true,
      trustServerCertificate: true,
      enableArithAbort: true,
    },
  };

  const pool = await sql.connect(sqlConfig);

  let lastId = CONFIG.START_AFTER_ID;
  const limit = pLimit(CONFIG.CONCURRENCY);
  let totalProcessed = 0;
  let totalFailed = 0;
  const startTime = Date.now();

  // Buffer for batched database writes
  const writeBuffer: Array<{ questionId: number; spec: Spec }> = [];
  let pendingWrites = Promise.resolve();

  const flushWriteBuffer = async () => {
    if (writeBuffer.length === 0) return;
    const toWrite = writeBuffer.splice(0, CONFIG.DB_WRITE_BATCH_SIZE);
    await upsertSpecsBatch(pool, toWrite);
  };

  // Pipeline: start fetching next batch while processing current batch
  let nextBatchPromise: Promise<sql.IResult<any>> | null = null;

  while (true) {
    // Adjust batch size if we're near the max questions limit
    const remaining = maxQuestions ? maxQuestions - totalProcessed : undefined;
    const batchSize = remaining !== undefined && remaining < CONFIG.BATCH_SIZE 
      ? Math.max(1, remaining) 
      : CONFIG.BATCH_SIZE;

    // Use pre-fetched batch if available, otherwise fetch now
    let rs: sql.IResult<any>;
    if (nextBatchPromise) {
      rs = await nextBatchPromise;
      nextBatchPromise = null;
    } else {
      // Only fetch questions that don't already have specs (INSERT-only, no updates)
      rs = await pool.request()
        .input("lastId", sql.Int, lastId)
        .input("batchSize", sql.Int, batchSize)
        .query(`
          SELECT TOP (@batchSize)
            q.id, q.question, q.answer, q.category
          FROM dbo.questions q
          LEFT JOIN dbo.question_answer_specs s ON s.question_id = q.id
          WHERE q.id > @lastId
            AND s.question_id IS NULL
          ORDER BY q.id ASC;
        `);
    }

    const rows = rs.recordset as Array<{ id: number; question: string; answer: string; category: string | null }>;
    if (rows.length === 0) {
      // Flush any remaining writes
      await flushWriteBuffer();
      await pendingWrites;
      console.log("Done.");
      break;
    }

    const batchStartId = lastId;
    const currentLastId = rows[rows.length - 1].id;
    lastId = currentLastId;
    const batchStartTime = Date.now();

    // Pre-fetch next batch while processing current batch (pipeline optimization)
    // Only fetch questions without existing specs (INSERT-only processing)
    if (!maxQuestions || totalProcessed + rows.length < maxQuestions) {
      nextBatchPromise = pool.request()
        .input("lastId", sql.Int, currentLastId)
        .input("batchSize", sql.Int, batchSize)
        .query(`
          SELECT TOP (@batchSize)
            q.id, q.question, q.answer, q.category
          FROM dbo.questions q
          LEFT JOIN dbo.question_answer_specs s ON s.question_id = q.id
          WHERE q.id > @lastId
            AND s.question_id IS NULL
          ORDER BY q.id ASC;
        `);
    }

    // Process this batch while potentially fetching the next one
    const tasks = rows.map((r) =>
      limit(async () => {
        try {
          const raw = await callLMStudio(r);
          const spec = normalizeSpec(raw, r.answer);
          
          // Add to write buffer instead of writing immediately
          writeBuffer.push({ questionId: r.id, spec });
          
          // Flush buffer if it's getting large
          if (writeBuffer.length >= CONFIG.DB_WRITE_BATCH_SIZE) {
            const toWrite = writeBuffer.splice(0, CONFIG.DB_WRITE_BATCH_SIZE);
            pendingWrites = pendingWrites.then(() => upsertSpecsBatch(pool, toWrite));
          }
          
          return true;
        } catch (e: any) {
          totalFailed++;
          console.error(`Failed question_id=${r.id}: ${e?.message ?? e}`);
          return false;
        }
      })
    );

    const results = await Promise.all(tasks);
    const ok = results.filter(Boolean).length;
    totalProcessed += results.length;
    
    // Calculate batch time and overall rate
    const batchTime = ((Date.now() - batchStartTime) / 1000).toFixed(1);
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = totalProcessed / elapsed;
    const remainingTime = maxQuestions && rate > 0 
      ? Math.round((maxQuestions - totalProcessed) / rate) 
      : undefined;
    
    const avgTimePerQuestion = (parseFloat(batchTime) / results.length).toFixed(2);
    console.log(
      `Batch id=${batchStartId}-${lastId}: ${ok}/${results.length} ok ` +
      `(total: ${totalProcessed}${maxQuestions ? `/${maxQuestions}` : ""}, ` +
      `failed: ${totalFailed}, ` +
      `batch time: ${batchTime}s (${avgTimePerQuestion}s/q), ` +
      `rate: ${rate.toFixed(1)}/s` +
      `${remainingTime ? `, ETA: ${remainingTime}s` : ""})`
    );

    // Stop if we've reached the max questions limit
    if (maxQuestions && totalProcessed >= maxQuestions) {
      await flushWriteBuffer();
      await pendingWrites;
      console.log(`Reached max questions limit of ${maxQuestions}. Stopping.`);
      break;
    }
  }

  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
