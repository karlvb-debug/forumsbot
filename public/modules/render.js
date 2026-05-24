import { defaultState, DELTA_REWRITE_EVERY } from './constants.js';
import { state, saveState, logWarning } from './state.js';
import { calculateInfluenceBudget } from './telemetry.js';
import { storageAvailable, storageWarning } from './db.js';
import { publicMessageContent, normalizeStringArray } from './utils.js';
import { renderMarkdown } from './markdown.js';
import {
  startTensionGridAnimation,
  stopTensionGridAnimation,
  startConfluenceRiverAnimation,
  stopConfluenceRiverAnimation
} from './telemetry.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** Coerce any value to a display-safe string for textareas. */
function safeString(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter(Boolean).join("\n");
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "";
    return entries.map(([k, v]) => `${k}: ${safeString(v)}`).join("\n");
  }
  return String(value);
}

export const els = {
  modePills: $$("[data-mode]"),
  temperatureDisplay: $("#temperatureDisplay"),
  baseUrl: $("#baseUrlInput"),
  apiKey: $("#apiKeyInput"),
  model: $("#modelInput"),
  modelOptions: $("#modelOptions"),
  embeddingModel: $("#embeddingModelInput"),
  embeddingWarning: $("#embeddingWarning"),
  temperature: $("#temperatureInput"),
  loadModels: $("#loadModelsButton"),
  connectionStatus: $("#connectionStatus"),
  mode: $("#modeSelect"),
  title: $("#titleInput"),
  premise: $("#premiseInput"),
  objective: $("#objectiveInput"),
  dmEnabled: $("#dmEnabledInput"),
  dmName: $("#dmNameInput"),
  dmPersona: $("#dmPersonaInput"),
  dmPrivate: $("#dmPrivateInput"),
  modeLabel: $("#modeLabel"),
  stageTitle: $("#stageTitle"),
  transcript: $("#transcript"),
  composer: $("#composer"),
  userInput: $("#userInput"),
  nextTurn: $("#nextTurnButton"),
  round: $("#roundButton"),
  auto: $("#autoButton"),
  clearConversation: $("#clearConversationButton"),
  copySession: $("#copySessionButton"),
  stop: $("#stopButton"),
  addActor: $("#addActorButton"),
  addResearcher: $("#addResearcherButton"),
  actorList: $("#actorList"),
  conversationSummary: $("#conversationSummary"),
  autoStopEnabled: $("#autoStopEnabledInput"),
  autoGoal: $("#autoGoalInput"),
  goalCheckEnabled: $("#goalCheckEnabledInput"),
  stopOnAllSkip: $("#stopOnAllSkipInput"),
  maxRoundsEnabled: $("#maxRoundsEnabledInput"),
  maxRounds: $("#maxRoundsInput"),
  checkGoalNow: $("#checkGoalNowButton"),
  autoStopStatus: $("#autoStopStatus"),
  quickStartPrompt: $("#quickStartPromptInput"),
  quickStartTemp: $("#quickStartTempInput"),
  quickStartTempDisplay: $("#quickStartTempDisplay"),
  generateQuickStart: $("#generateQuickStartButton"),
  applyQuickStart: $("#applyQuickStartButton"),
  discardQuickStart: $("#discardQuickStartButton"),
  quickStartPreview: $("#quickStartPreview"),
  quickStartStatus: $("#quickStartStatus"),
  memoryEnabled: $("#memoryEnabledInput"),
  pinnedFacts: $("#pinnedFactsInput"),
  sharedSummary: $("#sharedSummaryInput"),
  openQuestions: $("#openQuestionsInput"),
  dmState: $("#dmStateInput"),
  pendingFactsList: $("#pendingFactsList"),
  summarizeNow: $("#summarizeNowButton"),
  rebuildMemory: $("#rebuildMemoryButton"),
  approveFacts: $("#approveFactsButton"),
  clearArchive: $("#clearArchiveButton"),
  memoryStatus: $("#memoryStatus"),
  cycleBadge: $("#cycleBadge"),
  recentDeltasSection: $("#recentDeltasSection"),
  deltaCount: $("#deltaCount"),
  recentDeltasList: $("#recentDeltasList"),
  chunkBrowserList: $("#chunkBrowserList"),
  browseChunks: $("#browseChunksButton"),
  extractOutcomes: $("#extractOutcomesButton"),
  outcomeRecommendation: $("#outcomeRecommendationInput"),
  outcomeDecisions: $("#outcomeDecisionsInput"),
  outcomeRationale: $("#outcomeRationaleInput"),
  outcomeRejected: $("#outcomeRejectedInput"),
  outcomeActions: $("#outcomeActionsInput"),
  outcomeRisks: $("#outcomeRisksInput"),
  outcomeStatus: $("#outcomeStatus"),
  showThoughts: $("#showThoughtsInput"),
  toolsEnabled: $("#toolsEnabledInput"),
  savePreset: $("#savePresetButton"),
  loadPreset: $("#loadPresetButton"),
  exportSession: $("#exportButton"),
  reset: $("#resetButton"),
  presetFile: $("#presetFileInput"),
  themeToggle: $("#themeToggle"),
  tokenGauge: $("#tokenGauge"),
  tokenGaugeBar: $("#tokenGaugeBar"),
  tokenGaugeLabel: $("#tokenGaugeLabel"),
  showThoughtsMirror: $("#showThoughtsMirror"),
  // Document panel
  documentEnabled: $("#documentEnabledInput"),
  documentTitle: $("#documentTitleInput"),
  documentContent: $("#documentContent"),
  documentPreview: $("#documentPreview"),
  documentVersionCount: $("#documentVersionCount"),
  documentCopy: $("#documentCopyButton"),
  documentClear: $("#documentClearButton"),
  documentAttributionContainer: $("#documentAttributionContainer"),
  documentHistoryContainer: $("#documentHistoryContainer"),
  documentHistorySlider: $("#documentHistorySlider"),
  documentHistoryStatus: $("#documentHistoryStatus"),
  documentRestoreButton: $("#documentRestoreButton"),
  docEditView: $(".doc-edit-view"),
  docPreviewView: $(".doc-preview-view"),
  docViewBtns: $$(".doc-view-btn"),
  sidebarTabs: $$(".sidebar-tab"),
  sidebarPanels: $$(".sidebar-panel"),
  sidebarResizeHandle: $("#sidebarResizeHandle"),
  toggleSidebarButton: $("#toggleSidebarButton"),
  // Telemetry panel elements
  telemetryDialFill: $("#telemetryDialFill"),
  telemetryAlignmentScore: $("#telemetryAlignmentScore"),
  tensionGridCanvas: $("#tensionGridCanvas"),
  gravitySensitivityInput: $("#gravitySensitivityInput"),
  gravitySensitivityDisplay: $("#gravitySensitivityDisplay"),
  includeTracesInput: $("#includeTracesInput"),
  manualNudgeButton: $("#manualNudgeButton"),
  // Sprint 5: metrics tiles
  metricAlignmentVal: $("#metricAlignmentVal"),
  metricSkipRateVal: $("#metricSkipRateVal"),
  metricOutcomesVal: $("#metricOutcomesVal"),
  metricMemDupVal: $("#metricMemDupVal"),
  metricTileAlignment: $("#metricTileAlignment"),
  metricTileSkipRate: $("#metricTileSkipRate"),
  metricTileOutcomes: $("#metricTileOutcomes"),
  metricTileMemDup: $("#metricTileMemDup"),
  // Sprint 5: preflight + hypothesis controls
  enablePreflightRouterInput: $("#enablePreflightRouterInput"),
  enableHypothesisSamplingInput: $("#enableHypothesisSamplingInput"),
  hypothesisSamplingControls: $("#hypothesisSamplingControls"),
  hypothesisSampleCountInput: $("#hypothesisSampleCountInput"),
  hypothesisSampleCountDisplay: $("#hypothesisSampleCountDisplay"),
  hypothesisAutoSelectInput: $("#hypothesisAutoSelectInput"),
  // Document attribution
  documentShowAttributionInput: $("#documentShowAttributionInput"),
  documentConfluenceContainer: $("#documentConfluenceContainer"),
  documentConfluenceCanvas: $("#documentConfluenceCanvas"),
  // Export mode
  exportModeSelect: $("#exportModeSelect"),
  // Sprint 7: Influence bars toggle
  showInfluenceBarsInput: $("#showInfluenceBarsInput"),
  // Turbo mode
  turboButton: $("#turboModeButton"),
  turboBanner: $("#turboBanner")
};

// ── Streaming bubble ──────────────────────────────────────────────────────────
// A live placeholder card that shows tokens as they arrive, removed once
// the real message card is painted by renderTranscript().
let _streamingBubble = null;
let _streamingMessageEl = null;

