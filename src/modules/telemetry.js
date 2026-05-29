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

// LCS-based Line Level Attribution Engine (Myers-style LCS)
export function alignLineAttributions(oldLines, newLines, oldAttributions, currentAuthor, versionIndex) {
  const m = oldLines.length;
  const n = newLines.length;
  
  // DP table for LCS
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1].trim() === newLines[j - 1].trim()) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  // Backtrack to find LCS alignment
  const newAttributions = new Array(n);
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1].trim() === newLines[j - 1].trim()) {
      newAttributions[j - 1] = oldAttributions[i - 1] || { author: oldAttributions[i - 1]?.author || "System", versionIndex };
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      newAttributions[j - 1] = { author: currentAuthor, versionIndex };
      j--;
    } else {
      i--;
    }
  }
  
  // Final safeguard: fill any empty attributions
  for (let k = 0; k < n; k++) {
    if (!newAttributions[k]) {
      newAttributions[k] = { author: currentAuthor, versionIndex };
    }
  }
  return newAttributions;
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

// Canvas Renderers
let tensionGridAnimationFrame = null;
export function startTensionGridAnimation(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width * devicePixelRatio || canvas.height !== rect.height * devicePixelRatio) {
      canvas.width = rect.width * devicePixelRatio;
      canvas.height = rect.height * devicePixelRatio;
      ctx.scale(devicePixelRatio, devicePixelRatio);
    }
  }

  resizeCanvas();

  const cols = 10;
  const rows = 5;
  let time = 0;

  function draw() {
    resizeCanvas();
    const w = canvas.width / devicePixelRatio;
    const h = canvas.height / devicePixelRatio;
    ctx.clearRect(0, 0, w, h);

    const alignment = state.telemetry?.currentAlignmentScore ?? 100;
    const drift = Math.max(0, 1 - alignment / 100);
    
    // Physical attributes scaled with drift
    const amplitude = 3 + drift * 22;
    const speed = 0.0015 + drift * 0.012;
    const colSpacing = w / (cols + 1);
    const rowSpacing = h / (rows + 1);

    time += speed * 60; // normalize around 60fps delta estimation

    // Colors mapping (aligned = purple, drift = gold, high tension = coral/red)
    let nodeColor, gridColor;
    if (drift < 0.25) {
      nodeColor = `rgba(103, 58, 183, ${0.4 + drift * 0.4})`;
      gridColor = `rgba(103, 58, 183, 0.15)`;
    } else if (drift < 0.6) {
      nodeColor = `rgba(255, 193, 7, ${0.5 + (drift - 0.25) * 0.5})`;
      gridColor = `rgba(255, 193, 7, 0.25)`;
    } else {
      nodeColor = `rgba(255, 87, 34, ${0.7 + (drift - 0.6) * 0.3})`;
      gridColor = `rgba(255, 87, 34, 0.4)`;
    }

    const grid = [];
    for (let r = 0; r < rows; r++) {
      grid[r] = [];
      for (let c = 0; c < cols; c++) {
        const baseX = colSpacing * (c + 1);
        const baseY = rowSpacing * (r + 1);

        // Sine displacement based on grid coordinates and time
        const dx = Math.sin(time * 0.03 + c * 0.5 + r * 0.3) * amplitude;
        const dy = Math.cos(time * 0.025 + c * 0.3 + r * 0.6) * amplitude;

        grid[r][c] = { x: baseX + dx, y: baseY + dy };
      }
    }

    // Draw horizontal & vertical grid lines
    ctx.lineWidth = 1;
    ctx.strokeStyle = gridColor;
    for (let r = 0; r < rows; r++) {
      ctx.beginPath();
      ctx.moveTo(grid[r][0].x, grid[r][0].y);
      for (let c = 1; c < cols; c++) {
        ctx.lineTo(grid[r][c].x, grid[r][c].y);
      }
      ctx.stroke();
    }
    for (let c = 0; c < cols; c++) {
      ctx.beginPath();
      ctx.moveTo(grid[0][c].x, grid[0][c].y);
      for (let r = 1; r < rows; r++) {
        ctx.lineTo(grid[r][c].x, grid[r][c].y);
      }
      ctx.stroke();
    }

    // Draw nodes
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const node = grid[r][c];
        ctx.beginPath();
        const rSize = 2.5 + drift * 2.5;
        ctx.arc(node.x, node.y, rSize, 0, Math.PI * 2);
        ctx.fillStyle = nodeColor;
        if (drift > 0.4) {
          ctx.shadowBlur = 4 + drift * 6;
          ctx.shadowColor = nodeColor;
        } else {
          ctx.shadowBlur = 0;
        }
        ctx.fill();
        ctx.shadowBlur = 0; // reset
      }
    }

    tensionGridAnimationFrame = requestAnimationFrame(draw);
  }

  if (tensionGridAnimationFrame) cancelAnimationFrame(tensionGridAnimationFrame);
  tensionGridAnimationFrame = requestAnimationFrame(draw);
}

