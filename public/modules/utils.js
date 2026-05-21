// Shared utility functions with no imports from other app modules.
// Used by state.js, session.js, api.js, turns.js, memory.js, etc.

/**
 * Fast token estimate: ~1 token per 4 characters (GPT-style BPE approximation).
 * Good enough for budget decisions; not meant to be exact.
 */
export function estimateTokens(text) {
  return Math.ceil((text || "").length / 4);
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
      result += ch;
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
  const suffixes = ['"}\n', '"}', '"\n}', '" }', '"}}\n', '"}}"'];
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

export function normalizeAiResult(result, fallback) {
  const action = String(result.action || "speak").toLowerCase().includes("skip") ? "skip" : "speak";
  const message = stringifyMessage(result.message || result.content || result.response || "").trim();
  const normalized = {
    thought: String(result.thought || "").trim(),
    action: action === "skip" || !message ? "skip" : "speak",
    message: message || fallback.trim()
  };
  // Pass through optional documentEdit field for collaborative document feature
  if (result.documentEdit) {
    normalized.documentEdit = String(result.documentEdit).trim();
  }
  return normalized;
}

export function stringifyMessage(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
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
  if (message.type === "user" || !looksLikeEnvelope(message.content || "")) return message;

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
  return cleaned?.content || "";
}

export function stringifyList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join("\n");
  if (value && typeof value === "object") return Object.entries(value).map(([key, item]) => `${key}: ${stringifyList(item)}`).join("\n");
  return String(value || "").trim();
}

export function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  const text = String(value || "").trim();
  if (!text) return [];
  return text.split(/\n|,/).map((item) => item.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
}

export function trimWords(text, limit) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= limit) return words.join(" ");
  return `${words.slice(0, limit).join(" ")}...`;
}

export function extractKeywords(text) {
  const stop = new Set(["about", "after", "again", "also", "because", "before", "being", "could", "every", "from", "have", "into", "just", "like", "more", "need", "only", "other", "should", "that", "their", "there", "these", "they", "this", "through", "with", "would", "your"]);
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

export function normalizeQuickStartConfig(config, assignFreshIds = true) {
  const source = config && typeof config === "object" ? config : {};
  const scenario = source.scenario && typeof source.scenario === "object" ? source.scenario : {};
  const dm = source.dm && typeof source.dm === "object" ? source.dm : {};
  const memory = source.memory && typeof source.memory === "object" ? source.memory : {};
  const defaultActors = [
    { name: "Architect", role: "Systems thinker", persona: "You care about structure, tradeoffs, and how pieces fit together.", goal: "Turn messy ideas into a workable plan.", voice: "Calm, precise, concise.", thoughts: "", enabled: true },
    { name: "Skeptic", role: "Risk spotter", persona: "You notice gaps, ambiguity, and hidden costs.", goal: "Prevent the group from accepting easy answers too quickly.", voice: "Direct but constructive.", thoughts: "", enabled: true },
    { name: "Muse", role: "Creative spark", persona: "You look for surprising angles and emotionally resonant choices.", goal: "Add imaginative options that are still usable.", voice: "Warm, vivid, specific.", thoughts: "", enabled: true }
  ];
  const actorSources = Array.isArray(source.actors) && source.actors.length
    ? source.actors.slice(0, 8)
    : defaultActors;

  return {
    scenario: {
      mode: ["problem", "story", "freeform"].includes(scenario.mode) ? scenario.mode : "problem",
      title: cleanConfigText(scenario.title, "Untitled forum", 80),
      premise: cleanConfigText(scenario.premise, "A small group of local AI actors are gathered to discuss the user's topic.", 700),
      objective: cleanConfigText(scenario.objective, "Ask clarifying questions, challenge weak assumptions, and converge on practical next steps.", 500)
    },
    dm: {
      enabled: dm.enabled !== false,
      name: cleanConfigText(dm.name, "Director", 50),
      persona: cleanConfigText(dm.persona, "Keep the scene moving, summarize when useful, and invite quieter actors in without taking over.", 500),
      seesPrivateThoughts: dm.seesPrivateThoughts === true
    },
    actors: actorSources.map((actor, index) => normalizeQuickStartActor(actor, index, assignFreshIds)),
    memory: {
      pinnedFacts: cleanConfigText(memory.pinnedFacts, "", 700),
      sharedSummary: cleanConfigText(memory.sharedSummary, "", 900),
      openQuestions: cleanConfigText(memory.openQuestions, "", 500),
      dmState: cleanConfigText(memory.dmState, "", 500)
    }
  };
}