export function showStreamingBubble(speaker, color, type = "actor") {
  forceRemoveStreamingBubble();
  const wasAtBottom = els.transcript.scrollHeight - els.transcript.scrollTop - els.transcript.clientHeight < 80;
  const template = document.getElementById("messageTemplate");
  if (!template) return;
  const node = template.content.firstElementChild.cloneNode(true);
  node.classList.add(type || "actor");
  node.classList.add("streaming");
  node.dataset.streaming = "true";
  if (type !== "user" && type !== "skip") node.style.borderLeftColor = color;
  const dotEl = node.querySelector(".speaker-dot");
  if (dotEl) dotEl.style.background = color;
  const nameEl = node.querySelector(".message-meta strong");
  if (nameEl) nameEl.textContent = speaker;
  const timeEl = node.querySelector(".message-time");
  if (timeEl) timeEl.textContent = "generating…";
  const contentEl = node.querySelector(".message-content");
  if (contentEl) contentEl.innerHTML = '<span class="streaming-cursor">▌</span>';
  [".thought-block", ".tool-calls", ".message-feedback", ".doc-edit-badge"].forEach((sel) => {
    const el = node.querySelector(sel);
    if (el) el.style.display = "none";
  });
  els.transcript.append(node);
  _streamingBubble = node;
  _streamingMessageEl = contentEl ?? null;
  if (wasAtBottom) els.transcript.scrollTop = els.transcript.scrollHeight;
}

export function updateStreamingBubble(text) {
  if (!_streamingMessageEl) return;
  const wasAtBottom = els.transcript.scrollHeight - els.transcript.scrollTop - els.transcript.clientHeight < 120;
  _streamingMessageEl.innerHTML = escapeHtml(text ?? '') + '<span class="streaming-cursor">▌</span>';
  if (wasAtBottom) els.transcript.scrollTop = els.transcript.scrollHeight;
}

// Called by renderTranscript() — only nullifies refs.
// The DOM element gets wiped by innerHTML="" in the same tick.
export function removeStreamingBubble() {
  _streamingBubble = null;
  _streamingMessageEl = null;
}

// Called by error/abort paths where renderTranscript() won't fire.
// Actually removes the DOM element.
export function forceRemoveStreamingBubble() {
  if (_streamingBubble) {
    _streamingBubble.remove();
  }
  _streamingBubble = null;
  _streamingMessageEl = null;
}

export let isInitialized = false;
export function setInitialized(v) { isInitialized = v; }

let isGenerating = false;
export function setGenerating(v) { isGenerating = v; }
export function getIsGenerating() { return isGenerating; }

export function setBusy(value) {
  isGenerating = value;
  document.body.classList.toggle("is-busy", value);
  els.nextTurn.disabled = value;
  els.round.disabled = value;
  els.auto.disabled = value && !state.autoRunning;
  els.stop.disabled = !value && !state.autoRunning;
  els.userInput.disabled = value;
}

export function renderTurboState() {
  const on = !!state.settings?.turboMode;
  if (els.turboButton) {
    els.turboButton.classList.toggle("turbo-active", on);
    els.turboButton.title = on
      ? "Turbo Mode ON — click to disable (memory, thoughts, alignment suspended)"
      : "Turbo Mode OFF — click to enable for faster turns (disables memory, thoughts, alignment)";
  }
  if (els.turboBanner) els.turboBanner.style.display = on ? "" : "none";
}

export function render() {
  renderStageHeader();
  renderActors();
  renderConversationSummary();
  renderDocument();
  renderQuickStartPreview();
  renderMemory();
  renderOutcomes();
  renderAnchors();
  renderAutoStop();
  renderTranscript();
  renderTelemetry();
  renderTurboState();
  els.auto.textContent = state.autoRunning ? "Pause" : "Auto";
}

/** Update the SVG circular alignment dial and score text. */
export function renderTelemetry() {
  if (!els.telemetryDialFill || !els.telemetryAlignmentScore) return;

  const score = state.telemetry?.currentAlignmentScore ?? 100;
  const circumference = 251.2; // 2 * Math.PI * 40
  const offset = circumference - (score / 100) * circumference;

  els.telemetryDialFill.style.strokeDashoffset = offset;
  const mode = state.telemetry?.alignmentMode ?? "none";
  const modeTag = mode === "embedding" ? "" : ` <span class="alignment-mode-badge" title="No embedding model configured — using keyword similarity">keyword</span>`;
  els.telemetryAlignmentScore.innerHTML = `${score}%${modeTag}`;

  // Determine visual level: critical < 35, warn < 60, ok >= 60
  const level = score < 35 ? "critical" : score < 60 ? "warn" : "ok";
  els.telemetryDialFill.dataset.level = level;

  const textContainer = els.telemetryDialFill.closest(".telemetry-dial-container")?.querySelector(".telemetry-dial-text");
  if (textContainer) textContainer.dataset.level = level;

  // Update gravity sensitivity display from state (in case it changed programmatically)
  if (els.gravitySensitivityDisplay && els.gravitySensitivityInput) {
    const val = state.settings?.gravitySensitivity ?? 50;
    els.gravitySensitivityInput.value = val;
    els.gravitySensitivityDisplay.textContent = `${val}%`;
  }

  // Sprint 5: Update the four north-star metric tiles
  renderMetricsTiles();
  // Sprint 7: Update influence summary bar
  renderInfluenceSummary();
}

/** Render the 2x2 Session Health north-star metrics tiles. */
export function renderMetricsTiles() {
  if (!els.metricAlignmentVal) return; // Tiles not in DOM

  // 1. Alignment (from telemetry)
  const alignScore = state.telemetry?.currentAlignmentScore ?? 100;
  setMetricTile(els.metricTileAlignment, els.metricAlignmentVal, `${alignScore}%`,
    alignScore >= 60 ? 'ok' : alignScore >= 35 ? 'warn' : 'critical');

  // 2. Skip Rate (from messages)
  const msgs = state.messages || [];
  const totalMsgs = msgs.filter(m => m.type === 'actor' || m.type === 'dm' || m.type === 'skip').length;
  const skipMsgs = msgs.filter(m => m.type === 'skip').length;
  const skipRate = totalMsgs ? Math.round((skipMsgs / totalMsgs) * 100) : 0;
  setMetricTile(els.metricTileSkipRate, els.metricSkipRateVal, `${skipRate}%`,
    skipRate <= 25 ? 'ok' : skipRate <= 50 ? 'warn' : 'critical');

  // 3. Outcomes — rolling extraction rate from outcomeExtractionLog
  const log = state.diagnostics?.outcomeExtractionLog || [];
  if (log.length === 0) {
    setMetricTile(els.metricTileOutcomes, els.metricOutcomesVal, '—', 'ok');
  } else {
    const successes = log.filter(e => e.success).length;
    const rate = Math.round((successes / log.length) * 100);
    setMetricTile(els.metricTileOutcomes, els.metricOutcomesVal,
      `${successes}/${log.length}`,
      rate >= 70 ? 'ok' : rate >= 40 ? 'warn' : 'critical');
  }

  // 4. Memory Duplication Score
  const deltas = state.memory?.recentDeltas || [];
  let memDup = 0;
  if (deltas.length > 1) {
    // Quick overlap heuristic: count pairs with >40% word overlap
    let matches = 0, comparisons = 0;
    for (let i = 0; i < deltas.length; i++) {
      for (let j = i + 1; j < deltas.length; j++) {
        comparisons++;
        const setA = new Set(deltas[i].toLowerCase().split(/\s+/).filter(w => w.length > 2));
        const setB = new Set(deltas[j].toLowerCase().split(/\s+/).filter(w => w.length > 2));
        let intersect = 0;
        for (const w of setA) { if (setB.has(w)) intersect++; }
        if (setA.size && intersect / setA.size > 0.4) matches++;
      }
    }
    memDup = comparisons ? Math.round((matches / comparisons) * 100) : 0;
  }
  setMetricTile(els.metricTileMemDup, els.metricMemDupVal,
    deltas.length < 2 ? '—' : `${memDup}%`,
    memDup <= 20 ? 'ok' : memDup <= 50 ? 'warn' : 'critical');
}

function setMetricTile(tileEl, valueEl, text, level) {
  if (!tileEl || !valueEl) return;
  valueEl.textContent = text;
  tileEl.dataset.level = level;
}

export function renderOutcomes() {
  els.outcomeRecommendation.value = state.outcomes.finalRecommendation;
  els.outcomeDecisions.value = state.outcomes.decisions;
  els.outcomeRationale.value = state.outcomes.rationale;
  els.outcomeRejected.value = state.outcomes.rejectedOptions;
  els.outcomeActions.value = state.outcomes.actionItems;
  els.outcomeRisks.value = state.outcomes.risks;
  els.outcomeStatus.textContent = state.outcomes.status || "No outcomes extracted yet.";
}

