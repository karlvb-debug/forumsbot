import { WORD_LIMITS, PROMPT_MESSAGE_LIMIT, RECALLED_CHUNK_LIMIT, PINNED_FACTS_WORD_CAP, DELTA_REWRITE_EVERY } from './constants.js';
import { state, saveState } from './state.js';
import { chatCompletion, getEmbedding, setStatus } from './api.js';
import { render, renderMemory, renderPendingFacts, renderActors, setBusy, els } from './render.js';
import { getAllChunks, putChunk, clearChunks, countChunks } from './db.js';
import { trimWords, stringifyList, normalizeStringArray, extractKeywords, stringifyBullets, stripCodeFence, extractBalancedObjects } from './utils.js';

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
  const currentEmbedModel = state.settings.model || "";
  const storedModels = new Set(chunks.map(c => c.embeddingModel).filter(Boolean));
  const modelMismatch = storedModels.size > 0 && !storedModels.has(currentEmbedModel);
  if (modelMismatch) {
    console.warn("[memory] Embedding model changed since chunks were stored. Falling back to keyword-only recall.",
      { stored: [...storedModels], current: currentEmbedModel });
  }

  // Composite query: actor goal + role + recent messages + open questions mentioning actor.
  const actorMentions = actor?.name
    ? state.memory.openQuestions?.split("\n").filter(q => q.toLowerCase().includes(actor.name.toLowerCase())).join(" ")
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
  const text = messages.map((message) => {
    const name = message.speaker || state.actors.find((actor) => actor.id === message.actorId)?.name || "Forum";
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

export function messagesSinceLastSummary() {
  if (!state.memory.lastSummaryMessageId) return state.messages.slice(-PROMPT_MESSAGE_LIMIT);
  const index = state.messages.findIndex((message) => message.id === state.memory.lastSummaryMessageId);
  return index >= 0 ? state.messages.slice(index + 1) : state.messages.slice(-PROMPT_MESSAGE_LIMIT);
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

  const messages = sourceMessages?.length ? sourceMessages : messagesSinceLastSummary();
  const usableMessages = messages.length ? messages : state.messages.slice(-PROMPT_MESSAGE_LIMIT);
  if (!usableMessages.length) {
    if (reason === "manual") setStatus("No conversation to summarize yet.", "warn");
    return;
  }

  if (options.reset) {
    state.memory.sharedSummary = "";
    state.memory.openQuestions = "";
    state.memory.dmState = "";
    state.memory.recentDeltas = [];
    state.memory.cycleCount = 0;
  }

  const isBackground = reason === "cycle" || reason === "round";
  state.memory.isSummarizing = true;

  if (isBackground) {
    if (els.memoryStatus) els.memoryStatus.textContent = "Updating memory in background...";
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
        `Existing pinned facts:\n${state.memory.pinnedFacts || "None."}`,
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
      const keywords = normalizeStringArray(raw.keywords).map(k => k.toLowerCase()).filter(Boolean);
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
      applyPinnedFactSuggestions(deltaUpdate.pinnedFactSuggestions);
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
        "Return only valid JSON with this exact shape (ALL values must be strings, not arrays or objects, EXCEPT actorMemoryUpdates which is an object):",
        "{\"sharedSummary\":\"300-500 word durable summary\",\"openQuestions\":\"unresolved questions, one per line\",\"dmState\":\"scenario state, empty string if none\",\"chunkSummary\":\"100-150 word summary of the source turns\",\"actorMemoryUpdates\":{\"Actor Name\":\"short private memory update\"},\"pinnedFactSuggestions\":[\"facts to pin\"],\"keywords\":[\"lowercase keywords\"]}",
        "CRITICAL: openQuestions, dmState, sharedSummary, and chunkSummary MUST be plain strings, never arrays or objects."
      ].join("\n");
      const user = [
        `Reason: ${reason}`,
        scenarioBlock(),
        `Pinned facts (ground truth — anchor your summary around these):\n${state.memory.pinnedFacts || "None."}`,
        `Existing shared summary:\n${state.memory.sharedSummary || "None."}`,
        deltaContext,
        `Existing open questions:\n${state.memory.openQuestions || "None."}`,
        `Existing DM state:\n${state.memory.dmState || "None."}`,
        `Source turns:\n${formatTranscript(usableMessages, 1600)}`
      ].filter(Boolean).join("\n\n");

      const content = await chatCompletion(system, user, { temperature: 0.2, maxTokens: 1600 });
      const parsed = parseMemoryJson(content);
      console.log('[memory] Parsed keys:', Object.keys(parsed), 'sharedSummary type:', typeof parsed.sharedSummary, 'openQ type:', typeof parsed.openQuestions);
      const memoryUpdate = normalizeMemoryUpdate(parsed, usableMessages);
      applyMemoryUpdate(memoryUpdate);
      applyActorRelationshipUpdates(memoryUpdate.actorRelationshipUpdates || {});
      await archiveMemoryChunk(memoryUpdate, usableMessages);
      // Clear accumulated deltas after full rewrite
      state.memory.recentDeltas = [];
    }

    state.memory.cycleCount += 1;
    state.memory.lastSummaryMessageId = usableMessages[usableMessages.length - 1]?.id || state.memory.lastSummaryMessageId;
    state.memory.turnsSinceSummary = 0;
    saveState();
    renderActors();
    renderMemory();
    if (!isBackground) setStatus("Memory updated.", "ok");

  } catch (error) {
    if (!isBackground) {
      setStatus(error.message || "Memory update failed.", "error");
    } else {
      console.warn("Background memory update failed:", error);
    }
  } finally {
    state.memory.isSummarizing = false;
    if (isBackground) renderMemory();
    else setBusy(false);
  }
}