export function stopTensionGridAnimation() {
  if (tensionGridAnimationFrame) {
    cancelAnimationFrame(tensionGridAnimationFrame);
    tensionGridAnimationFrame = null;
  }
}

// Confluence River Bezier Flow Canvas Renderer
let confluenceAnimationFrame = null;
export function startConfluenceRiverAnimation(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width * devicePixelRatio || canvas.height !== rect.height * devicePixelRatio) {
      canvas.width = rect.width * devicePixelRatio;
      canvas.height = rect.height * devicePixelRatio;
      ctx.scale(devicePixelRatio, devicePixelRatio);
    }
  }

  resizeCanvas();
  let offset = 0;

  function draw() {
    resizeCanvas();
    const w = canvas.width / devicePixelRatio;
    const h = canvas.height / devicePixelRatio;
    ctx.clearRect(0, 0, w, h);

    // Compute contribution shares for enabled actors + Director
    const lines = (state.documents || []).filter(d => d.aiEditable).flatMap(d => d.lineAttribution || []);
    if (!lines.length) {
      // Draw empty placeholder text
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = '12px var(--font-family, sans-serif)';
      ctx.textAlign = 'center';
      ctx.fillText('No document attributions available yet.', w / 2, h / 2);
      confluenceAnimationFrame = requestAnimationFrame(draw);
      return;
    }

    const contributions = {};
    lines.forEach(l => {
      const auth = l.author || "System";
      contributions[auth] = (contributions[auth] || 0) + 1;
    });

    const contributors = Object.entries(contributions).map(([name, count]) => {
      const actor = state.actors.find(a => a.name === name);
      return {
        name,
        count,
        share: count / lines.length,
        color: actor?.color || 'var(--accent)'
      };
    }).sort((a,b) => b.share - a.share);

    offset -= 0.5; // Bezier dash flow offset

    const targetX = w - 40;
    const targetY = h / 2;
    const sourceX = 40;

    // Distribute source Y coordinates
    const spacing = h / (contributors.length + 1);
    contributors.forEach((c, index) => {
      const sourceY = spacing * (index + 1);
      const strokeWidth = Math.max(1.5, c.share * 35);

      // Bezier curve control points
      const cp1X = sourceX + (targetX - sourceX) * 0.4;
      const cp1Y = sourceY;
      const cp2X = sourceX + (targetX - sourceX) * 0.6;
      const cp2Y = targetY;

      // Draw connection river flow
      ctx.beginPath();
      ctx.moveTo(sourceX, sourceY);
      ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, targetX, targetY);

      // Gradient color mapping
      const grad = ctx.createLinearGradient(sourceX, sourceY, targetX, targetY);
      grad.addColorStop(0, c.color);
      grad.addColorStop(1, 'rgba(128,128,128,0.3)');

      ctx.strokeStyle = grad;
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Flowing animation dots overlay
      ctx.beginPath();
      ctx.moveTo(sourceX, sourceY);
      ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, targetX, targetY);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = Math.min(2, strokeWidth * 0.3);
      ctx.setLineDash([6, 12]);
      ctx.lineDashOffset = offset;
      ctx.stroke();
      ctx.setLineDash([]); // reset

      // Draw Source Circle Label
      ctx.beginPath();
      ctx.arc(sourceX, sourceY, 6, 0, Math.PI * 2);
      ctx.fillStyle = c.color;
      ctx.fill();

      ctx.fillStyle = 'var(--text)';
      ctx.font = '10px var(--font-family, sans-serif)';
      ctx.textAlign = 'right';
      ctx.fillText(c.name, sourceX - 10, sourceY + 3);
    });

    // Draw Main Trunk Target Circle
    ctx.beginPath();
    ctx.arc(targetX, targetY, 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fill();

    ctx.fillStyle = 'var(--text)';
    ctx.font = '10px var(--font-family, sans-serif)';
    ctx.textAlign = 'left';
    ctx.fillText("Document Trunk", targetX + 12, targetY + 3);

    confluenceAnimationFrame = requestAnimationFrame(draw);
  }

  if (confluenceAnimationFrame) cancelAnimationFrame(confluenceAnimationFrame);
  confluenceAnimationFrame = requestAnimationFrame(draw);
}