// Sprint 7A: Anchors panel
export function renderAnchors() {
  const list = document.getElementById('anchorsList');
  const count = document.getElementById('anchorsCount');
  if (!list) return;
  const anchors = Array.isArray(state.anchors) ? state.anchors : [];
  if (count) count.textContent = anchors.length ? String(anchors.length) : '';
  if (!anchors.length) {
    list.innerHTML = '<p class="anchors-empty">No anchors yet. Click ⚓ on any message to anchor a settled claim.</p>';
    return;
  }
  list.innerHTML = anchors.map(a => `
    <div class="anchor-item" data-id="${escapeHtml(a.id)}">
      <span class="anchor-dot" style="background:${escapeHtml(a.color || 'var(--gold)')}"></span>
      <span class="anchor-text">${escapeHtml((a.text || '').slice(0, 160))}${(a.text || '').length > 160 ? '…' : ''}</span>
      <span class="anchor-speaker">${escapeHtml(a.speaker || 'Group')}</span>
      <button class="anchor-remove" type="button" title="Remove anchor" data-id="${escapeHtml(a.id)}">✕</button>
    </div>
  `).join('');

  // Wire remove buttons
  list.querySelectorAll('.anchor-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      state.anchors = state.anchors.filter(a => a.id !== id);
      saveState();
      renderAnchors();
      renderTranscript();
    });
  });
}

// Sprint 7B: Session-level influence summary bar
export function renderInfluenceSummary() {
  const container = document.getElementById('influenceSummaryBar');
  if (!container) return;

  const actorMessages = state.messages.filter(m =>
    (m.type === 'actor' || m.type === 'dm') && m.content
  );
  if (!actorMessages.length) {
    container.innerHTML = '<span class="influence-empty">No turns yet.</span>';
    return;
  }

  // Aggregate influence across all messages
  const sessionTotals = new Map();
  actorMessages.forEach(msg => {
    const budget = calculateInfluenceBudget(msg, state.messages, state.actors);
    budget.forEach(seg => {
      const prev = sessionTotals.get(seg.speakerName) || { fraction: 0, color: seg.color };
      sessionTotals.set(seg.speakerName, { fraction: prev.fraction + seg.fraction, color: seg.color });
    });
  });

  if (!sessionTotals.size) {
    container.innerHTML = '<span class="influence-empty">Insufficient data.</span>';
    return;
  }

  const total = [...sessionTotals.values()].reduce((s, v) => s + v.fraction, 0);
  const sorted = [...sessionTotals.entries()]
    .map(([name, v]) => ({ name, fraction: v.fraction / total, color: v.color }))
    .sort((a, b) => b.fraction - a.fraction);

  container.innerHTML = `
    <div class="influence-summary-bar">${
      sorted.map(s =>
        `<span class="influence-segment" style="flex:${s.fraction};background:${s.color}" title="${escapeHtml(s.name)}: ${Math.round(s.fraction * 100)}%"></span>`
      ).join('')
    }</div>
    <div class="influence-legend">${
      sorted.map(s =>
        `<span class="influence-legend-item"><span class="influence-dot" style="background:${s.color}"></span>${escapeHtml(s.name)} ${Math.round(s.fraction * 100)}%</span>`
      ).join('')
    }</div>
  `;
}

export function renderAutoStop() {
  els.autoStopEnabled.checked = state.autoStop.enabled;
  els.autoGoal.value = state.autoStop.goal;
  els.goalCheckEnabled.checked = state.autoStop.goalCheckEnabled;
  els.stopOnAllSkip.checked = state.autoStop.stopOnAllSkip;
  els.maxRoundsEnabled.checked = state.autoStop.maxRoundsEnabled;
  els.maxRounds.value = state.autoStop.maxRounds;
  els.maxRounds.disabled = !state.autoStop.maxRoundsEnabled;
  els.checkGoalNow.disabled = isGenerating || !state.autoStop.goal.trim();
  els.autoStopStatus.textContent = state.autoStop.status || "Auto-stop ready.";
}


export function renderModePills() {
  const mode = state.scenario.mode || "problem";
  els.modePills.forEach((pill) => {
    pill.classList.toggle("active", pill.dataset.mode === mode);
  });
}

export function renderTemperatureDisplay() {
  if (els.temperatureDisplay) {
    els.temperatureDisplay.textContent = Number(state.settings.temperature).toFixed(2);
  }
  if (els.quickStartTempDisplay && els.quickStartTemp) {
    const qVal = state.ui.quickStartTemperature ?? 0.8;
    els.quickStartTemp.value = qVal;
    els.quickStartTempDisplay.textContent = Number(qVal).toFixed(2);
  }
}

export function renderConversationSummary() {
  if (!els.conversationSummary) return;
  els.conversationSummary.innerHTML = "";
  const scenario = document.createElement("div");
  scenario.className = "summary-block";
  scenario.innerHTML = "<h3>Scenario</h3>";
  scenario.append(summaryLine("Mode", labelForMode(state.scenario.mode)));
  scenario.append(summaryLine("Premise", state.scenario.premise || "No premise set."));
  scenario.append(summaryLine("Objective", state.scenario.objective || "No objective set."));

  const actors = document.createElement("div");
  actors.className = "summary-block";
  actors.innerHTML = "<h3>Actors</h3>";
  state.actors.forEach((actor) => {
    const row = document.createElement("p");
    row.className = "actor-summary-row";
    const dot = document.createElement("span");
    dot.className = "speaker-dot";
    dot.style.background = actor.color;
    const text = document.createElement("span");
    text.textContent = `${actor.enabled ? "" : "Disabled: "}${actor.name} — ${actor.role || "Participant"}`;
    row.append(dot, text);
    actors.append(row);
  });

  const director = document.createElement("div");
  director.className = "summary-block";
  director.innerHTML = "<h3>Director</h3>";
  director.append(summaryLine("Status", state.dm.enabled ? `${state.dm.name} enabled` : "Off"));
  director.append(summaryLine("Memory", state.memory.enabled ? `${state.memory.archivedCount} archived chunk${state.memory.archivedCount === 1 ? "" : "s"}` : "Off"));

  els.conversationSummary.append(scenario, actors, director);
}

export function summaryLine(label, value) {
  const row = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = `${label}: `;
  const span = document.createElement("span");
  span.textContent = value;
  row.append(strong, span);
  return row;
}

