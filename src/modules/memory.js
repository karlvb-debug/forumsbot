import { WORD_LIMITS, PROMPT_MESSAGE_LIMIT, RECALLED_CHUNK_LIMIT, PINNED_FACTS_WORD_CAP, DELTA_REWRITE_EVERY } from './constants.js';
import { state, saveState, logTransition } from './state.js';
import { chatCompletion, getEmbedding, getEmbeddingsBatch, setStatus } from './api.js';
import { saveState as _hookSaveState } from '../hooks/useForumState.js';
import { setBusy, getBusy as getIsGenerating } from '../hooks/useActions.js';
import { getAllChunks, putChunk, clearChunks, countChunks, getAllMessages } from './db.js';
import { trimWords, stringifyList, normalizeStringArray, extractKeywords, stringifyBullets, stripCodeFence, extractBalancedObjects, sanitizeJsonString } from './utils.js';

// Minimum cosine similarity for a chunk to be injected into a prompt.
// Chunks scoring below this are noise, not signal. Only applies when
// vector embeddings are available; keyword-scored chunks always pass.
const MIN_RECALL_SIMILARITY = 0.20;

export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
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

export async function recallRelevantChunks(actor) {
  const chunks = await getAllChunks();
  if (!chunks.length) return [];

  // Detect embedding model mismatch — vectors from different models are incompatible.
  // Prefer state.settings.embeddingModel (the dedicated embedding model field) over the
  // chat model name, which changes independently and would produce false mismatch positives.
  const currentEmbedModel = state.settings.embeddingModel || state.settings.model || "";
  const storedModels = new Set(chunks.map(c => c.embeddingModel).filter(Boolean));
  const modelMismatch = storedModels.size > 0 && currentEmbedModel && !storedModels.has(currentEmbedModel);
  if (modelMismatch) {
    console.warn("[memory] Embedding model changed since chunks were stored. Falling back to keyword-only recall.",
      { stored: [...storedModels], current: currentEmbedModel });
  }

  // Composite query: actor goal + role + recent messages + open questions mentioning actor.
  const actorMentions = actor?.name
    ? normalizeStringArray(state.memory.openQuestions).filter(q => q.toLowerCase().includes(actor.name.toLowerCase())).join(" ")
    : "";
  const queryText = [
    state.scenario.title,
    state.scenario.objective,
    state.scenario.premise,
    actor?.name,
    actor?.role,
    actor?.goal,
    actorMentions,
    formatTranscript(state.messages.slice(-3), 400) // last 3 messages only — more precise
  ].filter(Boolean).join("\n");

  const queryKeywords = extractKeywords(queryText);
  const latest = chunks[chunks.length - 1];

  let queryVector = null;
  const hasVectors = !modelMismatch && chunks.some(c => Array.isArray(c.vector));
  if (hasVectors) {
    try {
      queryVector = await getEmbedding(queryText);
    } catch (err) {
      console.warn("Embeddings API not available or failed; falling back to keywords.", err);
    }
  }

  const scored = chunks.map((chunk, index) => {
    let similarity = 0;
    let usedVector = false;
    if (queryVector && Array.isArray(chunk.vector) && !modelMismatch) {
      similarity = cosineSimilarity(queryVector, chunk.vector);
      usedVector = true;
    } else {
      // Keyword overlap as a co-equal signal (BM25-style approximation)
      const chunkKeywords = Array.isArray(chunk.keywords) ? chunk.keywords : extractKeywords(chunk.text || "");
      const overlap = chunkKeywords.filter((keyword) => queryKeywords.includes(keyword)).length;
      similarity = Math.min(1, overlap / 15);
    }
    // Only filter by MIN_RECALL_SIMILARITY when using vectors — keyword scores are already sparse
    if (usedVector && similarity < MIN_RECALL_SIMILARITY) {
      return { chunk, score: -Infinity }; // will be filtered
    }
    const speakerBonus = actor && (chunk.speakers || []).includes(actor.name) ? 2 : 0;
    const recency = index / Math.max(1, chunks.length);
    return { chunk, score: similarity * 8 + speakerBonus + recency };
  }).filter(item => item.score > -Infinity)
    .sort((left, right) => right.score - left.score);

  const selected = [latest, ...scored.map((item) => item.chunk)]
    .filter((chunk, index, list) => chunk && list.findIndex((item) => item.id === chunk.id) === index)
    .slice(0, RECALLED_CHUNK_LIMIT);
  return selected.sort((left, right) => new Date(left.createdAt || 0) - new Date(right.createdAt || 0));
}

