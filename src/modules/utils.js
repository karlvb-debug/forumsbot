// Shared utility functions with no imports from other app modules.
// Used by state.js, session.js, api.js, turns.js, memory.js, etc.

/**
 * Fast token estimate: ~1 token per 4 characters (GPT-style BPE approximation).
 * Good enough for budget decisions; not meant to be exact.
 */
export function estimateTokens(text) {
  return Math.ceil((text || "").length / 4);
}

/**
 * Append a timestamped thought to an actor's rolling memory, keeping the last
 * 14 lines. Shared by turns.js and memory.js (previously duplicated in both).
 */
export function appendMemory(existing, thought) {
  if (!thought) return existing || "";
  const entries = [existing, `[${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}] ${thought}`]
    .filter(Boolean)
    .join("\n");
  return entries.split("\n").slice(-14).join("\n");
}

// ── Actor scheduling (cadence model) ─────────────────────────────────────────
// A single source of truth replacing the legacy four-way `turnSchedule` enum
// ('normal' | 'every-turn' | 'alternate' | 'on-call'). An actor is either a
// queue participant (speaks in sequential order) or a background actor that
// fires on a cadence: { unit: 'turn' | 'round', n: >=1 }.
//
//   queue participant     → cadence: null
//   every-turn background  → { unit: 'turn',  n: 1 }
//   every-other-turn       → { unit: 'turn',  n: 2 }
//   per-round background   → { unit: 'round', n: 1 }
//   every-N-rounds         → { unit: 'round', n: N }

/**
 * Migrate any actor's legacy scheduling fields to a normalized cadence.
 * Returns null for queue participants, or { unit, n } for background actors.
 * Pure — does not mutate the actor.
 */
export function normalizeCadence(actor) {
  if (!actor) return null;
  // Already migrated.
  if (actor.cadence && (actor.cadence.unit === 'turn' || actor.cadence.unit === 'round')) {
    const n = Math.max(1, Math.floor(Number(actor.cadence.n) || 1));
    return { unit: actor.cadence.unit, n };
  }
  // Legacy turnSchedule migration.
  switch (actor.turnSchedule) {
    case 'every-turn': return { unit: 'turn', n: 1 };
    case 'alternate':  return { unit: 'round', n: 2 };
    // 'on-call' actors never auto-fired; they only entered the queue when routed
    // to. Model that as a background actor that never fires on a cadence — it
    // still responds to triggers / direct routing. n: Infinity is not JSON-safe,
    // so we mark it on-call explicitly.
    case 'on-call':    return { unit: 'turn', n: 0 }; // n=0 → never auto-fires
    case 'normal':
    case undefined:
    case null:
    default:           return null; // queue participant
  }
}

/**
 * True when the actor takes ordinary sequential turns (is in the queue).
 * Background/cadence actors are excluded.
 */
export function isQueueActor(actor) {
  if (!actor) return false;
  if ((actor.actorMode || 'participant') === 'background') return false;
  return normalizeCadence(actor) === null;
}

/**
 * Decide whether a cadence (background) actor should fire on this tick.
 *
 * @param {object} cadence  - { unit: 'turn'|'round', n } from normalizeCadence
 * @param {object} counters - { turnIndex, roundIndex } 1-based counters of
 *                            completed turns / current round
 * @returns {boolean}
 */
export function shouldFireCadence(cadence, { turnIndex = 0, roundIndex = 0 } = {}) {
  if (!cadence) return false;
  const n = Math.floor(Number(cadence.n) || 0);
  if (n <= 0) return false; // on-call / disabled cadence never auto-fires
  if (cadence.unit === 'turn')  return turnIndex > 0 && turnIndex % n === 0;
  if (cadence.unit === 'round') return roundIndex > 0 && roundIndex % n === 0;
  return false;
}

/**
 * Cosine similarity between two equal-length numeric vectors. Returns 0 for
 * missing/mismatched/zero vectors. Shared by memory recall and telemetry drift.
 */