export function renderDocument() {
  if (!els.documentEnabled) return;
  els.documentEnabled.checked = state.document.enabled;
  els.documentTitle.value = state.document.title || "";
  
  const versions = state.document.versions || [];
  const maxIndex = versions.length;
  
  // 1. Calculate & Render Attribution Bar
  if (els.documentAttributionContainer) {
    if (!state.document.enabled || versions.length === 0) {
      els.documentAttributionContainer.style.display = "none";
    } else {
      els.documentAttributionContainer.style.display = "flex";
      els.documentAttributionContainer.innerHTML = "";
      
      const counts = {};
      let total = 0;
      versions.forEach((v) => {
        const authorName = v.author || "Unknown";
        counts[authorName] = (counts[authorName] || 0) + 1;
        total++;
      });
      
      const actorColorMap = {};
      state.actors.forEach((a) => {
        actorColorMap[a.name] = a.color;
      });
      actorColorMap["User"] = "#355f9f";
      actorColorMap["Director"] = "#a2611a";
      if (state.dm && state.dm.name) {
        actorColorMap[state.dm.name] = "#a2611a";
      }
      
      Object.entries(counts).forEach(([author, count]) => {
        const pct = (count / total) * 100;
        const segment = document.createElement("div");
        segment.className = "attribution-segment";
        segment.style.width = `${pct}%`;
        segment.style.backgroundColor = actorColorMap[author] || "#888";
        segment.title = `${author}: ${count} edit${count !== 1 ? "s" : ""} (${pct.toFixed(0)}%)`;
        els.documentAttributionContainer.appendChild(segment);
      });
    }
  }

  // 2. Render History Scrubber & Current Preview Content
  if (els.documentHistoryContainer && els.documentHistorySlider && els.documentHistoryStatus && els.documentRestoreButton) {
    if (!state.document.enabled || versions.length === 0) {
      els.documentHistoryContainer.style.display = "none";
    } else {
      els.documentHistoryContainer.style.display = "block";
      els.documentHistorySlider.max = maxIndex;
      
      if (typeof state.ui.viewingVersionIndex === "undefined" || state.ui.viewingVersionIndex > maxIndex || state.ui.viewingVersionIndex < 0) {
        state.ui.viewingVersionIndex = maxIndex;
      }
      
      els.documentHistorySlider.value = state.ui.viewingVersionIndex;
      
      if (state.ui.viewingVersionIndex === maxIndex) {
        // Viewing Current Draft
        els.documentHistoryStatus.innerHTML = `<span class="muted-text">Viewing: <strong>Current Draft</strong></span>`;
        els.documentRestoreButton.style.display = "none";
        if (els.documentPreview) {
          els.documentPreview.classList.remove("viewing-history");
          els.documentPreview.innerHTML = renderMarkdown(state.document.content || "");
        }
        if (document.activeElement !== els.documentContent) {
          els.documentContent.value = state.document.content || "";
        }
      } else {
        // Viewing Historical Version
        const ver = versions[state.ui.viewingVersionIndex];
        const dateStr = ver.timestamp ? new Date(ver.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "unknown time";
        
        let authorColor = "#888";
        if (ver.author === "User") authorColor = "#355f9f";
        else if (ver.author === "Director" || (state.dm && ver.author === state.dm.name)) authorColor = "#a2611a";
        else {
          const match = state.actors.find((a) => a.name === ver.author);
          if (match) authorColor = match.color;
        }
        
        els.documentHistoryStatus.innerHTML = `
          <span>Viewing: <strong>Version ${state.ui.viewingVersionIndex + 1} of ${maxIndex}</strong></span>
          <span>By <span class="author-badge" style="background:${authorColor}">${escapeHtml(ver.author)}</span> at ${dateStr}</span>
        `;
        els.documentRestoreButton.style.display = "";
        
        if (els.documentPreview) {
          els.documentPreview.classList.add("viewing-history");
          els.documentPreview.innerHTML = renderMarkdown(ver.content || "");
        }
        if (document.activeElement !== els.documentContent) {
          els.documentContent.value = ver.content || "";
        }
      }
    }
  }

  // Fallback if versions is empty or document history UI components don't exist
  if (versions.length === 0 || !els.documentHistoryContainer) {
    if (document.activeElement !== els.documentContent) {
      els.documentContent.value = state.document.content || "";
    }
    if (els.documentPreview) {
      els.documentPreview.classList.remove("viewing-history");
      els.documentPreview.innerHTML = renderMarkdown(state.document.content || "");
    }
  }
  
  const vCount = versions.length;
  els.documentVersionCount.textContent = `${vCount} version${vCount !== 1 ? "s" : ""}`;

  // 3. Attribution toggle sync
  if (els.documentShowAttributionInput) {
    els.documentShowAttributionInput.checked = !!state.document.showAttribution;
  }

  // 4. Confluence River Canvas — show/hide based on showAttribution
  if (els.documentConfluenceContainer && els.documentConfluenceCanvas) {
    const showConfluence = !!state.document.showAttribution && state.document.enabled;
    els.documentConfluenceContainer.style.display = showConfluence ? "" : "none";
    if (showConfluence) {
      startConfluenceRiverAnimation(els.documentConfluenceCanvas);
    } else {
      stopConfluenceRiverAnimation();
    }
  }
}

export function switchDocView(viewName) {
  if (els.docEditView) els.docEditView.style.display = viewName === "edit" ? "" : "none";
  if (els.docPreviewView) els.docPreviewView.style.display = viewName === "preview" ? "" : "none";
  els.docViewBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.docView === viewName);
  });
  
  if (viewName === "edit") {
    // Snap scrubber back to current active draft so edits affect the correct draft
    state.ui.viewingVersionIndex = state.document.versions.length;
    renderDocument();
    els.documentContent.focus();
  } else if (viewName === "preview") {
    renderDocument();
  }
}

export function switchSidebarTab(tabName) {
  els.sidebarTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.sidebar === tabName);
  });
  els.sidebarPanels.forEach((panel) => {
    panel.style.display = panel.dataset.sidebarPanel === tabName ? "" : "none";
  });
}

export function renderQuickStartPreview() {
  const draft = state.ui.quickStartDraft;
  els.quickStartPrompt.value = state.ui.quickStartPrompt;
  els.quickStartStatus.textContent = state.ui.quickStartStatus || "No generated setup yet.";
  els.applyQuickStart.disabled = !draft;
  els.discardQuickStart.disabled = !draft;
  els.quickStartPreview.innerHTML = "";

  if (!draft) {
    const empty = document.createElement("p");
    empty.className = "pending-empty";
    empty.textContent = "Generated setup will appear here for review.";
    els.quickStartPreview.append(empty);
    return;
  }

  const scenario = quickStartPreviewSection("Scenario", [
    `Mode: ${labelForMode(draft.scenario.mode)}`,
    `Title: ${draft.scenario.title}`,
    `Premise: ${draft.scenario.premise}`,
    `Objective: ${draft.scenario.objective}`
  ]);
  const dm = quickStartPreviewSection("Director", [
    draft.dm.enabled ? `${draft.dm.name}: ${draft.dm.persona}` : "Director off",
    `Sees private thoughts: ${draft.dm.seesPrivateThoughts ? "yes" : "no"}`
  ]);
  const actors = quickStartPreviewSection("Actors", draft.actors.map((actor) => `${actor.name} — ${actor.role}: ${actor.goal}`));
  const pinnedText = normalizeStringArray(draft.memory.pinnedFacts).join("; ");
  const questionsText = normalizeStringArray(draft.memory.openQuestions).join("; ");
  const memory = quickStartPreviewSection("Memory Seed", [
    pinnedText ? `Pinned: ${pinnedText}` : "No pinned facts.",
    draft.memory.sharedSummary ? `Summary: ${draft.memory.sharedSummary}` : "No summary seed.",
    questionsText ? `Questions: ${questionsText}` : "No open questions.",
    draft.memory.dmState ? `DM state: ${draft.memory.dmState}` : "No DM state."
  ]);
  els.quickStartPreview.append(scenario, dm, actors, memory);
}

export function quickStartPreviewSection(title, lines) {
  const section = document.createElement("div");
  section.className = "quick-start-preview-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading);
  lines.filter(Boolean).forEach((line) => {
    const item = document.createElement("p");
    item.textContent = line;
    section.append(item);
  });
  return section;
}

export function renderMemory() {
  els.memoryEnabled.checked = state.memory.enabled;
  els.pinnedFacts.value = Array.isArray(state.memory.pinnedFacts) ? state.memory.pinnedFacts.join("\n") : safeString(state.memory.pinnedFacts);
  els.sharedSummary.value = safeString(state.memory.sharedSummary);
  els.openQuestions.value = Array.isArray(state.memory.openQuestions) ? state.memory.openQuestions.join("\n") : safeString(state.memory.openQuestions);
  els.dmState.value = safeString(state.memory.dmState);
  renderPendingFacts();
  renderRecentDeltas();
  renderCycleBadge();
  const storageText = storageAvailable ? "IndexedDB" : "in-memory";
  const warning = storageWarning ? ` ${storageWarning}` : "";
  els.memoryStatus.textContent = `${storageText} memory. ${state.memory.archivedCount} archived chunk${state.memory.archivedCount === 1 ? "" : "s"}.${warning}`;
}

export function renderRecentDeltas() {
  const deltas = state.memory.recentDeltas || [];
  if (!els.recentDeltasSection) return;
  if (!deltas.length) {
    els.recentDeltasSection.style.display = "none";
    return;
  }
  els.recentDeltasSection.style.display = "";
  els.deltaCount.textContent = `(${deltas.length})`;
  els.recentDeltasList.innerHTML = "";
  deltas.forEach((delta) => {
    const p = document.createElement("p");
    p.className = "delta-entry";
    p.textContent = delta;
    els.recentDeltasList.append(p);
  });
}

export function renderCycleBadge() {
  if (!els.cycleBadge) return;
  if (!state.memory.enabled || state.memory.cycleCount === 0) {
    els.cycleBadge.style.display = "none";
    return;
  }
  const position = (state.memory.cycleCount % DELTA_REWRITE_EVERY) || DELTA_REWRITE_EVERY;
  const isNextRewrite = position === DELTA_REWRITE_EVERY;
  els.cycleBadge.style.display = "";
  els.cycleBadge.textContent = isNextRewrite
    ? `Cycle ${state.memory.cycleCount} — full rewrite next`
    : `Cycle ${state.memory.cycleCount} — delta ${position}/${DELTA_REWRITE_EVERY}`;
  els.cycleBadge.className = `cycle-badge${isNextRewrite ? " cycle-rewrite" : ""}`;
}