export function parseMemoryJson(content) {
  const cleaned = stripCodeFence(content);
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
    openQuestions: trimWords(coerceText(update.openQuestions, "openQuestions"), WORD_LIMITS.openQuestions),
    dmState: trimWords(coerceText(update.dmState, "dmState"), WORD_LIMITS.dmState),
    actorMemoryUpdates: update.actorMemoryUpdates && typeof update.actorMemoryUpdates === "object" ? update.actorMemoryUpdates : {},
    actorRelationshipUpdates: update.actorRelationshipUpdates && typeof update.actorRelationshipUpdates === "object" ? update.actorRelationshipUpdates : {},
    pinnedFactSuggestions: normalizeStringArray(update.pinnedFactSuggestions).slice(0, 8),
    chunkSummary: trimWords(coerceText(update.chunkSummary || update.sharedSummary, "chunkSummary"), WORD_LIMITS.chunk),
    keywords: normalizeStringArray(update.keywords).concat(fallbackKeywords).map((keyword) => keyword.toLowerCase()).filter(Boolean).slice(0, 24)
  };
}

export function applyMemoryUpdate(update) {
  if (typeof update.sharedSummary === "string" && update.sharedSummary) state.memory.sharedSummary = update.sharedSummary;
  if (typeof update.openQuestions === "string") state.memory.openQuestions = update.openQuestions;
  if (state.dm.enabled && typeof update.dmState === "string") state.memory.dmState = update.dmState;
  applyActorMemoryUpdates(update.actorMemoryUpdates);
  applyPinnedFactSuggestions(update.pinnedFactSuggestions);
}

function applyPinnedFactSuggestions(suggestions) {
  (suggestions || []).forEach((fact) => {
    if (!fact) return;
    const duplicate = state.memory.pendingPinnedFacts.some((existing) => existing.toLowerCase() === fact.toLowerCase())
      || state.memory.pinnedFacts.toLowerCase().includes(fact.toLowerCase());
    if (!duplicate) state.memory.pendingPinnedFacts.push(trimWords(fact, 40));
  });
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
  const embeddingModel = state.settings.model || "";
  let vector = null;
  let vectorDim = null;
  try {
    vector = await getEmbedding(chunkText);
    if (Array.isArray(vector)) vectorDim = vector.length;
  } catch (err) {
    console.debug("Embedding unavailable (no model loaded), archiving chunk without vector:", err.message);
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
    vectorDim,
    vector
  };
  try {
    await putChunk(chunk);
  } catch (err) {
    console.error("Failed to archive memory chunk in database:", err);
  }
}

