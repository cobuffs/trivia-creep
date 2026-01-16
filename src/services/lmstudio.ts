/**
 * LMStudio service for normalizing answers
 * Handles checking if LMStudio server is running and normalizing question answers
 */

import dotenv from 'dotenv';

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

export type AnswerSpec = SingleSpec | NOfMSpec;

const CONFIG = {
  LM_BASE_URL: process.env.LM_BASE_URL ?? "http://localhost:1234/v1",
  LM_MODEL: process.env.LM_MODEL ?? "gemma-3-27b-it-heretic-v2-i1",
  PROMPT_VERSION: Number(process.env.PROMPT_VERSION ?? "1"),
  API_TIMEOUT_MS: Number(process.env.API_TIMEOUT_MS ?? "60000"),
  MAX_TOKENS: Number(process.env.MAX_TOKENS ?? "2048"),
};

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
  let repaired = jsonText;
  repaired = repaired.replace(/:\s*,/g, ': null,');
  repaired = repaired.replace(/:\s*}/g, ': null}');
  repaired = repaired.replace(/:\s*]/g, ': null]');
  repaired = repaired.replace(/,(\s*[}\]])/g, '$1');
  repaired = repaired.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
  return repaired;
}

function extractFirstJsonObject(s: string): any {
  let cleaned = s.trim();
  
  if (cleaned.startsWith('```')) {
    const lines = cleaned.split('\n');
    if (lines[0].match(/^```(json)?$/i)) {
      lines.shift();
    }
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

const NICKNAME_MAP: Record<string, string[]> = {
  teddy: ["theodore"],
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

/**
 * Validate and fix invalid n_of_m structures
 * If required_count > options.length, convert to single mode
 */
function validateAndFixSpec(spec: AnswerSpec, dbAnswer: string): AnswerSpec {
  // Only check n_of_m specs
  if (spec.answer_mode !== "n_of_m") {
    return spec;
  }

  const nOfMSpec = spec as NOfMSpec;
  
  // Check if invalid: required_count is greater than available options
  if (nOfMSpec.required_count > nOfMSpec.options.length) {
    // Convert to single mode
    const accepted: string[] = [];
    
    // Add all options to accepted
    accepted.push(...nOfMSpec.options);
    
    // Add all option aliases to accepted
    // First, add aliases for options that exist in the options array
    for (const opt of nOfMSpec.options) {
      if (nOfMSpec.option_aliases[opt]) {
        accepted.push(...nOfMSpec.option_aliases[opt]);
      }
    }
    
    // Also check for any option_aliases keys that might not match exactly
    // (shouldn't happen after normalization, but be safe)
    for (const optKey in nOfMSpec.option_aliases) {
      if (!nOfMSpec.options.includes(optKey)) {
        // This key doesn't match an option, but include its aliases anyway
        accepted.push(...nOfMSpec.option_aliases[optKey]);
      }
    }
    
    // Ensure the canonical answer is included
    const canon = normalizeText(dbAnswer);
    if (canon && !accepted.includes(canon)) {
      accepted.unshift(canon);
    }
    
    const single: SingleSpec = {
      answer_mode: "single",
      accepted: Array.from(new Set(accepted)),
      required_count: 0,
      allow_more_than_required: false,
      options: [],
      option_aliases: {},
      entity_type: nOfMSpec.entity_type,
    };
    
    // Apply person-specific enhancements
    const enhanced = addLastNameAcceptance(addNicknameExpansions(single));
    return enhanced;
  }
  
  return spec;
}

function normalizeSpec(raw: any, dbAnswer: string): AnswerSpec {
  const mode = raw?.answer_mode;
  const entity_type = toEntityType(raw?.entity_type);

  if (mode === "single") {
    const acceptedNorm = toStringArray(raw.accepted).map(normalizeText).filter(Boolean);
    const canon = normalizeText(dbAnswer);
    if (canon && !acceptedNorm.includes(canon)) acceptedNorm.unshift(canon);

    // Include options and option_aliases in accepted for single mode
    const optionsNorm = toStringArray(raw.options).map(normalizeText).filter(Boolean);
    acceptedNorm.push(...optionsNorm);

    // Add all option aliases to accepted
    const option_aliases_in = (raw.option_aliases && typeof raw.option_aliases === "object") ? raw.option_aliases : {};
    for (const key in option_aliases_in) {
      const aliases = toStringArray(option_aliases_in[key]).map(normalizeText).filter(Boolean);
      acceptedNorm.push(...aliases);
    }

    let single: SingleSpec = {
      answer_mode: "single",
      accepted: Array.from(new Set(acceptedNorm)),
      required_count: 0,
      allow_more_than_required: false,
      options: [],
      option_aliases: {},
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
      const rawAliases = toStringArray(option_aliases_in[opt] ?? []);
      option_aliases[opt] = Array.from(new Set(rawAliases.map(normalizeText).filter(Boolean)));
    }

    const nOfM: NOfMSpec = {
      answer_mode: "n_of_m",
      accepted: [],
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

function escapeJsonString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

async function callLMStudioOnce(userContent: string, useSchema: boolean, signal?: AbortSignal): Promise<string> {
  const body: any = {
    model: CONFIG.LM_MODEL,
    messages: [
      { role: "user", content: userContent },
    ],
    temperature: 0.1,
    seed: 42,
    top_p: 1.0,
    max_tokens: CONFIG.MAX_TOKENS,
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

async function callLMStudio(question: string, answer: string, category: string | null): Promise<any> {
  const userContent =
    `clue_text: "${escapeJsonString(question)}"\n` +
    `category: "${escapeJsonString(category ?? "")}"\n` +
    `answer_text: "${escapeJsonString(answer)}"\n\n` +
    `Return the JSON now.`;

  // Match the curl command exactly: no schema, direct call
  try {
    const content = await callLMStudioOnce(userContent, false);
    return extractFirstJsonObject(content);
  } catch {
    // Fallback: repair prompt
    const repair = userContent + `\n\nOutput ONLY valid JSON. No commentary.`;
    const content2 = await callLMStudioOnce(repair, false);
    return extractFirstJsonObject(content2);
  }
}

export class LMStudioService {
  /**
   * Check if LMStudio server is running
   */
  async isServerRunning(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout for health check

      const resp = await fetch(`${CONFIG.LM_BASE_URL}/models`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return resp.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Normalize a question answer using LMStudio
   */
  async normalizeAnswer(question: string, answer: string, category: string | null): Promise<AnswerSpec> {
    const raw = await callLMStudio(question, answer, category);
    const spec = normalizeSpec(raw, answer);
    // Validate and fix invalid n_of_m structures
    return validateAndFixSpec(spec, answer);
  }
}
