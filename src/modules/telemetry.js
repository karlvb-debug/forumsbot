import { state } from './state.js';
import { cosineSimilarity } from './utils.js';

// Re-exported from utils so existing import paths keep working.
export { cosineSimilarity };

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