export function approvePinnedFacts() {
  const checks = Array.from(els.pendingFactsList.querySelectorAll(".pending-fact-check"));
  const approved = checks
    .filter((check) => check.checked)
    .map((check) => state.memory.pendingPinnedFacts[Number(check.dataset.index)])
    .filter(Boolean);
  if (!approved.length) return;
  const existing = state.memory.pinnedFacts.trim();
  const additions = approved.map((fact) => `- ${fact}`).join("\n");
  state.memory.pinnedFacts = [existing, additions].filter(Boolean).join("\n");
  state.memory.pendingPinnedFacts = state.memory.pendingPinnedFacts.filter((fact) => !approved.includes(fact));
  saveState();
  renderMemory();
  // Warn if approaching the word cap
  const wordCount = state.memory.pinnedFacts.trim().split(/\s+/).length;
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
  if (!state.memory.pinnedFacts.trim()) {
    setStatus("No pinned facts to compact.", "warn");
    return;
  }
  const wordCount = state.memory.pinnedFacts.trim().split(/\s+/).length;
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
    const user = `Current pinned facts:\n${state.memory.pinnedFacts}`;
    const result = await chatCompletion(system, user, { temperature: 0.1, maxTokens: 600 });
    const compacted = result.trim();
    if (compacted) {
      state.memory.pinnedFacts = trimWords(compacted, PINNED_FACTS_WORD_CAP);
      if (els.pinnedFacts) els.pinnedFacts.value = state.memory.pinnedFacts;
      saveState();
      renderMemory();
      const newCount = state.memory.pinnedFacts.split(/\s+/).length;
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
  renderMemory();
  setStatus("Archived memory cleared.", "ok");
}

export function parseOutcomeJson(content) {
  const cleaned = stripCodeFence(content);
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

export function normalizeOutcomeUpdate(update) {
  return {
    finalRecommendation: trimWords(stringifyList(update.finalRecommendation), 260),
    decisions: trimWords(stringifyBullets(update.decisions), 360),
    rationale: trimWords(stringifyBullets(update.rationale), 360),
    rejectedOptions: trimWords(stringifyBullets(update.rejectedOptions), 260),
    actionItems: trimWords(stringifyBullets(update.actionItems), 360),
    risks: trimWords(stringifyBullets(update.risks), 260)
  };
}

export function formatCurrentOutcomes() {
  return [
    state.outcomes.finalRecommendation ? `Final recommendation:\n${state.outcomes.finalRecommendation}` : "",
    state.outcomes.decisions ? `Decisions:\n${state.outcomes.decisions}` : "",
    state.outcomes.rationale ? `Rationale:\n${state.outcomes.rationale}` : "",
    state.outcomes.rejectedOptions ? `Rejected options:\n${state.outcomes.rejectedOptions}` : "",
    state.outcomes.actionItems ? `Action items:\n${state.outcomes.actionItems}` : "",
    state.outcomes.risks ? `Risks:\n${state.outcomes.risks}` : ""
  ].filter(Boolean).join("\n\n") || "None.";
}

export function setOutcomeStatus(message) {
  state.outcomes.status = message;
  els.outcomeStatus.textContent = message;
  saveState();
}

export async function extractOutcomes() {
  if (!state.settings.model) {
    setOutcomeStatus("Choose or type a model before extracting outcomes.");
    return;
  }

  const chunks = await getAllChunks();
  const sourceMessages = state.messages.slice(-24);
  const archiveText = chunks.slice(-8).map((chunk) => `- ${chunk.text}`).join("\n");
  const hasSource = sourceMessages.length || archiveText || state.memory.sharedSummary || state.memory.pinnedFacts;
  if (!hasSource) {
    setOutcomeStatus("No conversation content found to extract outcomes from.");
    return;
  }

  const alreadyBusy = els.nextTurn.disabled;
  setBusy(true);
  setOutcomeStatus("Extracting outcomes...");

  const system = [
    "You extract structured outcomes from a multi-actor AI forum conversation.",
    "Be concise but complete. Use bullet points for lists.",
    "Return only valid JSON with this exact shape:",
    "{\"finalRecommendation\":\"key takeaway or decision\",\"decisions\":[\"decision 1\"],\"rationale\":[\"reason 1\"],\"rejectedOptions\":[\"option 1\"],\"actionItems\":[\"action 1\"],\"risks\":[\"risk 1\"]}"
  ].join("\n");
  const user = [
    scenarioBlock(),
    `Pinned facts:\n${state.memory.pinnedFacts || "None."}`,
    `Shared memory summary:\n${state.memory.sharedSummary || "None."}`,
    `Open questions:\n${state.memory.openQuestions || "None."}`,
    `DM state:\n${state.memory.dmState || "None."}`,
    `Recent transcript:\n${formatTranscript(sourceMessages, 2200)}`,
    `Archived chunk summaries:\n${archiveText || "None."}`,
    `Existing outcomes to refine:\n${formatCurrentOutcomes()}`
  ].join("\n\n");

  try {
    const content = await chatCompletion(system, user, { temperature: 0.2, maxTokens: 1200 });
    const update = normalizeOutcomeUpdate(parseOutcomeJson(content));
    state.outcomes = {
      ...state.outcomes,
      ...update,
      lastExtractedAt: new Date().toISOString(),
      lastExtractMessageId: state.messages[state.messages.length - 1]?.id || state.outcomes.lastExtractMessageId,
      status: "Outcomes extracted."
    };
    saveState();
    // renderOutcomes is imported from render.js but that would create a circular dep
    // Instead we re-populate from state directly
    renderOutcomesLocal();
  } catch (error) {
    setOutcomeStatus(error.message || "Outcome extraction failed.");
  } finally {
    if (!alreadyBusy) setBusy(false);
  }
}

function renderOutcomesLocal() {
  // Inline version to avoid circular dep with render.js
  const { outcomeRecommendation, outcomeDecisions, outcomeRationale, outcomeRejected, outcomeActions, outcomeRisks, outcomeStatus } = els;
  outcomeRecommendation.value = state.outcomes.finalRecommendation;
  outcomeDecisions.value = state.outcomes.decisions;
  outcomeRationale.value = state.outcomes.rationale;
  outcomeRejected.value = state.outcomes.rejectedOptions;
  outcomeActions.value = state.outcomes.actionItems;
  outcomeRisks.value = state.outcomes.risks;
  outcomeStatus.textContent = state.outcomes.status || "No outcomes extracted yet.";
}