// formatTranscript is duplicated here from turns.js to avoid a circular dep
// (memory.js needs it, and turns.js imports memory.js)
function formatTranscript(messages, wordLimit = WORD_LIMITS.recentTranscript) {
  if (!messages.length) return "No public messages yet.";
  const text = messages
    .filter((m) => (m.type !== "system" || m.speaker === "Moderator") && m.type !== "management")
    .map((message) => {
      const name = message.speaker || state.actors.find((actor) => actor.id === message.actorId)?.name || "Forum";
      if (message.type === "user" || (message.type === "system" && message.speaker === "Moderator")) {
        return `[USER] ${name}: ${publicMsgContent(message)}`;
      }
      if (message.type === "dm") {
        return `[DIRECTOR] ${name}: ${publicMsgContent(message)}`;
      }
      return `${name}: ${publicMsgContent(message)}`;
    }).join("\n");
  return trimWords(text, wordLimit);
}

function publicMsgContent(message) {
  if (!message) return "";
  return message.content || "";
}

function scenarioBlock() {
  const labelForMode = (mode) => {
    if (mode === "story") return "Story";
    if (mode === "freeform") return "Freeform";
    return "Problem";
  };
  return [
    `Mode: ${labelForMode(state.scenario.mode)}`,
    `Title: ${state.scenario.title || "Untitled forum"}`,
    state.scenario.premise ? `Premise: ${state.scenario.premise}` : "",
    state.scenario.objective ? `Objective: ${state.scenario.objective}` : ""
  ].filter(Boolean).join("\n");
}

export async function messagesSinceLastSummary() {
  const dbMessages = await getAllMessages();
  const allMsgs = dbMessages.length ? dbMessages : state.messages;

  if (!state.memory.lastSummaryMessageId) return allMsgs.slice(-PROMPT_MESSAGE_LIMIT);
  const index = allMsgs.findIndex((message) => message.id === state.memory.lastSummaryMessageId);
  return index >= 0 ? allMsgs.slice(index + 1) : allMsgs.slice(-PROMPT_MESSAGE_LIMIT);
}