export function stopConfluenceRiverAnimation() {
  if (confluenceAnimationFrame) {
    cancelAnimationFrame(confluenceAnimationFrame);
    confluenceAnimationFrame = null;
  }
}

// Metrics Engine calculations per turn
export function calculateTurnMetrics(messageContent, previousMessages, objective, premise) {
  const content = messageContent || "";
  const lastN = previousMessages.slice(-5).filter(m => m.content);

  // 1. Novelty Score (vs last 5 messages)
  let novelty = 1.0;
  if (lastN.length > 0) {
    const historicalText = lastN.map(m => m.content).join("\n");
    // Scaled similarity fallback: novelty is 1 - similarity
    const sim = scaledJaccardSimilarity(content, historicalText);
    novelty = Math.max(0, 1 - (sim - 0.3) / 0.7); // rescale to [0, 1]
  }

  // 2. Premise Alignment
  let premiseAlignment = 1.0;
  if (premise) {
    premiseAlignment = scaledJaccardSimilarity(content, premise);
  }

  // 3. Specificity Score
  // Ratio of concrete nouns (capitalized word inside sentence), numbers, and code patterns, vs total words
  const words = content.split(/\s+/).filter(Boolean);
  let concreteCount = 0;
  words.forEach((word, idx) => {
    // Number patterns or code-like items (containing ., _, :, /)
    if (/[\d\.\_\:\/]/.test(word)) {
      concreteCount++;
      return;
    }
    // Capitalized terms not at the beginning of sentence
    if (idx > 0 && /^[A-Z][a-z]+/.test(word)) {
      // Check if previous word ended with a sentence terminator
      const prev = words[idx - 1];
      if (prev && !/[\.\?\!\:]$/.test(prev)) {
        concreteCount++;
      }
    }
  });
  const specificity = words.length ? Math.min(1.0, concreteCount / Math.max(5, words.length * 0.3)) : 0.0;

  // 4. Stage Direction Percentage
  const totalChars = content.length;
  let stageChars = 0;
  const matches = content.match(/\*[^*]+\*/g) || [];
  matches.forEach(match => {
    stageChars += match.length;
  });
  const stageDirectionPct = totalChars ? stageChars / totalChars : 0.0;

  // 5. Repetition vs Last N (word level overlap counts)
  let repetitionVsLastN = 0.0;
  if (lastN.length > 0) {
    const wordsCurrent = getWordSet(content);
    const wordsHistory = getWordSet(lastN.map(m => m.content).join(" "));
    if (wordsCurrent.size > 0) {
      let overlap = 0;
      for (const w of wordsCurrent) {
        if (wordsHistory.has(w)) overlap++;
      }
      repetitionVsLastN = overlap / wordsCurrent.size;
    }
  }

  // 6. Sprint 7: Anchor Citation Score
  // How much of the message references settled group agreements (anchors).
  let anchorCitationScore = 0.0;
  const anchors = (typeof state !== 'undefined' && state?.anchors) ? state.anchors : [];
  if (anchors.length > 0) {
    const anchorText = anchors.map(a => a.text).join(' ');
    anchorCitationScore = calculateAnchorCitation(content, anchorText);
    // Boost premise alignment when the actor is building on settled ground
    if (anchorCitationScore > 0.3) {
      premiseAlignment = Math.min(1.0, premiseAlignment + anchorCitationScore * 0.15);
    }
  }

  return {
    noveltyScore: Number(novelty.toFixed(2)),
    premiseAlignmentScore: Number(premiseAlignment.toFixed(2)),
    specificityScore: Number(specificity.toFixed(2)),
    stageDirectionPct: Number(stageDirectionPct.toFixed(2)),
    repetitionVsLastN: Number(repetitionVsLastN.toFixed(2)),
    anchorCitationScore: Number(anchorCitationScore.toFixed(2))
  };
}