export function renderTokenGauge() {
  const { maxContextLength, lastPromptTokens } = state.contextInfo || {};
  if (!maxContextLength || !els.tokenGauge) return;

  const used = lastPromptTokens || 0;
  const pct = Math.min(100, (used / maxContextLength) * 100);
  const level = pct >= 90 ? "critical" : pct >= 70 ? "warn" : "ok";

  els.tokenGauge.hidden = false;
  els.tokenGaugeBar.style.width = `${pct.toFixed(1)}%`;
  els.tokenGaugeBar.dataset.level = level;

  const fmt = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  els.tokenGaugeLabel.textContent = `${fmt(used)} / ${fmt(maxContextLength)} tokens · ${pct.toFixed(1)}%`;
  els.tokenGaugeLabel.dataset.level = level;

  els.tokenGauge.title = `Context window: ${used.toLocaleString()} of ${maxContextLength.toLocaleString()} tokens used`;

  // Warn when the context window is too tight for this app to work well.
  // A comfortable session needs at least 8K total: ~4-6K prompt + 1.2K completion headroom.
  const maxTokens = state.settings?.maxTokens || 1200;
  const headroom = maxContextLength - used;
  let ctxWarning = "";
  if (maxContextLength < 6000) {
    ctxWarning = `⚠️ Context window is only ${fmt(maxContextLength)} tokens — too small for reliable sessions. Recommend 8K+.`;
  } else if (headroom < maxTokens && used > 0) {
    ctxWarning = `⚠️ Only ${fmt(headroom)} tokens left for completion (${fmt(maxTokens)} needed) — responses may be truncated.`;
  }

  // Show context window size and warn if maxTokens setting is too high
  const ctxHint = document.getElementById("modelContextInfo");
  if (ctxHint) {
    const maxTok = state.settings?.maxTokens || 0;
    const isExcessive = maxTok > 0 && maxTok > maxContextLength * 0.8;
    const ctxFmt = maxContextLength >= 1000 ? `${Math.round(maxContextLength / 1000)}K` : String(maxContextLength);
    ctxHint.textContent = isExcessive
      ? `Context: ${ctxFmt} ⚠ maxTokens (${maxTok}) exceeds 80% — reduce or responses may be cut short`
      : `Context: ${ctxFmt}`;
    ctxHint.dataset.level = isExcessive ? "warn" : "ok";
    ctxHint.style.display = "";
  }

  // Find or create the context warning element
  let ctxWarnEl = els.tokenGauge.parentElement?.querySelector(".ctx-window-warning");
  if (ctxWarning) {
    if (!ctxWarnEl) {
      ctxWarnEl = document.createElement("div");
      ctxWarnEl.className = "ctx-window-warning";
      els.tokenGauge.after(ctxWarnEl);
    }
    ctxWarnEl.textContent = ctxWarning;
    ctxWarnEl.dataset.level = maxContextLength < 6000 ? "critical" : "warn";
    ctxWarnEl.hidden = false;
  } else if (ctxWarnEl) {
    ctxWarnEl.hidden = true;
  }
}


/**
 * Render archived memory chunks into the chunk browser panel.
 * Called from main.js after loading chunks from IndexedDB.
 */