export async function summarizeMemory(reason = "manual", sourceMessages = null, options = {}) {
  if (!state.memory.enabled) {
    if (reason === "manual") setStatus("Memory is off.", "warn");
    return;
  }
  if (!state.settings.model) {
    if (reason === "manual") setStatus("Choose or type a model before summarizing memory.", "warn");
    return;
  }
  if (state.memory.isSummarizing) return;

  const messages = sourceMessages?.length ? sourceMessages : await messagesSinceLastSummary();
  const usableMessages = messages.length ? messages : state.messages.slice(-PROMPT_MESSAGE_LIMIT);
  if (!usableMessages.length) {
    if (reason === "manual") setStatus("No conversation to summarize yet.", "warn");
    return;
  }

  if (options.reset) {
    state.memory.sharedSummary = "";
    state.memory.pinnedFacts = [];
    state.memory.openQuestions = [];
    state.memory.dmState = "";
    state.memory.recentDeltas = [];
    state.memory.cycleCount = 0;
  }

  const isBackground = reason === "cycle" || reason === "round";
  state.memory.isSummarizing = true;

  if (isBackground) {
    state.memory.status = "Updating memory in background..."; saveState();
  } else {
    setBusy(true);
    setStatus("Updating memory...", "pending");
  }

  // Collect names of actors who actually spoke — prevents hallucinated silent actor updates.
  const speakerNames = new Set(usableMessages.map(m => m.speaker).filter(Boolean));
  const activeActorNames = state.actors
    .filter(a => a.enabled && speakerNames.has(a.name))
    .map(a => a.name);
  const silentActorNote = activeActorNames.length
    ? `Only update actorMemoryUpdates for actors who spoke: ${activeActorNames.join(", ")}. Set others to null.`
    : "No actors spoke; set actorMemoryUpdates to {}";

  // ── Append-then-compress strategy ────────────────────────────────────────────
  // Background cycles: generate a short delta bullet summary and append it.
  // Every DELTA_REWRITE_EVERY cycles (or on manual/rebuild), do a full rewrite
  // anchored by pinned facts to prevent telephone-game drift.
  const needsFullRewrite = !isBackground
    || reason === "rebuild"
    || (state.memory.cycleCount > 0 && state.memory.cycleCount % DELTA_REWRITE_EVERY === 0)
    || !state.memory.sharedSummary; // always do full rewrite if no summary yet

  try {
    if (isBackground && !needsFullRewrite) {
      // ── DELTA path: short bullet update only ─────────────────────────────────
      const deltaSystem = [
        "You write a SHORT bullet-point update (3-5 bullets, max 120 words) summarising ONLY what just happened in these turns.",
        "Do NOT rewrite or repeat the existing summary. Only capture NEW information.",
        silentActorNote,
        "Return only valid JSON: {\"delta\":\"bullet summary of new events\",\"actorMemoryUpdates\":{\"Actor Name\":\"short update or null\"},\"actorRelationshipUpdates\":{\"Actor A\":{\"Actor B\":\"how A now sees B, max 25 words, or null if unchanged\"}},\"pinnedFactSuggestions\":[\"any critical new facts\"],\"keywords\":[\"lowercase\",\"keywords\"]}"
      ].join("\n");
      const deltaUser = [
        scenarioBlock(),
        `Existing pinned facts:\n${normalizeStringArray(state.memory.pinnedFacts).join("\n") || "None."}`,
        `Existing summary (do NOT repeat this):\n${trimWords(state.memory.sharedSummary, 160) || "None."}`,
        `New turns to summarise:\n${formatTranscript(usableMessages, 900)}`
      ].join("\n\n");

      const content = await chatCompletion(deltaSystem, deltaUser, { temperature: 0.2, maxTokens: 400 });
      const raw = parseMemoryJson(content);
      const delta = trimWords(stringifyList(raw.delta), WORD_LIMITS.cycleDelta);

      if (delta) {
        state.memory.recentDeltas.push(`[${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}] ${delta}`);
        // Keep only the last 8 deltas to cap memory
        if (state.memory.recentDeltas.length > 8) {
          state.memory.recentDeltas = state.memory.recentDeltas.slice(-8);
        }
      }
      // Still update actor memories and pinned fact suggestions from the delta
      const keywords = normalizeStringArray(raw.keywords, true).map(k => k.toLowerCase()).filter(Boolean);
      const deltaUpdate = {
        ...raw,
        actorMemoryUpdates: raw.actorMemoryUpdates || {},
        actorRelationshipUpdates: raw.actorRelationshipUpdates || {},
        pinnedFactSuggestions: normalizeStringArray(raw.pinnedFactSuggestions).slice(0, 4),
        chunkSummary: delta,
        keywords
      };
      applyActorMemoryUpdates(deltaUpdate.actorMemoryUpdates);
      applyActorRelationshipUpdates(deltaUpdate.actorRelationshipUpdates);
      await applyPinnedFactSuggestions(deltaUpdate.pinnedFactSuggestions);
      await archiveMemoryChunk(deltaUpdate, usableMessages);

    } else {
      // ── FULL REWRITE path: rebuild from deltas + archive ─────────────────────
      // Anchor the rewrite with pinned facts to prevent drift.
      const deltaContext = state.memory.recentDeltas.length
        ? `Recent cycle updates (newest last):\n${state.memory.recentDeltas.join("\n")}`
        : "";

      const system = [
        "You update compact long-term memory for a local multi-actor AI forum.",
        "Be ruthless about compression — the next model may have a small context window.",
        "IMPORTANT: The pinned facts below are ground truth. Build your summary around them, never contradict them.",
        "For 'actorMemoryUpdates', summarize what each actor learned, their relationship changes, trust, and perspective of other actors.",
        "For 'actorRelationshipUpdates', update each actor's opinion of every OTHER actor they interacted with this session. Each entry is max 25 words. Only include actors who showed meaningful relationship change.",
        silentActorNote,
        "Return only valid JSON with this exact shape (ALL values must be strings, not arrays or objects, EXCEPT actorMemoryUpdates and actorRelationshipUpdates which are objects):",
        "{\"sharedSummary\":\"300-500 word durable summary\",\"openQuestions\":\"unresolved questions, one per line\",\"dmState\":\"scenario state, empty string if none\",\"chunkSummary\":\"100-150 word summary of the source turns\",\"actorMemoryUpdates\":{\"Actor Name\":\"short private memory update\"},\"actorRelationshipUpdates\":{\"Actor A\":{\"Actor B\":\"how A now sees B, max 25 words, or null if unchanged\"}},\"pinnedFactSuggestions\":[\"facts to pin\"],\"keywords\":[\"lowercase keywords\"]}",
        "CRITICAL: openQuestions, dmState, sharedSummary, and chunkSummary MUST be plain strings, never arrays or objects. actorRelationshipUpdates and actorMemoryUpdates MUST be objects."
      ].join("\n");
      const user = [
        `Reason: ${reason}`,
        scenarioBlock(),
        `Pinned facts (ground truth — anchor your summary around these):\n${normalizeStringArray(state.memory.pinnedFacts).join("\n") || "None."}`,
        `Existing shared summary:\n${state.memory.sharedSummary || "None."}`,
        deltaContext,
        `Existing open questions:\n${normalizeStringArray(state.memory.openQuestions).join("\n") || "None."}`,
        `Existing DM state:\n${state.memory.dmState || "None."}`,
        `Source turns:\n${formatTranscript(usableMessages, 1600)}`
      ].filter(Boolean).join("\n\n");

      const content = await chatCompletion(system, user, { temperature: 0.2, maxTokens: 1600 });
      const parsed = parseMemoryJson(content);
      console.debug('[memory] Parsed keys:', Object.keys(parsed), 'sharedSummary type:', typeof parsed.sharedSummary, 'openQ type:', typeof parsed.openQuestions);
      const memoryUpdate = normalizeMemoryUpdate(parsed, usableMessages);
      await applyMemoryUpdate(memoryUpdate);
      applyActorRelationshipUpdates(memoryUpdate.actorRelationshipUpdates || {});
      await archiveMemoryChunk(memoryUpdate, usableMessages);
      // Clear accumulated deltas after full rewrite
      state.memory.recentDeltas = [];
    }

    state.memory.cycleCount += 1;
    state.memory.lastSummaryMessageId = usableMessages[usableMessages.length - 1]?.id || state.memory.lastSummaryMessageId;
    state.memory.turnsSinceSummary = 0;
    saveState();
    if (!isBackground) setStatus("Memory updated.", "ok");

  } catch (error) {
    if (!isBackground) {
      setStatus(error.message || "Memory update failed.", "error");
    } else {
      console.warn("Background memory update failed:", error);
    }
  } finally {
    state.memory.isSummarizing = false;
    if (isBackground) saveState();
    else setBusy(false);
  }
}