// Calculate session level metrics
export function calculateSessionMetrics(messages, lineAttribution) {
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

  // Calculate memory duplication score (approx based on delta overlap)
  const deltas = state.memory?.recentDeltas || [];
  let deltaDuplication = 0.0;
  if (deltas.length > 1) {
    let matches = 0;
    let comparisons = 0;
    for (let i = 0; i < deltas.length; i++) {
      for (let j = i + 1; j < deltas.length; j++) {
        comparisons++;
        const setA = getWordSet(deltas[i]);
        const setB = getWordSet(deltas[j]);
        let intersect = 0;
        for (const item of setA) {
          if (setB.has(item)) intersect++;
        }
        if (setA.size && intersect / setA.size > 0.4) matches++;
      }
    }
    deltaDuplication = comparisons ? matches / comparisons : 0.0;
  }

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
    memoryDuplicationScore: Number(deltaDuplication.toFixed(2)),
    premiseDriftFinal: state.telemetry?.currentAlignmentScore ? Number((1 - state.telemetry.currentAlignmentScore / 100).toFixed(2)) : 0.0,
    outcomesPopulated: !!state.outcomes.finalRecommendation,
    totalLatencyMs
  };
}

// ──────────────────────────────────────────────────────────────
// Sprint 6 — Tool Usefulness Score
//
// Definition (from original reviewer §13.1):
//   "Heuristic on whether the result was cited in a subsequent message."
//
// We measure the word-overlap ratio between the tool's returned
// text and the actor's final message, with stop-word filtering
// so common words don't inflate the score.
//
// Returns 0.0–1.0:
//   ≥0.5  → "cited"    (tool content well-referenced)
//   0.1–0.49 → "partial" (some overlap)
//   <0.1  → "unused"  (tool result not referenced)
// ──────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with',
  'is','are','was','were','be','been','being','have','has','had','do',
  'does','did','will','would','could','should','may','might','that','this',
  'it','its','they','their','there','then','than','so','if','as','by',
  'not','from','into','about','also','just','more','can','all','when',
]);

/**
 * Calculate how useful a set of tool results were to the actor's message.
 *
 * @param {Array<{result?: string, content?: string}>|string} toolResults
 *   - The tool call results (array of objects or plain string)
 * @param {string} actorMessage
 *   - The actor's final message after the tool calls
 * @returns {number} Usefulness score 0.0–1.0
 */