export function renderChunkBrowser(chunks) {
  if (!els.chunkBrowserList) return;
  els.chunkBrowserList.innerHTML = "";

  if (!chunks.length) {
    const empty = document.createElement("p");
    empty.className = "pending-empty";
    empty.textContent = "No archived chunks yet.";
    els.chunkBrowserList.append(empty);
    return;
  }

  // Show most recent first
  [...chunks].reverse().forEach((chunk, index) => {
    const card = document.createElement("article");
    card.className = "chunk-card";

    const meta = document.createElement("div");
    meta.className = "chunk-meta";

    const time = document.createElement("span");
    time.className = "chunk-time";
    time.textContent = chunk.createdAt ? new Date(chunk.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Unknown time";

    const speakers = document.createElement("span");
    speakers.className = "chunk-speakers";
    speakers.textContent = (chunk.speakers || []).join(", ") || "Unknown speakers";

    const keywords = document.createElement("span");
    keywords.className = "chunk-keywords";
    keywords.textContent = (chunk.keywords || []).slice(0, 6).join(" · ");

    const hasVector = Array.isArray(chunk.vector);
    const vectorBadge = document.createElement("span");
    vectorBadge.className = `chunk-vector-badge${hasVector ? " has-vector" : ""}`;
    vectorBadge.title = hasVector ? `${chunk.vectorDim || "?"}-dim vector (${chunk.embeddingModel || "unknown model"})` : "No vector embedding";
    vectorBadge.textContent = hasVector ? "🔗" : "💤";

    meta.append(time, speakers, keywords, vectorBadge);

    const det = document.createElement("details");
    const sum = document.createElement("summary");
    const preview = (chunk.text || "").slice(0, 120).replace(/\n/g, " ");
    sum.textContent = `${chunks.length - index}. ${preview}${chunk.text?.length > 120 ? "…" : ""}`;

    const body = document.createElement("p");
    body.className = "chunk-full-text";
    body.textContent = chunk.text || "(no text)";

    det.append(sum, body);
    card.append(meta, det);
    els.chunkBrowserList.append(card);
  });
}

export function renderPendingFacts() {
  // Preserve any facts the user has explicitly unchecked before we wipe the DOM.
  const uncheckedFacts = new Set();
  els.pendingFactsList.querySelectorAll(".pending-fact-check").forEach((cb) => {
    if (!cb.checked) {
      const fact = state.memory.pendingPinnedFacts[Number(cb.dataset.index)];
      if (fact) uncheckedFacts.add(fact);
    }
  });

  els.pendingFactsList.innerHTML = "";
  if (!state.memory.pendingPinnedFacts.length) {
    const empty = document.createElement("p");
    empty.className = "pending-empty";
    empty.textContent = "No pending pinned facts.";
    els.pendingFactsList.append(empty);
    return;
  }

  state.memory.pendingPinnedFacts.forEach((fact, index) => {
    const label = document.createElement("label");
    label.className = "pending-fact-row";
    // Restore unchecked state if the user had deselected this fact before the re-render.
    const isChecked = !uncheckedFacts.has(fact);
    label.innerHTML = `<input class="pending-fact-check" type="checkbox" ${isChecked ? "checked" : ""} data-index="${index}"><span></span>`;
    $("span", label).textContent = fact;
    els.pendingFactsList.append(label);
  });
}

export function renderStageHeader() {
  const mode = state.scenario.mode || "problem";
  els.modeLabel.textContent = labelForMode(mode);
  els.modeLabel.className = `mode-badge mode-${mode}`;
  els.stageTitle.textContent = state.scenario.title || "Untitled forum";
}

export function labelForMode(mode) {
  if (mode === "story") return "Story";
  if (mode === "freeform") return "Freeform";
  return "Problem";
}

export function renderActors() {
  const template = $("#actorTemplate");
  els.actorList.innerHTML = "";
  state.actors.forEach((actor, index) => {
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.actorId = actor.id;

    // Apply actor color as left border
    node.style.borderLeftColor = actor.color;

    // Collapsed/expanded state
    if (actor.expanded) node.classList.add("expanded");

    $(".actor-enabled", node).checked = actor.enabled;
    $(".actor-is-researcher", node).checked = !!actor.isResearcher;
    $(".researcher-badge", node).style.display = actor.isResearcher ? "" : "none";
    node.classList.toggle("researcher-agent", !!actor.isResearcher);
    $(".actor-swatch", node).style.background = actor.color;
    $(".actor-name-display", node).textContent = actor.name || `Actor ${index + 1}`;
    $(".role-badge", node).textContent = actor.role || "Participant";
    $(".actor-name", node).value = actor.name;
    $(".actor-role", node).value = actor.role;
    $(".actor-persona", node).value = actor.persona;
    $(".actor-goal", node).value = actor.goal;
    $(".actor-voice", node).value = actor.voice;
    $(".actor-thoughts", node).value = safeString(actor.thoughts);
    const tempVal = typeof actor.temperature === "number" ? actor.temperature : 0.8;
    $(".actor-temperature", node).value = tempVal;
    $(".actor-temperature-display", node).textContent = Number(tempVal).toFixed(2);

    // Relationship ledger — shown only when entries exist
    const relBlock = $(".actor-relationships-block", node);
    const relList = $(".actor-relationships-list", node);
    const relEntries = Object.entries(actor.relationships || {});
    if (relEntries.length) {
      relBlock.style.display = "";
      relList.innerHTML = relEntries
        .map(([name, note]) => `<li><strong>${escapeHtml(name)}:</strong> ${escapeHtml(note)}</li>`)
        .join("");
    } else {
      relBlock.style.display = "none";
      relList.innerHTML = "";
    }

    $(".remove-actor", node).disabled = state.actors.length <= 1;

    // Expand/collapse toggle
    $(".actor-expand-toggle", node).addEventListener("click", (e) => {
      e.stopPropagation();
      actor.expanded = !actor.expanded;
      node.classList.toggle("expanded", actor.expanded);
      saveState();
    });

    // Clicking the summary row also expands
    $(".actor-card-summary", node).addEventListener("click", (e) => {
      if (e.target.closest("input, button")) return;
      actor.expanded = !actor.expanded;
      node.classList.toggle("expanded", actor.expanded);
      saveState();
    });

    node.addEventListener("input", () => {
      actor.enabled = $(".actor-enabled", node).checked;
      actor.isResearcher = $(".actor-is-researcher", node).checked;
      actor.name = $(".actor-name", node).value.trim() || `Actor ${index + 1}`;
      actor.role = $(".actor-role", node).value.trim();
      actor.persona = $(".actor-persona", node).value.trim();
      actor.goal = $(".actor-goal", node).value.trim();
      actor.voice = $(".actor-voice", node).value.trim();
      actor.thoughts = $(".actor-thoughts", node).value.trim();
      actor.temperature = Number($(".actor-temperature", node).value || 0.8);
      // Sync display elements
      $(".actor-name-display", node).textContent = actor.name;
      $(".role-badge", node).textContent = actor.role || "Participant";
      $(".researcher-badge", node).style.display = actor.isResearcher ? "" : "none";
      node.classList.toggle("researcher-agent", actor.isResearcher);
      $(".actor-temperature-display", node).textContent = actor.temperature.toFixed(2);
      saveState();
      renderTranscript();
    });

    $(".remove-actor", node).addEventListener("click", () => {
      state.actors = state.actors.filter((item) => item.id !== actor.id);
      state.turnQueue = state.turnQueue.filter((id) => id !== actor.id);
      saveState();
      render();
    });

    els.actorList.append(node);
  });
}

export function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

export function formatMessageHtml(text, color) {
  const escaped = escapeHtml(text);
  const styleAttr = color ? `style="--rp-color: ${color};"` : "";
  let formatted = escaped.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  formatted = formatted.replace(/\*([^*\n"]+?)\*/g, `<span class="rp-action" ${styleAttr}>$1</span>`);
  return formatted;
}

export function renderTranscript() {
  const el = els.transcript;

  // ── Snapshot scroll state BEFORE touching DOM ──────────────────
  const oldScrollTop  = el.scrollTop;
  const wasAtBottom   = el.scrollHeight - oldScrollTop - el.clientHeight < 80;

  // Find which message the user is looking at by index.
  // Walk the existing message cards and find the first one whose top edge
  // is at or past the current scrollTop (i.e. the topmost visible card).
  let anchorIndex = -1;
  let anchorOffset = 0; // how far past the card's top the scroll was
  if (!wasAtBottom) {
    const cards = el.querySelectorAll('.message-card:not([data-streaming])');
    for (let i = 0; i < cards.length; i++) {
      const cardTop = cards[i].offsetTop;
      if (cardTop + cards[i].offsetHeight > oldScrollTop) {
        anchorIndex = i;
        anchorOffset = oldScrollTop - cardTop;
        break;
      }
    }
  }

  // Null-out streaming bubble refs (DOM element gets wiped by innerHTML below)
  removeStreamingBubble();

  // Build all nodes into a fragment before touching the live DOM.
  const frag = document.createDocumentFragment();

  if (!state.messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<div><strong>No turns yet</strong><span>Waiting for the opening move.</span></div>";
    frag.append(empty);
    el.innerHTML = "";
    el.appendChild(frag);
    return;
  }

  const template = $("#messageTemplate");
  state.messages.forEach((message) => {
    const node = template.content.firstElementChild.cloneNode(true);
    const actor = state.actors.find((item) => item.id === message.actorId);
    const speaker = message.speaker || actor?.name || "Forum";
    const actorColor = message.color || actor?.color || colorForType(message.type);
    node.classList.add(message.type || "actor");

    // Apply actor color as left border stripe
    if (message.type !== "user" && message.type !== "skip") {
      node.style.borderLeftColor = actorColor;
    }

    $(".speaker-dot", node).style.background = actorColor;
    $(".message-meta strong", node).textContent = speaker;

    // Show actor role label
    const roleLabel = $(".actor-role-label", node);
    if (actor?.role && message.type !== "user" && message.type !== "skip") {
      roleLabel.textContent = actor.role;
    } else if (message.type === "dm") {
      roleLabel.textContent = "Director";
    }

    $(".message-time", node).textContent = formatTime(message.createdAt);
    $(".message-content", node).innerHTML = formatMessageHtml(publicMessageContent(message), actorColor);

    // Thought block — always visible when there's a thought.
    // showThoughts only controls whether it starts expanded or collapsed.
    const thoughtBlock = $(".thought-block", node);
    if (message.thought) {
      $("p", thoughtBlock).textContent = message.thought;
      thoughtBlock.style.display = "";
      if (state.settings.showThoughts) {
        thoughtBlock.setAttribute("open", "");
      }
    } else {
      thoughtBlock.style.display = "none";
    }

    // Tool call badges — always shown if tools were used, regardless of Show Thoughts.
    const toolCallsEl = $(".tool-calls", node);
    const toolCalls = message.toolCalls || [];
    if (toolCalls.length) {
      toolCallsEl.style.display = "";
      let badgeHtml = toolCalls.map((tc) => {
        if (tc.tool === "web_search") {
          return `<span class="tool-badge tool-badge--search" title="Searched: ${escapeHtml(tc.query || "")}">🔍 searched: <em>${escapeHtml(tc.query || "")}</em></span>`;
        }
        if (tc.tool === "web_read") {
          const url = tc.url || "";
          const label = tc.domain || url;
          return `<a class="tool-badge tool-badge--read" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="Visited: ${escapeHtml(url)}">📄 read: <em>${escapeHtml(label)}</em></a>`;
        }
        return `<span class="tool-badge" title="${escapeHtml(tc.tool)}">⚙️ ${escapeHtml(tc.tool)}</span>`;
      }).join("");

      // Sprint 6: Tool Usefulness chip
      const tus = message.trace?.toolUsefulnessScore;
      if (typeof tus === 'number') {
        const [icon, label, cls] = tus >= 0.5
          ? ['🔗', `cited (${Math.round(tus * 100)}%)`, 'metric-chip highlight']
          : tus >= 0.1
            ? ['〰', `partial (${Math.round(tus * 100)}%)`, 'metric-chip']
            : ['✗', 'unused', 'metric-chip'];
        badgeHtml += ` <span class="${cls}" title="Tool content cited in response: ${Math.round(tus * 100)}%">${icon} ${label}</span>`;
      }

      toolCallsEl.innerHTML = badgeHtml;
    } else {
      toolCallsEl.style.display = "none";
    }

    // Document edit badge
    const docBadge = $(".doc-edit-badge", node);
    if (message.docEdited) {
      docBadge.style.display = "";
    } else {
      docBadge.style.display = "none";
    }

    // Preflight badge on pre-screened skip cards
    if (message.preflightSkipped) {
      const badge = document.createElement('span');
      badge.className = 'preflight-badge';
      badge.title = message.trace?.preflightReason || 'Pre-screened by preflight router';
      badge.textContent = '🔍 pre-screened';
      $('.message-meta', node)?.appendChild(badge);
    }

    // Alternative candidates from hypothesis sampling
    if (Array.isArray(message.alternativeCandidates) && message.alternativeCandidates.length > 0) {
      const section = document.createElement('div');
      section.className = 'branch-candidates';
      const header = document.createElement('div');
      header.className = 'branch-candidates-header';
      header.textContent = `🌿 ${message.alternativeCandidates.length} alternative candidate${message.alternativeCandidates.length > 1 ? 's' : ''} sampled`;
      section.appendChild(header);

      message.alternativeCandidates.forEach((cand, ci) => {
        const card = document.createElement('div');
        card.className = 'branch-candidate-card';

        const content = document.createElement('div');
        content.className = 'branch-candidate-content';
        content.textContent = cand.message || '(empty)';

        const footer = document.createElement('div');
        footer.className = 'branch-candidate-footer';

        const score = typeof cand.compositeScore === 'number' ? cand.compositeScore.toFixed(2) : '?';
        const novelty = cand.metrics?.noveltyScore?.toFixed(2) ?? '?';
        const alignment = cand.metrics?.premiseAlignmentScore?.toFixed(2) ?? '?';

        footer.innerHTML = `
          <span class="metric-chip">Score: ${score}</span>
          <span class="metric-chip">Novelty: ${novelty}</span>
          <span class="metric-chip">Align: ${alignment}</span>
        `;

        const useBtn = document.createElement('button');
        useBtn.className = 'use-candidate-btn';
        useBtn.type = 'button';
        useBtn.textContent = 'Use This';
        useBtn.addEventListener('click', () => {
          // Swap the accepted content
          const prev = message.content;
          message.content = cand.message;
          cand.message = prev;
          // Re-render so the swap is visible
          renderTranscript();
          saveState();
        });

        footer.appendChild(useBtn);
        card.appendChild(content);
        card.appendChild(footer);
        section.appendChild(card);
      });

      node.appendChild(section);
    }

    // ── Unified action bar ────────────────────────────────────────
    // All buttons live in the template's .msg-action-bar.
    // Wire up handlers and show/hide based on message type.
    const actionBar   = $('.msg-action-bar', node);
    const thumbUp     = $('.feedback-thumbs-up', node);
    const thumbDown   = $('.feedback-thumbs-down', node);
    const anchorBtn   = $('.anchor-btn', node);
    const forkBtn     = $('.fork-btn', node);
    const tagSelect   = $('.feedback-tag-select', node);
    const reasonRow   = $('.feedback-reason-row', node);

    const isActorOrDm = message.type === 'actor' || message.type === 'dm';
    const showFork    = isActorOrDm || message.type === 'user';

    if (actionBar && message.type !== 'skip' && message.type !== 'outcome') {
      actionBar.removeAttribute('hidden');

      // ── Feedback (actor/dm only) ──────────────────────────────
      if (isActorOrDm) {
        // Restore saved rating
        if (message.feedback === 'up')   thumbUp.classList.add('active-up');
        if (message.feedback === 'down') {
          thumbDown.classList.add('active-down');
          if (reasonRow) reasonRow.removeAttribute('hidden');
        }
        if (message.feedbackTag && tagSelect) tagSelect.value = message.feedbackTag;

        thumbUp.addEventListener('click', () => {
          message.feedback = message.feedback === 'up' ? null : 'up';
          message.feedbackTag = null;
          thumbUp.classList.toggle('active-up', message.feedback === 'up');
          thumbDown.classList.remove('active-down');
          if (reasonRow) reasonRow.hidden = true;
          if (tagSelect) tagSelect.value = '';
          saveState();
        });

        thumbDown.addEventListener('click', () => {
          message.feedback = message.feedback === 'down' ? null : 'down';
          thumbDown.classList.toggle('active-down', message.feedback === 'down');
          thumbUp.classList.remove('active-up');
          if (reasonRow) reasonRow.hidden = !message.feedback;
          if (!message.feedback && tagSelect) { message.feedbackTag = null; tagSelect.value = ''; }
          saveState();
        });

        if (tagSelect) tagSelect.addEventListener('change', () => {
          message.feedbackTag = tagSelect.value || null;
          saveState();
        });
      } else {
        if (thumbUp)   thumbUp.hidden   = true;
        if (thumbDown) thumbDown.hidden = true;
        if (reasonRow) reasonRow.hidden = true;
      }

      // ── Anchor (actor/dm only) ───────────────────────────────
      if (isActorOrDm && anchorBtn) {
        const isAnchored = Array.isArray(state.anchors) &&
          state.anchors.some(a => a.messageId === message.id);
        anchorBtn.title = isAnchored ? 'Remove anchor' : 'Anchor this claim';
        if (isAnchored) {
          anchorBtn.classList.add('is-anchored');
          node.style.borderLeftColor = 'var(--gold)';
          node.classList.add('anchored-card');
        }
        anchorBtn.addEventListener('click', () => {
          if (!Array.isArray(state.anchors)) state.anchors = [];
          const existing = state.anchors.findIndex(a => a.messageId === message.id);
          if (existing >= 0) {
            state.anchors.splice(existing, 1);
          } else {
            state.anchors.push({
              id: `anchor-${Date.now()}`,
              text: message.content,
              speaker: message.speaker,
              color: message.color,
              messageId: message.id,
              createdAt: new Date().toISOString()
            });
          }
          saveState();
          renderTranscript();
          renderAnchors();
        });
      } else {
        if (anchorBtn) anchorBtn.hidden = true;
      }

      // ── Fork ─────────────────────────────────────────────────
      if (showFork && forkBtn) {
        forkBtn.addEventListener('click', async () => {
          const { forkSessionAtMessage } = await import('./session.js');
          await forkSessionAtMessage(message.id);
        });
      } else {
        if (forkBtn) forkBtn.hidden = true;
      }
    } else {
      if (actionBar) actionBar.hidden = true;
    }

    // Sprint 7B: Influence bar — computed on-the-fly, shown when enabled
    if ((message.type === 'actor' || message.type === 'dm') && state.settings?.showInfluenceBars) {
      const budget = calculateInfluenceBudget(message, state.messages, state.actors);
      if (budget.length > 0) {
        const bar = document.createElement('div');
        bar.className = 'influence-bar';
        bar.title = budget.map(s => `${s.speakerName}: ${Math.round(s.fraction * 100)}%`).join(' | ');
        budget.forEach(seg => {
          const span = document.createElement('span');
          span.className = 'influence-segment';
          span.style.flex = String(seg.fraction);
          span.style.background = seg.color;
          span.dataset.speaker = seg.speakerName;
          span.title = `${seg.speakerName}: ${Math.round(seg.fraction * 100)}%`;
          bar.appendChild(span);
        });
        node.insertBefore(bar, node.firstChild);
      }
    }

      frag.append(node);
  });

  // Atomic DOM swap: blank window is as short as possible.
  el.innerHTML = "";
  el.appendChild(frag);

  // ── Restore scroll position ────────────────────────────────────
  if (wasAtBottom) {
    // Was following the conversation — jump to bottom.
    el.scrollTop = el.scrollHeight;
  } else if (anchorIndex >= 0) {
    // Was reading history — find the same card by index and restore position.
    const newCards = el.querySelectorAll('.message-card');
    const target = newCards[Math.min(anchorIndex, newCards.length - 1)];
    if (target) {
      el.scrollTop = target.offsetTop + anchorOffset;
    }
  }
}

export function colorForType(type) {
  if (type === "user") return "var(--blue)";
  if (type === "dm") return "var(--gold)";
  if (type === "skip") return "var(--muted)";
  return "var(--accent)";
}

export function formatTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function syncFormFromState() {
  els.baseUrl.value = state.settings.baseUrl;
  els.apiKey.value = state.settings.apiKey;
  els.model.value = state.settings.model;
  els.embeddingModel.value = state.settings.embeddingModel || "";
  els.temperature.value = state.settings.temperature;
  els.mode.value = state.scenario.mode;
  els.title.value = state.scenario.title;
  els.premise.value = state.scenario.premise;
  els.objective.value = state.scenario.objective;
  els.dmEnabled.checked = state.dm.enabled;
  els.dmName.value = state.dm.name;
  els.dmPersona.value = state.dm.persona;
  els.dmPrivate.checked = state.dm.seesPrivateThoughts;
  els.quickStartPrompt.value = state.ui.quickStartPrompt;
  if (els.quickStartTemp) {
    els.quickStartTemp.value = state.ui.quickStartTemperature ?? 0.8;
  }
  els.quickStartStatus.textContent = state.ui.quickStartStatus;
  els.memoryEnabled.checked = state.memory.enabled;
  els.pinnedFacts.value = Array.isArray(state.memory.pinnedFacts) ? state.memory.pinnedFacts.join("\n") : safeString(state.memory.pinnedFacts);
  els.sharedSummary.value = state.memory.sharedSummary;
  els.openQuestions.value = Array.isArray(state.memory.openQuestions) ? state.memory.openQuestions.join("\n") : safeString(state.memory.openQuestions);
  els.dmState.value = state.memory.dmState;
  els.outcomeRecommendation.value = state.outcomes.finalRecommendation;
  els.outcomeDecisions.value = Array.isArray(state.outcomes.decisions) ? state.outcomes.decisions.join("\n") : safeString(state.outcomes.decisions);
  els.outcomeRationale.value = Array.isArray(state.outcomes.rationale) ? state.outcomes.rationale.join("\n") : safeString(state.outcomes.rationale);
  els.outcomeRejected.value = Array.isArray(state.outcomes.rejectedOptions) ? state.outcomes.rejectedOptions.join("\n") : safeString(state.outcomes.rejectedOptions);
  els.outcomeActions.value = Array.isArray(state.outcomes.actionItems) ? state.outcomes.actionItems.join("\n") : safeString(state.outcomes.actionItems);
  els.outcomeRisks.value = Array.isArray(state.outcomes.risks) ? state.outcomes.risks.join("\n") : safeString(state.outcomes.risks);
  els.outcomeStatus.textContent = state.outcomes.status;
  els.autoStopEnabled.checked = state.autoStop.enabled;
  els.autoGoal.value = state.autoStop.goal;
  els.goalCheckEnabled.checked = state.autoStop.goalCheckEnabled;
  els.stopOnAllSkip.checked = state.autoStop.stopOnAllSkip;
  els.maxRoundsEnabled.checked = state.autoStop.maxRoundsEnabled;
  els.maxRounds.value = state.autoStop.maxRounds;
  els.showThoughts.checked = state.settings.showThoughts;
  els.toolsEnabled.checked = state.settings.toolsEnabled;
  if (els.showThoughtsMirror) els.showThoughtsMirror.checked = state.settings.showThoughts;

  renderModePills();
  renderTemperatureDisplay();
  document.documentElement.dataset.theme = state.settings.theme || "dark";
  validateEmbeddingModel(state.settings.embeddingModel);
  // Sprint 7: Influence bars
  if (els.showInfluenceBarsInput) els.showInfluenceBarsInput.checked = !!state.settings.showInfluenceBars;
  // Round snapshot / KV cache toggle
  const roundSnapshotInput = document.getElementById("roundSnapshotInput");
  if (roundSnapshotInput) roundSnapshotInput.checked = state.settings.roundSnapshotEnabled !== false;
}

export function readSettingsFromForm() {
  state.settings.baseUrl = els.baseUrl.value.trim() || defaultState.settings.baseUrl;
  state.settings.apiKey = els.apiKey.value.trim() || "lm-studio";
  state.settings.model = els.model.value.trim();
  state.settings.embeddingModel = els.embeddingModel.value.trim();
  state.settings.temperature = Number(els.temperature.value || defaultState.settings.temperature);
  state.scenario.mode = els.mode.value;
  state.scenario.title = els.title.value.trim() || "Untitled forum";
  // Mirror to document title if it hasn't been manually customised
  // (document title equals scenario title, or is blank — both indicate it's still the default)
  if (state.document && (!state.document.title || state.document.title === state.scenario._lastSyncedTitle)) {
    state.document.title = state.scenario.title;
    if (els.documentTitle) els.documentTitle.value = state.scenario.title;
  }
  state.scenario._lastSyncedTitle = state.scenario.title;

  state.scenario.premise = els.premise.value.trim();
  state.scenario.objective = els.objective.value.trim();
  // Auto-populate goal from objective when the user hasn't manually set a goal
  if (!state.autoStop.goal.trim() && state.scenario.objective) {
    state.autoStop.goal = state.scenario.objective;
    if (els.autoGoal) els.autoGoal.value = state.scenario.objective;
  }
  state.dm.enabled = els.dmEnabled.checked;
  state.dm.name = els.dmName.value.trim() || "Director";
  state.dm.persona = els.dmPersona.value.trim();
  state.dm.seesPrivateThoughts = els.dmPrivate.checked;
  state.ui.quickStartPrompt = els.quickStartPrompt.value.trim();
  if (els.quickStartTemp) {
    state.ui.quickStartTemperature = Number(els.quickStartTemp.value || 0.8);
  }
  readMemoryFromForm();
  readOutcomesFromForm();
  readAutoStopFromForm();
  state.settings.showThoughts = els.showThoughts.checked;
  state.settings.toolsEnabled = els.toolsEnabled.checked;
  // Keep mirrors in sync
  if (els.showThoughtsMirror) els.showThoughtsMirror.checked = state.settings.showThoughts;

  saveState();
  renderStageHeader();
}

export function readMemoryFromForm() {
  state.memory.enabled = els.memoryEnabled.checked;
  state.memory.pinnedFacts = normalizeStringArray(els.pinnedFacts.value);
  // Don't overwrite AI-managed fields while a background summarize is running
  if (!state.memory.isSummarizing) {
    state.memory.sharedSummary = els.sharedSummary.value.trim();
    state.memory.openQuestions = normalizeStringArray(els.openQuestions.value);
    state.memory.dmState = els.dmState.value.trim();
  }
}

export function readOutcomesFromForm() {
  state.outcomes.finalRecommendation = els.outcomeRecommendation.value.trim();
  state.outcomes.decisions = normalizeStringArray(els.outcomeDecisions.value);
  state.outcomes.rationale = normalizeStringArray(els.outcomeRationale.value);
  state.outcomes.rejectedOptions = normalizeStringArray(els.outcomeRejected.value);
  state.outcomes.actionItems = normalizeStringArray(els.outcomeActions.value);
  state.outcomes.risks = normalizeStringArray(els.outcomeRisks.value);
}

export function readAutoStopFromForm() {
  state.autoStop.enabled = els.autoStopEnabled.checked;
  state.autoStop.goal = els.autoGoal.value.trim();
  state.autoStop.goalCheckEnabled = els.goalCheckEnabled.checked;
  state.autoStop.stopOnAllSkip = els.stopOnAllSkip.checked;
  state.autoStop.maxRoundsEnabled = els.maxRoundsEnabled.checked;
  state.autoStop.maxRounds = Math.min(50, Math.max(1, Number(els.maxRounds.value || defaultState.autoStop.maxRounds)));
}

export async function validateEmbeddingModel(modelName) {
  if (!modelName) {
    if (els.embeddingWarning) els.embeddingWarning.style.display = "none";
    return;
  }
  const nameLower = modelName.toLowerCase();
  const looksLikeEmbedding = nameLower.includes("embed") ||
                             nameLower.includes("nomic") ||
                             nameLower.includes("bge") ||
                             nameLower.includes("minilm") ||
                             nameLower.includes("bert");
  
  if (!looksLikeEmbedding) {
    if (els.embeddingWarning) {
      els.embeddingWarning.style.display = "flex";
      els.embeddingWarning.querySelector("span:last-child").textContent = "Non-embedding model selected. Memory query vectorization may fail or be extremely slow.";
    }
    return;
  }

  // Quick 1-token verification
  try {
    const response = await fetch("/api/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseUrl: state.settings.baseUrl,
        apiKey: state.settings.apiKey,
        request: {
          model: modelName,
          input: "test"
        }
      })
    });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data?.data?.[0]?.embedding)) {
      if (els.embeddingWarning) {
        els.embeddingWarning.style.display = "flex";
        els.embeddingWarning.querySelector("span:last-child").textContent = "Embedding test request failed. Check server logs or model availability.";
      }
    } else {
      if (els.embeddingWarning) els.embeddingWarning.style.display = "none";
    }
  } catch (err) {
    if (els.embeddingWarning) {
      els.embeddingWarning.style.display = "flex";
      els.embeddingWarning.querySelector("span:last-child").textContent = "Embedding test request failed. Check connection or settings.";
    }
  }
}