export function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function stripCodeFence(content) {
  return String(content || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

/**
 * Replace literal control characters (newlines, tabs, carriage returns) that
 * appear INSIDE JSON string values with their proper escape sequences.
 * Local models frequently emit raw newlines inside thought/message strings,
 * which causes JSON.parse to throw "Bad control character in string literal".
 */
export function sanitizeJsonString(content) {
  // Walk character by character to only replace inside quoted strings
  let result = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (escaped) {
      if (inString) {
        const isValidEscape = /["\\\/bfnrtu]/.test(ch);
        if (!isValidEscape) {
          result = result.slice(0, -1) + "\\\\" + ch;
        } else {
          result += ch;
        }
      } else {
        result += ch;
      }
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      result += ch;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }
    if (inString) {
      if (ch === "\n")      { result += "\\n";  continue; }
      if (ch === "\r")      { result += "\\r";  continue; }
      if (ch === "\t")      { result += "\\t";  continue; }
      if (ch.charCodeAt(0) < 0x20) { result += `\\u${ch.charCodeAt(0).toString(16).padStart(4,"0")}`; continue; }
    }
    result += ch;
  }
  return result;
}

export function extractBalancedObjects(content) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(content.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return objects;
}

export function looksLikeEnvelope(content) {
  const text = stripCodeFence(content);
  return text.includes("{") && text.includes("}") && /["']?(?:thought|action|message|content|response)["']?\s*:/i.test(text);
}

export function unescapeLooseString(value) {
  try {
    return JSON.parse(`"${value.replace(/"/g, "\\\"")}"`)
  } catch {
    return value.replace(/\\n/g, "\n").replace(/\\"/g, "\"").replace(/\\\\/g, "\\").trim();
  }
}

export function readLooseField(content, field) {
  const key = `["']?${field}["']?\\s*:`;
  // Try properly closed strings first
  const pattern = new RegExp(`${key}\\s*(?:"((?:\\\\.|[^"\\\\])*)"| '((?:\\\\.|[^'\\\\])*)'|([\\s\\S]*?)(?=,\\s*["']?(?:thought|action|message|content|response)["']?\\s*:|\\s*}\\s*$))`, "i");
  const match = content.match(pattern);
  if (match) {
    if (match[1] !== undefined) return unescapeLooseString(match[1]);
    if (match[2] !== undefined) return unescapeLooseString(match[2]);
    return String(match[3] || "").trim().replace(/,$/, "").trim();
  }
  // Fallback: handle truncated strings (no closing quote — model hit maxTokens)
  const truncPattern = new RegExp(`${key}\\s*"((?:\\\\.|[^"\\\\])*)$`, "i");
  const truncMatch = content.match(truncPattern);
  if (truncMatch && truncMatch[1]) return unescapeLooseString(truncMatch[1]);
  return "";
}

export function parseLooseEnvelope(content) {
  if (!looksLikeEnvelope(content)) return null;
  const message = readLooseField(content, "message") || readLooseField(content, "content") || readLooseField(content, "response");
  const thought = readLooseField(content, "thought") || "";
  const action = readLooseField(content, "action") || "speak";
  if (!message && !thought) return null;
  return { thought, action, message };
}

export function unwrapParsedEnvelope(value) {
  if (typeof value === "string") {
    return parseStrictEnvelope(value) || { message: value };
  }
  if (!value || typeof value !== "object") return null;
  if (value.message || value.thought || value.action) return value;
  if (value.content || value.response || value.text) {
    return {
      thought: value.thought || "",
      action: value.action || "speak",
      message: value.content || value.response || value.text
    };
  }
  return null;
}

/**
 * Try to repair truncated JSON by appending closing characters.
 * Models hitting maxTokens often produce: {"thought":"...", "message":"partial te
 * We try appending ",  "}, "}  to recover a parseable object.
 */
function tryRepairTruncatedJson(content) {
  // Note: '"}}"' (the old last entry) appended a stray quote after the closing
  // brace, producing invalid JSON that could never parse — dropped.
  const suffixes = ['"}\n', '"}', '"\n}', '" }', '"}}\n', '"}}'];
  for (const suffix of suffixes) {
    try {
      const envelope = unwrapParsedEnvelope(JSON.parse(content + suffix));
      if (envelope) return envelope;
    } catch { /* continue */ }
  }
  return null;
}

export function parseStrictEnvelope(content) {
  // Sanitize literal control characters that local models emit inside strings
  const safe = sanitizeJsonString(content);
  try {
    const envelope = unwrapParsedEnvelope(JSON.parse(safe));
    if (envelope) return envelope;
  } catch {
    // Try balanced sub-objects
    for (const candidate of extractBalancedObjects(safe)) {
      try {
        const envelope = unwrapParsedEnvelope(JSON.parse(sanitizeJsonString(candidate)));
        if (envelope) return envelope;
      } catch {
        // Keep trying
      }
    }
    // Try repairing truncated JSON (model hit maxTokens mid-string)
    const repaired = tryRepairTruncatedJson(safe);
    if (repaired) return repaired;
  }
  return null;
}


export function extractEmbeddedMessage(content) {
  if (!looksLikeEnvelope(content)) return "";
  return readLooseField(content, "message") || readLooseField(content, "content") || readLooseField(content, "response") || "";
}

export function stripLeakedTranscriptLines(content) {
  const lines = String(content || "").split(/\r?\n/);
  const kept = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,6}\s*recent transcript\b/i.test(trimmed)) continue;
    if (/^recent transcript\s*:/i.test(trimmed)) continue;
    if (/^\[(?:USER|DIRECTOR|SYSTEM|MODERATOR)\]\s*/i.test(trimmed)) continue;
    if (/^\[[^\]]+\s+skipped\]\s*$/i.test(trimmed)) continue;
    kept.push(line);
  }
  return kept.join("\n").trim();
}