export function parseMemoryJson(content) {
  const cleaned = sanitizeJsonString(stripCodeFence(content));
  // Try direct parse
  const direct = tryParseJson(cleaned);
  if (direct) return direct;

  // Try balanced-object extraction
  for (const candidate of extractBalancedObjects(cleaned)) {
    const parsed = tryParseJson(candidate);
    if (parsed) return parsed;
  }

  // Try repairing truncated JSON (close unclosed brackets/braces)
  const repaired = repairTruncatedJson(cleaned);
  if (repaired) {
    console.warn('[memory] Repaired truncated JSON');
    return repaired;
  }

  console.warn('[memory] Could not parse memory JSON, treating as raw summary');
  return { sharedSummary: cleaned };
}

function tryParseJson(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function repairTruncatedJson(text) {
  // Find the last successfully closed key-value pair
  let repaired = text.trim();
  // Remove trailing incomplete value (after last complete key:value)
  // Try progressively trimming from the end
  for (let i = 0; i < 10; i++) {
    // Remove trailing partial content after last comma or colon
    repaired = repaired.replace(/,\s*"[^"]*"\s*:\s*(?:"[^"]*|\[[^\]]*|\{[^}]*)$/, '');
    repaired = repaired.replace(/,\s*"[^"]*"\s*:?\s*$/, '');
    repaired = repaired.replace(/,\s*$/, '');
    // Close any unclosed structures
    const opens = (repaired.match(/\{/g) || []).length;
    const closes = (repaired.match(/\}/g) || []).length;
    const openBrackets = (repaired.match(/\[/g) || []).length;
    const closeBrackets = (repaired.match(/\]/g) || []).length;
    let attempt = repaired;
    for (let b = 0; b < openBrackets - closeBrackets; b++) attempt += ']';
    for (let b = 0; b < opens - closes; b++) attempt += '}';
    const result = tryParseJson(attempt);
    if (result) return result;
  }
  return null;
}

export function validateMemoryOutput(value) {
  return normalizeStringArray(value).filter((item) => typeof item === "string" && item.trim().length > 1);
}

export function normalizeMemoryUpdate(update, sourceMessages) {
  const fallbackKeywords = extractKeywords(formatTranscript(sourceMessages, 1200)).slice(0, 16);
  const coerceText = (val, label) => {
    if (typeof val === "string") return val;
    if (val && typeof val === "object") {
      console.warn(`[memory] normalizeMemoryUpdate: ${label} was object, coercing`, val);
      return stringifyList(val);
    }
    return String(val || "");
  };
  return {
    sharedSummary: trimWords(coerceText(update.sharedSummary, "sharedSummary"), WORD_LIMITS.sharedSummary),
    openQuestions: validateMemoryOutput(update.openQuestions).slice(0, 10),
    dmState: trimWords(coerceText(update.dmState, "dmState"), WORD_LIMITS.dmState),
    actorMemoryUpdates: update.actorMemoryUpdates && typeof update.actorMemoryUpdates === "object" ? update.actorMemoryUpdates : {},
    actorRelationshipUpdates: update.actorRelationshipUpdates && typeof update.actorRelationshipUpdates === "object" ? update.actorRelationshipUpdates : {},
    pinnedFactSuggestions: validateMemoryOutput(update.pinnedFactSuggestions).slice(0, 8),
    chunkSummary: trimWords(coerceText(update.chunkSummary || update.sharedSummary, "chunkSummary"), WORD_LIMITS.chunk),
    keywords: normalizeStringArray(update.keywords, true).concat(fallbackKeywords).map((keyword) => keyword.toLowerCase()).filter(Boolean).slice(0, 24)
  };
}

export async function applyMemoryUpdate(update) {
  if (typeof update.sharedSummary === "string" && update.sharedSummary) state.memory.sharedSummary = update.sharedSummary;
  if (Array.isArray(update.openQuestions)) state.memory.openQuestions = update.openQuestions;
  const hasDirector = state.actors.some(a => a.canDirect && a.enabled);
  if (hasDirector && typeof update.dmState === "string") state.memory.dmState = update.dmState;
  applyActorMemoryUpdates(update.actorMemoryUpdates);
  await applyPinnedFactSuggestions(update.pinnedFactSuggestions);
}

// Session-scoped vector cache for pinned/pending fact strings.
// Keyed by lowercased fact text — avoids re-embedding the same string multiple times.
// Cleared on page reload (in-memory only, never persisted).
const _factVectorCache = new Map();

async function getFactVector(factText) {
  const key = factText.toLowerCase().trim();
  if (_factVectorCache.has(key)) return _factVectorCache.get(key);
  try {
    const vec = await getEmbedding(factText);
    if (Array.isArray(vec) && vec.length > 0) {
      _factVectorCache.set(key, vec);
      return vec;
    }
  } catch {
    // Embedding unavailable — caller falls back to exact-match dedup
  }
  return null;
}

async function applyPinnedFactSuggestions(suggestions) {
  const embeddingModel = state.settings.embeddingModel || state.settings.model || "";
  const newFacts = (suggestions || []).filter(Boolean);
  if (!newFacts.length) return;

  const allExisting = [...state.memory.pinnedFacts, ...state.memory.pendingPinnedFacts];

  // Pre-embed all new facts + all existing facts in two batched calls to minimize round trips.
  let newVecs = null;
  let existingVecs = null;
  if (embeddingModel && allExisting.length > 0) {
    try {
      // Only embed texts not already in the cache
      const newTexts = newFacts.filter(f => !_factVectorCache.has(f.toLowerCase().trim()));
      const existingTexts = allExisting.filter(f => !_factVectorCache.has(f.toLowerCase().trim()));

      const batchTexts = [...newTexts, ...existingTexts];
      if (batchTexts.length > 0) {
        const batchVecs = await getEmbeddingsBatch(batchTexts);
        batchTexts.forEach((text, i) => {
          if (Array.isArray(batchVecs[i]) && batchVecs[i].length > 0) {
            _factVectorCache.set(text.toLowerCase().trim(), batchVecs[i]);
          }
        });
      }
      newVecs = newFacts.map(f => _factVectorCache.get(f.toLowerCase().trim()) ?? null);
      existingVecs = allExisting.map(f => _factVectorCache.get(f.toLowerCase().trim()) ?? null);
    } catch {
      // Batch embedding failed — fall back to exact-match dedup only
    }
  }

  for (let ni = 0; ni < newFacts.length; ni++) {
    const fact = newFacts[ni];

    // Fast path: exact lowercase match
    if (allExisting.some(f => f.toLowerCase() === fact.toLowerCase())) continue;

    // Semantic path: cosine similarity using pre-computed vectors
    if (embeddingModel && newVecs?.[ni] && existingVecs) {
      let maxSim = 0;
      for (let ei = 0; ei < allExisting.length; ei++) {
        if (existingVecs[ei]) {
          const sim = cosineSimilarity(newVecs[ni], existingVecs[ei]);
          if (sim > maxSim) maxSim = sim;
        }
      }
      if (maxSim > 0.88) {
        console.debug(`[memory] Dedup: skipping near-duplicate fact (sim=${maxSim.toFixed(3)}): "${fact}"`);
        continue;
      }
    }

    state.memory.pendingPinnedFacts.push(trimWords(fact, 40));
  }
}

export function applyActorMemoryUpdates(updates) {
  Object.entries(updates || {}).forEach(([nameOrId, update]) => {
    if (!update) return; // null means silent actor — skip
    const text = trimWords(stringifyList(update), 80);
    if (!text) return;
    const actor = state.actors.find((item) => item.id === nameOrId || item.name.toLowerCase() === nameOrId.toLowerCase());
    if (actor) {
      actor.thoughts = trimWords(appendMemory(actor.thoughts, text), WORD_LIMITS.actorMemory);
    }
  });
}

/**
 * Apply per-actor relationship updates from the summariser.
 * Shape: { "ActorA": { "ActorB": "how A now sees B" }, ... }
 * Merges into actor.relationships[otherActorName], capped at WORD_LIMITS.relationship.
 */
export function applyActorRelationshipUpdates(updates) {
  Object.entries(updates || {}).forEach(([actorName, opinions]) => {
    if (!opinions || typeof opinions !== "object") return;
    const actor = state.actors.find(a => a.name.toLowerCase() === actorName.toLowerCase());
    if (!actor) return;
    if (!actor.relationships) actor.relationships = {};
    Object.entries(opinions).forEach(([otherName, note]) => {
      if (!note || note === "null") return;
      actor.relationships[otherName] = trimWords(stringifyList(note), WORD_LIMITS.relationship);
    });
  });
}

function appendMemory(existing, thought) {
  if (!thought) return existing || "";
  const entries = [existing, `[${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}] ${thought}`]
    .filter(Boolean)
    .join("\n");
  return entries.split("\n").slice(-14).join("\n");
}

export async function archiveMemoryChunk(update, sourceMessages) {
  const speakers = [...new Set(sourceMessages.map((message) => message.speaker).filter(Boolean))];
  const chunkText = update.chunkSummary || formatTranscript(sourceMessages, WORD_LIMITS.chunk);

  // Store the embedding model name so we can detect model changes later.
  const embeddingModel = state.settings.embeddingModel || state.settings.model || "";
  let vector = null;
  let vectorDim = null;
  let embeddingStatus = "skipped";

  if (embeddingModel) {
    try {
      vector = await getEmbedding(chunkText);
      if (Array.isArray(vector)) {
        vectorDim = vector.length;
        embeddingStatus = "success";
      } else {
        throw new Error("Invalid embedding response format.");
      }
    } catch (err) {
      embeddingStatus = "failed";
      console.warn("[memory] Embedding generation failed for archived chunk. Falling back to keyword-only.", err);
      setStatus("Embedding generation failed. Falling back to keyword-only recall.", "warn");
    }
  } else {
    console.debug("[memory] No model configured for embedding, skipping vector generation.");
  }

  const chunk = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    text: chunkText,
    keywords: update.keywords.length ? update.keywords : extractKeywords(formatTranscript(sourceMessages, 1000)),
    speakers,
    mode: state.scenario.mode,
    title: state.scenario.title,
    messageIds: sourceMessages.map((message) => message.id),
    embeddingModel,
    embeddingStatus,
    vectorDim,
    vector
  };
  try {
    await putChunk(chunk);
    logTransition("chunk_created", { chunkId: chunk.id, textLength: chunk.text.length, keywordsCount: chunk.keywords.length });
  } catch (err) {
    console.error("Failed to archive memory chunk in database:", err);
  }
}

export function approvePinnedFacts(approvedIndices) {
  // approvedIndices is an array of indexes into pendingPinnedFacts to approve
  // (passed from the React component's checkboxes)
  const indices = approvedIndices || [];
  const approved = indices
    .map((i) => state.memory.pendingPinnedFacts[i])
    .filter(Boolean);
  if (!approved.length) return;
  state.memory.pinnedFacts = [...state.memory.pinnedFacts, ...approved];
  state.memory.pendingPinnedFacts = state.memory.pendingPinnedFacts.filter((fact) => !approved.includes(fact));
  approved.forEach(fact => {
    logTransition("fact_promoted", { fact });
  });
  saveState();
  // Warn if approaching the word cap
  const wordCount = state.memory.pinnedFacts.join("\n").trim().split(/\s+/).length;
  if (wordCount > PINNED_FACTS_WORD_CAP * 0.8) {
    setStatus(`Pinned facts are ${wordCount} words — approaching the ${PINNED_FACTS_WORD_CAP}‑word cap. Consider compacting.`, "warn");
  }
}

/**
 * Ask the model to merge duplicate/redundant pinned facts and return a
 * shorter, deduplicated list. Replaces the current pinnedFacts in place.
 */
export async function compactPinnedFacts() {
  if (!state.settings.model) {
    setStatus("Choose a model before compacting facts.", "warn");
    return;
  }
  if (!state.memory.pinnedFacts.length) {
    setStatus("No pinned facts to compact.", "warn");
    return;
  }
  const wordCount = state.memory.pinnedFacts.join("\n").trim().split(/\s+/).length;
  if (wordCount <= PINNED_FACTS_WORD_CAP * 0.5) {
    setStatus("Pinned facts are already concise — no compaction needed.", "warn");
    return;
  }

  setBusy(true);
  setStatus("Compacting pinned facts...", "pending");
  try {
    const system = [
      "You are a careful editor. Merge and deduplicate a list of pinned facts for an AI forum.",
      `Return a single compact bullet list (- fact per line). Maximum ${PINNED_FACTS_WORD_CAP} words total.`,
      "Preserve all unique information. Merge facts about the same entity into one bullet. Remove exact duplicates.",
      "Return ONLY the bullet list — no JSON, no preamble."
    ].join("\n");
    const user = `Current pinned facts:\n${state.memory.pinnedFacts.join("\n")}`;
    const result = await chatCompletion(system, user, { temperature: 0.1, maxTokens: 600 });
    const compacted = result.trim();
    if (compacted) {
      state.memory.pinnedFacts = normalizeStringArray(trimWords(compacted, PINNED_FACTS_WORD_CAP));
      saveState();
      const newCount = state.memory.pinnedFacts.join("\n").split(/\s+/).length;
      setStatus(`Facts compacted: ${wordCount} → ${newCount} words.`, "ok");
    }
  } catch (err) {
    setStatus(err.message || "Compaction failed.", "error");
  } finally {
    setBusy(false);
  }
}

export async function clearArchivedMemory() {
  await clearChunks();
  state.memory.lastSummaryMessageId = "";
  state.memory.archivedCount = 0;
  saveState();
  setStatus("Archived memory cleared.", "ok");
}

export function parseOutcomeJson(content) {
  const cleaned = sanitizeJsonString(stripCodeFence(content));
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    for (const candidate of extractBalancedObjects(cleaned)) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {
        // Try the next object candidate.
      }
    }
  }
  return { finalRecommendation: cleaned };
}