// ── Session history list ──────────────────────────────────────────────────────

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderSessionsList(sessions) {
  const container = document.getElementById('sessionsList');
  if (!container) return;
  if (!sessions?.length) {
    container.innerHTML = '<p class="sessions-empty">No saved sessions yet.</p>';
    return;
  }
  container.innerHTML = sessions.map(s => {
    const date = s.timestamp
      ? new Date(s.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : 'Unknown date';
    return `<div class="session-card">
      <div class="session-card-title">${esc(s.scenarioTitle || 'Untitled')}</div>
      <div class="session-card-meta">${esc(date)} · ${s.actorCount || 0} actors · ${s.messageCount || 0} msgs</div>
      <div class="session-card-actions">
        <button class="secondary-button session-load-btn" data-session-id="${esc(s.id)}" type="button">Load</button>
        <button class="danger-button session-delete-btn" data-session-id="${esc(s.id)}" type="button">Delete</button>
      </div>
    </div>`;
  }).join('');
}

// ── In-transcript search ──────────────────────────────────────────────────────
let _searchMatches = [];
let _searchIndex = -1;

export function showTranscriptSearch() {
  const bar = document.getElementById("transcriptSearchBar");
  const input = document.getElementById("transcriptSearchInput");
  if (!bar || !input) return;
  bar.style.display = "flex";
  input.focus();
  input.select();
}

export function hideTranscriptSearch() {
  const bar = document.getElementById("transcriptSearchBar");
  const input = document.getElementById("transcriptSearchInput");
  if (bar) bar.style.display = "none";
  if (input) input.value = "";
  clearSearchHighlights();
  _searchMatches = [];
  _searchIndex = -1;
  updateSearchCount();
}

function clearSearchHighlights() {
  els.transcript?.querySelectorAll(".search-match, .search-current").forEach(el => {
    el.classList.remove("search-match", "search-current");
  });
}

export function runTranscriptSearch(query) {
  clearSearchHighlights();
  _searchMatches = [];
  _searchIndex = -1;

  if (!query || !query.trim()) {
    updateSearchCount();
    return;
  }

  const lower = query.toLowerCase();
  const cards = els.transcript ? Array.from(els.transcript.querySelectorAll(".message-card")) : [];
  cards.forEach(card => {
    const content = card.textContent || "";
    if (content.toLowerCase().includes(lower)) {
      card.classList.add("search-match");
      _searchMatches.push(card);
    }
  });

  if (_searchMatches.length > 0) {
    _searchIndex = 0;
    scrollToMatch(0);
  }
  updateSearchCount();
}

export function nextSearchMatch() {
  if (!_searchMatches.length) return;
  _searchIndex = (_searchIndex + 1) % _searchMatches.length;
  scrollToMatch(_searchIndex);
  updateSearchCount();
}

export function prevSearchMatch() {
  if (!_searchMatches.length) return;
  _searchIndex = (_searchIndex - 1 + _searchMatches.length) % _searchMatches.length;
  scrollToMatch(_searchIndex);
  updateSearchCount();
}

function scrollToMatch(index) {
  _searchMatches.forEach((el, i) => {
    el.classList.toggle("search-current", i === index);
    el.classList.toggle("search-match", i !== index);
  });
  _searchMatches[index]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function updateSearchCount() {
  const el = document.getElementById("transcriptSearchCount");
  if (!el) return;
  if (!_searchMatches.length) {
    el.textContent = "";
    return;
  }
  el.textContent = `${_searchIndex + 1} / ${_searchMatches.length}`;
}