export function normalizeAiResult(result, fallback) {
  const action = String(result.action || "speak").toLowerCase().includes("skip") ? "skip" : "speak";
  const message = stripLeakedTranscriptLines(stringifyMessage(result.message || result.content || result.response || "")).trim();
  const fallbackText = String(fallback || "");
  const fallbackLooksLikeEnvelope = looksLikeEnvelope(fallbackText) || /["']?(?:thought|action|message|content|response)["']?\s*:/i.test(stripCodeFence(fallbackText));
  const fallbackMessage = fallbackLooksLikeEnvelope ? "" : stripLeakedTranscriptLines(fallbackText).trim();
  const normalized = {
    thought: String(result.thought || "").trim(),
    action: action === "skip" || !message ? "skip" : "speak",
    message: message || fallbackMessage
  };
  // Pass through document edit fields
  if (result.documentEdit) {
    normalized.documentEdit = String(result.documentEdit).trim();
  }
  if (Array.isArray(result.documentEdits) && result.documentEdits.length) {
    normalized.documentEdits = result.documentEdits;
  }
  if (result.manageActors && typeof result.manageActors === "object") {
    normalized.manageActors = result.manageActors;
  }
  if (result.nextSpeaker) {
    normalized.nextSpeaker = String(result.nextSpeaker).trim();
  }
  if (result.anchor && String(result.anchor).trim()) {
    normalized.anchor = String(result.anchor).slice(0, 160).trim();
  }
  // CAP-8: Fact pin
  if (result.pinFact && String(result.pinFact).trim()) {
    normalized.pinFact = String(result.pinFact).slice(0, 200).trim();
  }
  // CAP-1: Prompt injections (director-initiated)
  if (Array.isArray(result.promptInjections) && result.promptInjections.length) {
    normalized.promptInjections = result.promptInjections;
  }
  // CAP-2: Private messages (actor-to-actor)
  if (Array.isArray(result.privateMessages) && result.privateMessages.length) {
    normalized.privateMessages = result.privateMessages;
  }
  // Pause request — actor asks user for input
  if (result.pauseRequest && typeof result.pauseRequest === "object") {
    const pr = result.pauseRequest;
    if (pr.reason && pr.defaultIfNoResponse) {
      normalized.pauseRequest = pr;
    }
  }
  return normalized;
}

export function stringifyMessage(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(stringifyMessage).join("\n\n");
  if (typeof value === "object") {
    return String(value.message || value.content || value.response || value.text || JSON.stringify(value));
  }
  return String(value);
}

export function parseAiJson(content) {
  const cleaned = stripCodeFence(content);
  const parsedEnvelope = parseStrictEnvelope(cleaned) || parseLooseEnvelope(cleaned);
  if (parsedEnvelope) {
    return normalizeAiResult(parsedEnvelope, content);
  }

  const embeddedMessage = extractEmbeddedMessage(cleaned);
  if (embeddedMessage && embeddedMessage !== cleaned) {
    return normalizeAiResult({ action: "speak", message: embeddedMessage, thought: "" }, content);
  }

  return normalizeAiResult({ action: "speak", message: content, thought: "" }, content);
}

export function cleanStoredMessage(message) {
  if (!message || typeof message !== "object") return message;
  if (message.type === "user") {
    const val = message.text || message.content || "";
    return {
      ...message,
      text: val,
      content: val
    };
  }
  if (!looksLikeEnvelope(message.content || "")) return message;

  const parsed = parseAiJson(message.content);
  if (!parsed.message || parsed.message === message.content) return message;

  return {
    ...message,
    type: parsed.action === "skip" ? "skip" : message.type,
    content: parsed.action === "skip" ? "Skipped." : parsed.message,
    thought: message.thought || parsed.thought
  };
}

export function publicMessageContent(message) {
  if (!message) return "";
  const cleaned = cleanStoredMessage(message);
  return cleaned?.content || cleaned?.text || cleaned?.message || "";
}

/**
 * Format a message array as a plain-text transcript string for use in prompts.
 * Canonical version shared by turns.js (re-exported) and memory.js.
 *
 * @param {object[]} messages  - array of message objects
 * @param {number}   wordLimit - max word count (trimWords applied)
 * @param {object[]} actors    - optional roster for actorId→name fallback;
 *                               defaults to [] (uses "Forum" for ID-only messages)
 */
export function formatTranscript(messages, wordLimit = 2600, actors = []) {
  if (!messages.length) return "No public messages yet.";
  const text = messages
    .filter((m) => (m.type !== "system" || m.speaker === "Moderator") && m.type !== "management")
    .map((message) => {
      const name = message.speaker || actors.find((a) => a.id === message.actorId)?.name || "Forum";
      if (message.type === "user" || (message.type === "system" && message.speaker === "Moderator")) {
        return `[USER] ${name}: ${publicMessageContent(message)}`;
      }
      if (message.type === "dm")     return `[DIRECTOR] ${name}: ${publicMessageContent(message)}`;
      if (message.type === "skip")   return `[${name} skipped]`;
      return `${name}: ${publicMessageContent(message)}`;
    }).join("\n");
  return trimWords(text, wordLimit);
}

export function stringifyList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join("\n");
  if (value && typeof value === "object") return Object.entries(value).map(([key, item]) => `${key}: ${stringifyList(item)}`).join("\n");
  return String(value || "").trim();
}