export function calculateToolUsefulness(toolResults, actorMessage) {
  if (!actorMessage) return 0;

  // Collect all tool result text
  let toolText = '';
  if (typeof toolResults === 'string') {
    toolText = toolResults;
  } else if (Array.isArray(toolResults)) {
    toolText = toolResults.map(t => t?.result || t?.content || JSON.stringify(t) || '').join(' ');
  }

  if (!toolText.trim()) return 0;

  // Tokenize, lowercase, filter stop words and short tokens
  const tokenize = (text) => new Set(
    text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w))
  );

  const toolWords = tokenize(toolText);
  const msgWords = tokenize(actorMessage);

  if (toolWords.size === 0) return 0;

  // Count how many tool words appear in the message
  let cited = 0;
  for (const word of toolWords) {
    if (msgWords.has(word)) cited++;
  }

  return Number(Math.min(1, cited / toolWords.size).toFixed(3));
}

// ──────────────────────────────────────────────────────────────
// Sprint 7 — Conceptual Anchor Citation Score
//
// Measures how much a message references settled group anchors.
// Uses the same word-overlap + stop-word filter as tool usefulness.
// ──────────────────────────────────────────────────────────────

export function calculateAnchorCitation(messageText, anchorText) {
  if (!messageText || !anchorText) return 0;
  const tokenize = (text) => new Set(
    text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w))
  );
  const anchorWords = tokenize(anchorText);
  const msgWords = tokenize(messageText);
  if (anchorWords.size === 0) return 0;
  let cited = 0;
  for (const word of anchorWords) {
    if (msgWords.has(word)) cited++;
  }
  return Number(Math.min(1, cited / anchorWords.size).toFixed(3));
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

/**
 * @param {Object} message - the current message object
 * @param {Array}  recentMessages - the prior messages (last N)
 * @param {Array}  actors - actor definitions (for color lookup)
 * @returns {Array<{speakerName:string, color:string, fraction:number}>}
 */
export function calculateInfluenceBudget(message, recentMessages, actors) {
  if (!message?.content || !recentMessages?.length) return [];

  const tokenize = (text) => {
    if (!text) return new Set();
    return new Set(
      text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !STOP_WORDS.has(w))
    );
  };

  const msgWords = tokenize(message.content);
  if (msgWords.size === 0) return [];

  // Group prior messages by speaker (exclude the message itself and system messages)
  const priorMsgs = recentMessages.filter(
    m => m.id !== message.id && m.type !== 'system' && m.content
  ).slice(-12); // look back at most 12 messages

  if (priorMsgs.length === 0) return [];

  // Aggregate text per speaker
  const speakerText = new Map();
  for (const m of priorMsgs) {
    const key = m.type === 'user' ? '__user__' : (m.speaker || m.actorId || 'Unknown');
    speakerText.set(key, (speakerText.get(key) || '') + ' ' + m.content);
  }

  // Compute raw overlap scores
  const scores = [];
  let totalScore = 0;
  for (const [key, text] of speakerText.entries()) {
    const sWords = tokenize(text);
    let overlap = 0;
    for (const w of sWords) {
      if (msgWords.has(w)) overlap++;
    }
    const raw = sWords.size > 0 ? overlap / sWords.size : 0;
    if (raw > 0) {
      // Resolve display name and color
      let speakerName = key;
      let color = 'var(--muted)';
      if (key === '__user__') {
        speakerName = 'User';
        color = 'var(--purple)';
      } else {
        const actor = actors?.find(a => a.name === key || a.id === key);
        if (actor) color = actor.color || 'var(--muted)';
      }
      scores.push({ speakerName, color, raw });
      totalScore += raw;
    }
  }

  if (totalScore === 0) return [];

  // Normalize to fractions, filter below 5% threshold
  const THRESHOLD = 0.05;
  const result = scores
    .map(s => ({ ...s, fraction: s.raw / totalScore }))
    .filter(s => s.fraction >= THRESHOLD)
    .sort((a, b) => b.fraction - a.fraction);

  // Re-normalize after filtering
  const filteredTotal = result.reduce((sum, s) => sum + s.fraction, 0);
  if (filteredTotal > 0) {
    result.forEach(s => { s.fraction = Number((s.fraction / filteredTotal).toFixed(3)); });
  }

  return result;
}