function normalizeOutcomeArray(value, wordLimit = 80, maxItems = 6) {
  return normalizeStringArray(value)
    .map(item => trimWords(item, wordLimit))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function normalizeOutcomeUpdate(update) {
  return {
    finalRecommendation: trimWords(stringifyList(update.finalRecommendation), 260),
    decisions:       normalizeOutcomeArray(update.decisions, 80),
    rationale:       normalizeOutcomeArray(update.rationale, 80),
    rejectedOptions: normalizeOutcomeArray(update.rejectedOptions, 60),
    actionItems:     normalizeOutcomeArray(update.actionItems, 80),
    risks:           normalizeOutcomeArray(update.risks, 60)
  };
}

export function formatCurrentOutcomes() {
  const arr = (v) => Array.isArray(v) ? v : normalizeStringArray(v);
  const section = (label, v) => {
    const items = arr(v).filter(Boolean);
    return items.length ? `${label}:\n${items.join('\n')}` : "";
  };
  return [
    state.outcomes.finalRecommendation ? `Final recommendation:\n${state.outcomes.finalRecommendation}` : "",
    section("Decisions", state.outcomes.decisions),
    section("Rationale", state.outcomes.rationale),
    section("Rejected options", state.outcomes.rejectedOptions),
    section("Action items", state.outcomes.actionItems),
    section("Risks", state.outcomes.risks)
  ].filter(Boolean).join("\n\n") || "None.";
}

export function setOutcomeStatus(message) {
  state.outcomes.status = message;
  saveState();
}

export async function extractOutcomes() {
  if (state.outcomes.isExtracting || state.outcomes.isExtractingOutcomes || state.autoRunning) return;

  if (!state.settings.model) {
    setOutcomeStatus("Choose or type a model before extracting outcomes.");
    return;
  }

  const chunks = await getAllChunks();
  const sourceMessages = state.messages.slice(-24);
  const archiveText = chunks.slice(-8).map((chunk) => `- ${chunk.text}`).join("\n");
  const hasSource = sourceMessages.length || archiveText || state.memory.sharedSummary || (state.memory.pinnedFacts && state.memory.pinnedFacts.length);
  if (!hasSource) {
    setOutcomeStatus("No conversation content found to extract outcomes from.");
    return;
  }

  state.outcomes.isExtracting = true;
  state.outcomes.isExtractingOutcomes = true;
  const alreadyBusy = getIsGenerating();
  setBusy(true);
  setOutcomeStatus("Extracting outcomes...");

  const system = [
    "You extract structured outcomes from a multi-actor AI forum conversation.",
    "Return only valid JSON with this exact shape:",
    "{\"finalRecommendation\":\"one concise sentence\",\"decisions\":[\"decision A\",\"decision B\"],\"rationale\":[\"reason A\",\"reason B\"],\"rejectedOptions\":[\"option A\",\"option B\"],\"actionItems\":[\"action A\",\"action B\"],\"risks\":[\"risk A\",\"risk B\"]}",
    "CRITICAL: Each array must contain 2–6 SHORT, SEPARATE items. Each item is a single sentence or phrase — do NOT concatenate multiple points into one item using dashes, bullets, or numbers inside a string. One idea per array entry."
  ].join("\n");
  const user = [
    scenarioBlock(),
    `Pinned facts:\n${(Array.isArray(state.memory.pinnedFacts) ? state.memory.pinnedFacts.join("\n") : state.memory.pinnedFacts) || "None."}`,
    `Shared memory summary:\n${state.memory.sharedSummary || "None."}`,
    `Open questions:\n${(Array.isArray(state.memory.openQuestions) ? state.memory.openQuestions.join("\n") : state.memory.openQuestions) || "None."}`,
    `DM state:\n${state.memory.dmState || "None."}`,
    `Recent transcript:\n${formatTranscript(sourceMessages, 2200)}`,
    `Archived chunk summaries:\n${archiveText || "None."}`,
    `Existing outcomes to refine:\n${formatCurrentOutcomes()}`
  ].join("\n\n");

  try {
    // Sprint 6: Retry-with-variation (up to 3 attempts, escalating temperature)
    const attempts = [
      { temperature: 0.1, maxTokens: 1200, prompt: user },
      { temperature: 0.4, maxTokens: 1400, prompt: [
          scenarioBlock(),
          `Transcript:\n${formatTranscript(sourceMessages, 1800)}`,
          `Existing outcomes:\n${formatCurrentOutcomes()}`,
          'Return ONLY valid JSON: {"finalRecommendation":"","decisions":[],"rationale":[],"rejectedOptions":[],"actionItems":[],"risks":[]}'  
        ].join('\n\n') },
      { temperature: 0.7, maxTokens: 600, prompt: [
          `Forum transcript (last 8 messages):\n${formatTranscript(sourceMessages.slice(-8), 800)}`,
          'Return ONLY valid JSON with at least finalRecommendation: {"finalRecommendation":"..."}'
        ].join('\n\n') }
    ];

    if (!Array.isArray(state.diagnostics.outcomeExtractionLog)) state.diagnostics.outcomeExtractionLog = [];

    let update = null;
    for (let i = 0; i < attempts.length; i++) {
      const { temperature, maxTokens, prompt } = attempts[i];
      try {
        const content = await chatCompletion(system, prompt, { temperature, maxTokens });
        const parsed = normalizeOutcomeUpdate(parseOutcomeJson(content));
        // Success if we got at least a finalRecommendation
        if (parsed.finalRecommendation) {
          update = parsed;
          state.diagnostics.outcomeExtractionLog.push({ at: new Date().toISOString(), attempt: i + 1, success: true });
          break;
        }
        state.diagnostics.outcomeExtractionLog.push({ at: new Date().toISOString(), attempt: i + 1, success: false, error: 'empty result' });
      } catch (attemptErr) {
        state.diagnostics.outcomeExtractionLog.push({ at: new Date().toISOString(), attempt: i + 1, success: false, error: attemptErr.message });
        if (i === attempts.length - 1) throw attemptErr;
      }
    }

    if (update) {
      state.outcomes = {
        ...state.outcomes,
        ...update,
        lastExtractedAt: new Date().toISOString(),
        lastExtractMessageId: state.messages[state.messages.length - 1]?.id || state.outcomes.lastExtractMessageId,
        status: 'Outcomes extracted.'
      };
      saveState();
    } else {
      setOutcomeStatus('Could not extract outcomes after 3 attempts.');
    }
  } catch (error) {
    setOutcomeStatus(error.message || "Outcome extraction failed.");
  } finally {
    state.outcomes.isExtracting = false;
    state.outcomes.isExtractingOutcomes = false;
    saveState();
    if (!alreadyBusy) setBusy(false);
  }
}

function renderOutcomesLocal() {
  // React handles outcome rendering via state — just save.
  saveState();
}