export function normalizeStringArray(value, splitOnComma = false) {
  let arr;
  if (Array.isArray(value)) {
    arr = value.map((item) => String(item).trim()).filter(Boolean);
  } else {
    const text = String(value || "").trim();
    if (!text) return [];
    if (text.startsWith("[") && text.endsWith("]")) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          arr = parsed.map((item) => String(item).trim()).filter(Boolean);
        }
      } catch {}
    }
    if (!arr) {
      const pattern = splitOnComma ? /\n|,/ : /\n/;
      arr = text.split(pattern).map((item) => item.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
    }
  }

  // Check for char-spread array corruption (e.g. ["P", "r", "o", "d", "u", "c", "t"])
  // — single character per item
  if (arr.length > 1 && arr.every((item) => item.length === 1)) {
    arr = [arr.join("")];
  }
  // Also catch word-split corruption (e.g. ["Use", "React", "hooks"])
  // — every item is a single word (no spaces), there are 4+ items, and the average
  //   item length is short (≤12 chars), which together strongly indicate a single
  //   sentence that was accidentally spread across array slots.
  else if (
    arr.length >= 4 &&
    arr.every((item) => !item.includes(" ")) &&
    arr.reduce((sum, item) => sum + item.length, 0) / arr.length <= 12
  ) {
    arr = [arr.join(" ")];
  }
  return arr;
}

