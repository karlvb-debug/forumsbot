import { state, logWarning } from './state.js';
import { getEmbedding } from './api.js';
import { notifyStateChange } from '../hooks/useForumState.js';
import { cosineSimilarity } from './utils.js';

// Re-exported from utils so existing import paths keep working.
export { cosineSimilarity };

// Tokenize text into normalized word set
export function getWordSet(text) {
  if (!text) return new Set();
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
  return new Set(words);
}

// Scaled Jaccard word overlap fallback
export function scaledJaccardSimilarity(textA, textB) {
  const setA = getWordSet(textA);
  const setB = getWordSet(textB);
  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0.3; // minimum baseline
  
  let intersectionCount = 0;
  for (const item of setA) {
    if (setB.has(item)) intersectionCount++;
  }
  const unionCount = setA.size + setB.size - intersectionCount;
  const jaccard = intersectionCount / unionCount;
  
  // Rescale Jaccard to approximate typical embedding ranges (0.3 to 1.0)
  return 0.3 + 0.7 * jaccard;
}

// Debounced telemetry semantic alignment updater
let isTelemetryUpdating = false;
export async function updateSemanticAlignment() {
  if (isTelemetryUpdating) return;
  isTelemetryUpdating = true;

  try {
    const objectiveText = (state.scenario.objective || "").trim();
    if (!objectiveText) {
      state.telemetry.currentAlignmentScore = 100;
      dispatchTelemetryUpdate();
      isTelemetryUpdating = false;
      return;
    }

    // Capture last 5 messages as conversation context
    const recentMsgs = state.messages.slice(-5)
      .filter(m => m.type === "actor" || m.type === "dm" || m.type === "user")
      .map(m => m.content)
      .join("\n")
      .trim();

    if (!recentMsgs) {
      state.telemetry.currentAlignmentScore = 100;
      dispatchTelemetryUpdate();
      isTelemetryUpdating = false;
      return;
    }

    let alignment = 1.0;
    let usingEmbeddings = false;

    // Check if embeddings are enabled/configured
    if (state.settings.model) {
      try {
        // Embed objective if text changed or not embedded yet
        if (!state.telemetry.objectiveEmbedding || state.telemetry.embeddedObjectiveText !== objectiveText) {
          state.telemetry.objectiveEmbedding = await getEmbedding(objectiveText);
          state.telemetry.embeddedObjectiveText = objectiveText;
        }

        const contextEmbedding = await getEmbedding(recentMsgs);
        const cosSim = cosineSimilarity(state.telemetry.objectiveEmbedding, contextEmbedding);
        
        // Normalize cosine score: maps typical range [0.5, 0.95] to [0, 1]
        alignment = Math.max(0, Math.min(1, (cosSim - 0.5) / 0.45));
        usingEmbeddings = true;
      } catch (err) {
        logWarning("embeddings", `Embedding alignment calculation failed: ${err.message}. Falling back to scaled Jaccard.`, "warn");
      }
    }

    if (!usingEmbeddings) {
      alignment = scaledJaccardSimilarity(objectiveText, recentMsgs);
    }

    const alignmentPercentage = Math.round(alignment * 100);
    state.telemetry.currentAlignmentScore = alignmentPercentage;
    state.telemetry.alignmentMode = usingEmbeddings ? "embedding" : "keyword";

    // Keep history bounded to last 50 turns
    state.telemetry.alignmentHistory.push({
      turn: state.messages.length,
      score: alignmentPercentage,
      mode: state.telemetry.alignmentMode,
      timestamp: Date.now()
    });
    if (state.telemetry.alignmentHistory.length > 50) {
      state.telemetry.alignmentHistory.shift();
    }

    dispatchTelemetryUpdate();
  } catch (err) {
    console.error("[telemetry] Update failed:", err);
  } finally {
    isTelemetryUpdating = false;
  }
}

function dispatchTelemetryUpdate() {
  notifyStateChange();
}

// Calculate session level metrics
export function calculateSessionMetrics(messages) {
  const completedMessages = messages.filter(m => m.type === "actor" || m.type === "dm");
  const skipMessages = messages.filter(m => m.type === "skip");
  const totalCompleted = completedMessages.length;
  const totalTurns = totalCompleted + skipMessages.length;

  const skipRateOverall = totalTurns ? skipMessages.length / totalTurns : 0.0;

  const skipRateByActor = {};
  const totalByActor = {};
  messages.forEach(m => {
    if (m.speaker) {
      totalByActor[m.speaker] = (totalByActor[m.speaker] || 0) + 1;
      if (m.type === "skip") {
        skipRateByActor[m.speaker] = (skipRateByActor[m.speaker] || 0) + 1;
      }
    }
  });
  Object.keys(totalByActor).forEach(actorName => {
    const skips = skipRateByActor[actorName] || 0;
    skipRateByActor[actorName] = Number((skips / totalByActor[actorName]).toFixed(2));
  });

  // Calculate total latency
  let totalLatencyMs = 0;
  messages.forEach(m => {
    if (m.trace?.latencyMs) {
      totalLatencyMs += m.trace.latencyMs;
    }
  });

  return {
    chunkCoveragePct: totalCompleted ? Math.round((state.memory.archivedCount || 0) * 10) : 0,
    skipRateOverall: Number(skipRateOverall.toFixed(2)),
    skipRateByActor,
    premiseDriftFinal: state.telemetry?.currentAlignmentScore ? Number((1 - state.telemetry.currentAlignmentScore / 100).toFixed(2)) : 0.0,
    outcomesPopulated: !!state.outcomes.finalRecommendation,
    totalLatencyMs
  };
}

// ──────────────────────────────────────────────────────────────
// Sprint 7 — Influence Budget
//
// Per-message attribution: what fraction of a message's content
// appears to derive from each prior speaker's recent contributions.
//
// Returns sorted array: [{ speakerName, color, fraction }]
// Fractions sum to ≤1.0. Speakers below 5% threshold are omitted.
// ──────────────────────────────────────────────────────────────