export function trimWords(text, limit) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= limit) return words.join(" ");
  return `${words.slice(0, limit).join(" ")}...`;
}

// Stop words for keyword extraction. Hoisted to module scope (was rebuilt on
// every call) and de-duplicated (the literal previously listed many words twice).
const STOP_WORDS = new Set([
  "about", "above", "after", "again", "against", "all", "also", "am", "an", "and", "any",
  "are", "aren", "as", "at", "be", "because", "been", "before", "being", "below", "between",
  "both", "but", "by", "can", "cannot", "could", "did", "didn", "do", "does", "doesn",
  "doing", "don", "down", "during", "each", "every", "few", "for", "from", "further", "had",
  "hadn", "has", "hasn", "have", "haven", "having", "he", "her", "here", "hers",
  "herself", "him", "himself", "his", "how", "if", "in", "into", "is", "isn", "it",
  "its", "itself", "just", "let", "like", "me", "more", "most", "mustn", "my", "myself",
  "need", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought",
  "our", "ours", "ourselves", "out", "over", "own", "same", "shan", "she", "should",
  "shouldn", "so", "some", "such", "than", "that", "the", "their", "theirs", "them",
  "themselves", "then", "there", "these", "they", "this", "those", "through", "to", "too",
  "under", "until", "up", "very", "was", "wasn", "we", "were", "weren", "what", "when",
  "where", "which", "while", "who", "whom", "why", "will", "with", "would", "wouldn",
  "you", "your", "yours", "yourself", "yourselves"
]);

export function extractKeywords(text) {
  const stop = STOP_WORDS;
  const words = String(text || "").toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || [];
  const counts = new Map();
  words.forEach((word) => {
    if (stop.has(word) || word.length < 3) return;
    counts.set(word, (counts.get(word) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 40)
    .map(([word]) => word);
}

export function cleanConfigText(value, fallback, maxLength) {
  const text = stringifyList(value).replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, maxLength);
}

export function normalizeQuickStartActor(actor, index, assignFreshIds) {
  const source = actor && typeof actor === "object" ? actor : {};
  return {
    id: assignFreshIds ? crypto.randomUUID() : source.id || crypto.randomUUID(),
    name: cleanConfigText(source.name, `Actor ${index + 1}`, 50),
    role: cleanConfigText(source.role, "Participant", 70),
    persona: cleanConfigText(source.persona, "", 700),
    goal: cleanConfigText(source.goal, "", 500),
    voice: cleanConfigText(source.voice, "", 120),
    thoughts: cleanConfigText(source.thoughts, "", 700),
    enabled: source.enabled !== false,
    canDirect: !!(source.canDirect || source.isDirector),
    canResearch: !!(source.canResearch || source.isResearcher),
    canManageCast: !!(source.canManageCast || source.isManager),
    canSeeThoughts: !!source.canSeeThoughts,
    canWriteDocuments: !!(source.canWriteDocuments || source.isWriter),
    directorMode: ["narrator", "facilitator", "arbiter", "observer"].includes(source.directorMode) ? source.directorMode : undefined,
    color: ["#18726d", "#b84738", "#a2611a", "#355f9f", "#6e4c99", "#4f7d2d", "#9a4668"][index % 7]
  };
}

export function parseTextToolCalls(content) {
  const calls = [];
  const searchPattern = /\[SEARCH:\s*(.+?)\]/gi;
  const readPattern = /\[READ:\s*(.+?)\]/gi;
  let match;
  while ((match = searchPattern.exec(content)) !== null) {
    calls.push({ tool: "web_search", args: { query: match[1].trim() } });
  }
  while ((match = readPattern.exec(content)) !== null) {
    calls.push({ tool: "web_read", args: { url: match[1].trim() } });
  }
  return calls;
}

export function stripTextToolCalls(content) {
  return content
    .replace(/\[SEARCH:\s*.+?\]/gi, "")
    .replace(/\[READ:\s*.+?\]/gi, "")
    .trim();
}

export function stringifyBullets(value) {
  const items = normalizeStringArray(value);
  if (items.length) return items.map((item) => `- ${item}`).join("\n");
  return stringifyList(value);
}

export const DEFAULT_SYSTEMS = {
  stageDirections: { enabled: false, intensity: "moderate", maxTokenShare: 0.2 },
  alignment: { strictness: "moderate", anchorInPrompt: false, nudgeStyle: "gentle-nudge" },
  turnRouting: { strategy: "sequential", allowDirectAddress: true },
  dmRole: { role: "facilitator", narrates: false, canIntroduceElements: false }
};

export function normalizeSpeakingOrderStrategy(strategy) {
  if (strategy === "agentic" || strategy === "smart" || strategy === "dm-directed" || strategy === "narrative-flow") {
    return "agentic";
  }
  return "sequential";
}

export function legacySystemsFromMode(mode) {
  if (mode === "story") {
    return {
      stageDirections: { enabled: true, intensity: "immersive", maxTokenShare: 0.4 },
      alignment: { strictness: "loose", anchorInPrompt: false, nudgeStyle: "question" },
      turnRouting: { strategy: "agentic", allowDirectAddress: true },
      dmRole: { role: "narrator", narrates: true, canIntroduceElements: true }
    };
  }
  if (mode === "problem") {
    return {
      stageDirections: { enabled: false, intensity: "moderate", maxTokenShare: 0.2 },
      alignment: { strictness: "strict", anchorInPrompt: false, nudgeStyle: "hard-redirect" },
      turnRouting: { strategy: "sequential", allowDirectAddress: true },
      dmRole: { role: "facilitator", narrates: false, canIntroduceElements: false }
    };
  }
  if (mode === "freeform") {
    return {
      stageDirections: { enabled: false, intensity: "moderate", maxTokenShare: 0.2 },
      alignment: { strictness: "moderate", anchorInPrompt: false, nudgeStyle: "gentle-nudge" },
      turnRouting: { strategy: "sequential", allowDirectAddress: true },
      dmRole: { role: "facilitator", narrates: false, canIntroduceElements: false }
    };
  }
  return {};
}

function mergeSystemDefaults(base, legacy, raw) {
  return {
    stageDirections: { ...base.stageDirections, ...(legacy.stageDirections || {}), ...(raw.stageDirections || {}) },
    alignment: { ...base.alignment, ...(legacy.alignment || {}), ...(raw.alignment || {}) },
    turnRouting: { ...base.turnRouting, ...(legacy.turnRouting || {}), ...(raw.turnRouting || {}) },
    dmRole: { ...base.dmRole, ...(legacy.dmRole || {}), ...(raw.dmRole || {}) }
  };
}

export function normalizeQuickStartConfig(config, assignFreshIds = true) {
  const source = config && typeof config === "object" ? config : {};
  const scenario = source.scenario && typeof source.scenario === "object" ? source.scenario : {};
  const dm = source.dm && typeof source.dm === "object" ? source.dm : {};
  const memory = source.memory && typeof source.memory === "object" ? source.memory : {};
  const srcSettings = source.settings && typeof source.settings === "object" ? source.settings : null;
  const srcAutoStop = source.autoStop && typeof source.autoStop === "object" ? source.autoStop : null;
  const defaultActors = [
    { name: "Architect", role: "Systems thinker", persona: "You care about structure, tradeoffs, and how pieces fit together.", goal: "Turn messy ideas into a workable plan.", voice: "Calm, precise, concise.", thoughts: "", enabled: true },
    { name: "Skeptic", role: "Risk spotter", persona: "You notice gaps, ambiguity, and hidden costs.", goal: "Prevent the group from accepting easy answers too quickly.", voice: "Direct but constructive.", thoughts: "", enabled: true },
    { name: "Muse", role: "Creative spark", persona: "You look for surprising angles and emotionally resonant choices.", goal: "Add imaginative options that are still usable.", voice: "Warm, vivid, specific.", thoughts: "", enabled: true }
  ];
  const actorSources = Array.isArray(source.actors) && source.actors.length
    ? source.actors.slice(0, 8)
    : defaultActors;

  // ── Normalize scenario.systems (deep-merge with validation) ──
  const rawSystems = scenario.systems && typeof scenario.systems === "object" ? scenario.systems : {};
  const legacySystems = legacySystemsFromMode(scenario.mode);

  const normSub = (raw, defaults) => {
    if (!raw || typeof raw !== "object") return { ...defaults };
    const out = { ...defaults };
    for (const [k, v] of Object.entries(raw)) {
      if (v !== null && v !== undefined && k in defaults) out[k] = v;
    }
    return out;
  };

  const systemDefaults = mergeSystemDefaults(DEFAULT_SYSTEMS, legacySystems, {});
  const systems = {
    stageDirections: normSub(rawSystems.stageDirections, systemDefaults.stageDirections),
    alignment: normSub(rawSystems.alignment, systemDefaults.alignment),
    turnRouting: normSub(rawSystems.turnRouting, systemDefaults.turnRouting),
    dmRole: normSub(rawSystems.dmRole, systemDefaults.dmRole)
  };
  systems.turnRouting.strategy = normalizeSpeakingOrderStrategy(systems.turnRouting.strategy);

  // ── Normalize settings (pass through known fields) ──
  let settings = undefined;
  if (srcSettings) {
    settings = {};
    const numKeys = ["temperature", "maxTokens", "topP", "repeatPenalty", "seed", "preflightThreshold", "gravitySensitivity", "turnDelay"];
    const boolKeys = ["toolsEnabled", "globalStyleEnabled", "plainLanguageDefault", "streamingEnabled", "showThoughts", "turboMode", "seedEnabled", "enablePreflightRouter", "enableCrossSessionMemory", "enableAdaptiveCompression", "roundSnapshotEnabled"];
    const stringKeys = ["globalStylePrompt"];
    for (const k of numKeys) { if (typeof srcSettings[k] === "number") settings[k] = srcSettings[k]; }
    for (const k of boolKeys) { if (typeof srcSettings[k] === "boolean") settings[k] = srcSettings[k]; }
    for (const k of stringKeys) { if (typeof srcSettings[k] === "string") settings[k] = srcSettings[k]; }
    if (settings.plainLanguageDefault !== undefined && settings.globalStyleEnabled === undefined) {
      settings.globalStyleEnabled = settings.plainLanguageDefault;
    }
    delete settings.plainLanguageDefault;
    if (Object.keys(settings).length === 0) settings = undefined;
  }

  // ── Normalize autoStop (pass through known fields) ──
  let autoStop = undefined;
  if (srcAutoStop) {
    autoStop = {};
    if (typeof srcAutoStop.enabled === "boolean") autoStop.enabled = srcAutoStop.enabled;
    if (srcAutoStop.goal !== undefined) autoStop.goal = String(srcAutoStop.goal);
    if (typeof srcAutoStop.goalCheckEnabled === "boolean") autoStop.goalCheckEnabled = srcAutoStop.goalCheckEnabled;
    if (typeof srcAutoStop.stopOnAllSkip === "boolean") autoStop.stopOnAllSkip = srcAutoStop.stopOnAllSkip;
    if (typeof srcAutoStop.maxRoundsEnabled === "boolean") autoStop.maxRoundsEnabled = srcAutoStop.maxRoundsEnabled;
    if (typeof srcAutoStop.maxRounds === "number") autoStop.maxRounds = srcAutoStop.maxRounds;
    if (Object.keys(autoStop).length === 0) autoStop = undefined;
  }

  const result = {
    scenario: {
      title: cleanConfigText(scenario.title, "Untitled forum", 80),
      premise: cleanConfigText(scenario.premise, "A small group of local AI actors are gathered to discuss the user's topic.", 700),
      objective: cleanConfigText(scenario.objective, "Ask clarifying questions, challenge weak assumptions, and converge on practical next steps.", 500),
      systems
    },
    dm: {
      enabled: dm.enabled !== false,
      name: cleanConfigText(dm.name, "Director", 50),
      persona: cleanConfigText(dm.persona, "Keep the scene moving, summarize when useful, and invite quieter actors in without taking over.", 500),
      canSeeThoughts: !!(dm.canSeeThoughts || dm.seesPrivateThoughts),
      seesPrivateThoughts: !!(dm.canSeeThoughts || dm.seesPrivateThoughts)
    },
    actors: (() => {
      const normalized = actorSources.map((actor, index) => normalizeQuickStartActor(actor, index, assignFreshIds));
      // Enforce at most one director — keep the first, clear canDirect on the rest
      let foundDirector = false;
      normalized.forEach(a => {
        if (a.canDirect) { if (foundDirector) { a.canDirect = false; a.canManageCast = false; } else { foundDirector = true; } }
      });
      return normalized;
    })(),
    memory: {
      pinnedFacts: normalizeStringArray(memory.pinnedFacts).map(f => f.slice(0, 500)),
      sharedSummary: cleanConfigText(memory.sharedSummary, "", 900),
      openQuestions: normalizeStringArray(memory.openQuestions).map(q => q.slice(0, 500)),
      dmState: cleanConfigText(memory.dmState, "", 500)
    }
  };

  if (settings) result.settings = settings;
  if (autoStop) result.autoStop = autoStop;

  return result;
}

/**
 * Detects if the recent discussion is stuck in an agreement loop or drifting.
 * Analyses the last few messages to see if they are dominated by agreement keywords
 * and lack substance/questions/challenges.
 */
export function checkDrift(messages) {
  if (!Array.isArray(messages) || messages.length < 3) return false;
  
  // Look at the last 4 active messages (excluding skips, empty, system, or director messages)
  const recent = messages
    .filter(msg => msg && msg.type !== "skip" && msg.text && msg.role !== "system" && msg.role !== "director")
    .slice(-4);
    
  if (recent.length < 3) return false;

  // If any recent active message contains a question, it breaks the consensus loop
  if (recent.some(msg => msg.text.includes("?"))) {
    return false;
  }

  const agreementPatterns = [
    /\b(i\s+)?agree\b/i,
    /\bfully\s+agree\b/i,
    /\bconcur\b/i,
    /\bexcellent\s+point\b/i,
    /\bexactly\b/i,
    /\bspot\s+on\b/i,
    /\baligned\b/i,
    /\bwell\s+said\b/i,
    /\bcouldn't\s+agree\s+more\b/i,
    /\bbuilding\s+on\b/i,
    /\bmakes\s+sense\b/i,
    /\becho\b/i,
    /\bresonate\b/i,
    /\bconsensus\b/i,
    /\bshare\s+your\s+view\b/i
  ];

  let agreementCount = 0;
  for (const msg of recent) {
    const text = msg.text.toLowerCase();
    const hasAgreement = agreementPatterns.some(pattern => pattern.test(text));
    
    // An agreement message is one that has agreement keywords and doesn't contain a question
    if (hasAgreement && !text.includes("?")) {
      agreementCount++;
    }
  }

  // If 3 or more of the recent active messages are agreements, we have a consensus loop
  return agreementCount >= 3;
}
