import { VALID_TABS, defaultState, DELTA_REWRITE_EVERY } from './constants.js';
import { state, saveState } from './state.js';
import { storageAvailable, storageWarning } from './db.js';
import { publicMessageContent } from './utils.js';
import { renderMarkdown } from './markdown.js';

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
  tabButtons: $$("[data-tab]").filter(el => el.closest(".mobile-nav") === null),
  mobileNavBtns: $$("[data-tab]").filter(el => el.closest(".mobile-nav") !== null),
  tabPanels: $$("[data-tab-panel]"),
  tabJumps: $$("[data-tab-jump]"),
  modePills: $$("[data-mode]"),
  temperatureDisplay: $("#temperatureDisplay"),
  baseUrl: $("#baseUrlInput"),
  apiKey: $("#apiKeyInput"),
  model: $("#modelInput"),
  modelOptions: $("#modelOptions"),
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
  stop: $("#stopButton"),
  addActor: $("#addActorButton"),
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
  toolsEnabledMirror: $("#toolsEnabledMirror"),
  // Document panel
  documentEnabled: $("#documentEnabledInput"),
  documentTitle: $("#documentTitleInput"),
  documentContent: $("#documentContent"),
  documentPreview: $("#documentPreview"),
  documentVersionCount: $("#documentVersionCount"),
  documentCopy: $("#documentCopyButton"),
  documentClear: $("#documentClearButton"),
  docEditView: $(".doc-edit-view"),
  docPreviewView: $(".doc-preview-view"),
  docViewBtns: $$(".doc-view-btn"),
  sidebarTabs: $$(".sidebar-tab"),
  sidebarPanels: $$(".sidebar-panel"),
  sidebarResizeHandle: $("#sidebarResizeHandle")
};

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

export function render() {
  renderTabs();
  renderStageHeader();
  renderActors();
  renderConversationSummary();
  renderDocument();
  renderQuickStartPreview();
  renderMemory();
  renderOutcomes();
  renderAutoStop();
  renderTranscript();
  els.auto.textContent = state.autoRunning ? "Pause" : "Auto";
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

export function switchTab(tabName) {
  if (!VALID_TABS.includes(tabName)) return;

  const update = () => {
    state.ui.activeTab = tabName;
    saveState();
    renderTabs();
    renderMemory();
    renderAutoStop();
  };

  if (document.startViewTransition) {
    document.startViewTransition(update);
  } else {
    update();
  }
}

export function renderTabs() {
  const activeTab = VALID_TABS.includes(state.ui.activeTab) ? state.ui.activeTab : "setup";
  els.tabButtons.forEach((button) => {
    const isActive = button.dataset.tab === activeTab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.tabIndex = 0;
  });
  els.mobileNavBtns.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === activeTab);
  });
  els.tabPanels.forEach((panel) => {
    const isActive = panel.dataset.tabPanel === activeTab;
    panel.hidden = !isActive;
  });
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
}

export function renderConversationSummary() {
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
  // Only update textarea if it's not focused (user might be typing)
  if (document.activeElement !== els.documentContent) {
    els.documentContent.value = state.document.content || "";
  }
  // Render markdown preview
  if (els.documentPreview) {
    els.documentPreview.innerHTML = renderMarkdown(state.document.content || "");
  }
  const vCount = state.document.versions?.length || 0;
  els.documentVersionCount.textContent = `${vCount} version${vCount !== 1 ? "s" : ""}`;
}

export function switchDocView(viewName) {
  if (els.docEditView) els.docEditView.style.display = viewName === "edit" ? "" : "none";
  if (els.docPreviewView) els.docPreviewView.style.display = viewName === "preview" ? "" : "none";
  els.docViewBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.docView === viewName);
  });
  // Sync textarea when switching to edit
  if (viewName === "edit") {
    els.documentContent.value = state.document.content || "";
    els.documentContent.focus();
  }
  // Sync preview when switching back
  if (viewName === "preview" && els.documentPreview) {
    els.documentPreview.innerHTML = renderMarkdown(state.document.content || "");
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
  const memory = quickStartPreviewSection("Memory Seed", [
    draft.memory.pinnedFacts ? `Pinned: ${draft.memory.pinnedFacts}` : "No pinned facts.",
    draft.memory.sharedSummary ? `Summary: ${draft.memory.sharedSummary}` : "No summary seed.",
    draft.memory.openQuestions ? `Questions: ${draft.memory.openQuestions}` : "No open questions.",
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
  els.pinnedFacts.value = safeString(state.memory.pinnedFacts);
  els.sharedSummary.value = safeString(state.memory.sharedSummary);
  els.openQuestions.value = safeString(state.memory.openQuestions);
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
    label.innerHTML = `<input class="pending-fact-check" type="checkbox" checked data-index="${index}"><span></span>`;
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
    $(".actor-swatch", node).style.background = actor.color;
    $(".actor-name-display", node).textContent = actor.name || `Actor ${index + 1}`;
    $(".role-badge", node).textContent = actor.role || "Participant";
    $(".actor-name", node).value = actor.name;
    $(".actor-role", node).value = actor.role;
    $(".actor-persona", node).value = actor.persona;
    $(".actor-goal", node).value = actor.goal;
    $(".actor-voice", node).value = actor.voice;
    $(".actor-thoughts", node).value = safeString(actor.thoughts);

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
      actor.name = $(".actor-name", node).value.trim() || `Actor ${index + 1}`;
      actor.role = $(".actor-role", node).value.trim();
      actor.persona = $(".actor-persona", node).value.trim();
      actor.goal = $(".actor-goal", node).value.trim();
      actor.voice = $(".actor-voice", node).value.trim();
      actor.thoughts = $(".actor-thoughts", node).value.trim();
      // Sync display elements
      $(".actor-name-display", node).textContent = actor.name;
      $(".role-badge", node).textContent = actor.role || "Participant";
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
  els.transcript.innerHTML = "";

  if (!state.messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<div><strong>No turns yet</strong><span>Waiting for the opening move.</span></div>";
    els.transcript.append(empty);
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

    // Thought block — always show as collapsible <details> when there's a thought.
    // showThoughts setting controls whether it renders auto-expanded (open attr).
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
      toolCallsEl.innerHTML = toolCalls.map((tc) => {
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

    els.transcript.append(node);
  });
  els.transcript.scrollTop = els.transcript.scrollHeight;
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
  els.quickStartStatus.textContent = state.ui.quickStartStatus;
  els.memoryEnabled.checked = state.memory.enabled;
  els.pinnedFacts.value = state.memory.pinnedFacts;
  els.sharedSummary.value = state.memory.sharedSummary;
  els.openQuestions.value = state.memory.openQuestions;
  els.dmState.value = state.memory.dmState;
  els.outcomeRecommendation.value = state.outcomes.finalRecommendation;
  els.outcomeDecisions.value = state.outcomes.decisions;
  els.outcomeRationale.value = state.outcomes.rationale;
  els.outcomeRejected.value = state.outcomes.rejectedOptions;
  els.outcomeActions.value = state.outcomes.actionItems;
  els.outcomeRisks.value = state.outcomes.risks;
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
  if (els.toolsEnabledMirror) els.toolsEnabledMirror.checked = state.settings.toolsEnabled;
  renderModePills();
  renderTemperatureDisplay();
  document.documentElement.dataset.theme = state.settings.theme || "dark";
}

export function readSettingsFromForm() {
  state.settings.baseUrl = els.baseUrl.value.trim() || defaultState.settings.baseUrl;
  state.settings.apiKey = els.apiKey.value.trim() || "lm-studio";
  state.settings.model = els.model.value.trim();
  state.settings.temperature = Number(els.temperature.value || defaultState.settings.temperature);
  state.scenario.mode = els.mode.value;
  state.scenario.title = els.title.value.trim() || "Untitled forum";
  state.scenario.premise = els.premise.value.trim();
  state.scenario.objective = els.objective.value.trim();
  state.dm.enabled = els.dmEnabled.checked;
  state.dm.name = els.dmName.value.trim() || "Director";
  state.dm.persona = els.dmPersona.value.trim();
  state.dm.seesPrivateThoughts = els.dmPrivate.checked;
  state.ui.quickStartPrompt = els.quickStartPrompt.value.trim();
  readMemoryFromForm();
  readOutcomesFromForm();
  readAutoStopFromForm();
  state.settings.showThoughts = els.showThoughts.checked;
  state.settings.toolsEnabled = els.toolsEnabled.checked;
  // Keep mirrors in sync
  if (els.showThoughtsMirror) els.showThoughtsMirror.checked = state.settings.showThoughts;
  if (els.toolsEnabledMirror) els.toolsEnabledMirror.checked = state.settings.toolsEnabled;
  saveState();
  renderStageHeader();
}

export function readMemoryFromForm() {
  state.memory.enabled = els.memoryEnabled.checked;
  state.memory.pinnedFacts = els.pinnedFacts.value.trim();
  // Don't overwrite AI-managed fields while a background summarize is running
  if (!state.memory.isSummarizing) {
    state.memory.sharedSummary = els.sharedSummary.value.trim();
    state.memory.openQuestions = els.openQuestions.value.trim();
    state.memory.dmState = els.dmState.value.trim();
  }
}

export function readOutcomesFromForm() {
  state.outcomes.finalRecommendation = els.outcomeRecommendation.value.trim();
  state.outcomes.decisions = els.outcomeDecisions.value.trim();
  state.outcomes.rationale = els.outcomeRationale.value.trim();
  state.outcomes.rejectedOptions = els.outcomeRejected.value.trim();
  state.outcomes.actionItems = els.outcomeActions.value.trim();
  state.outcomes.risks = els.outcomeRisks.value.trim();
}

export function readAutoStopFromForm() {
  state.autoStop.enabled = els.autoStopEnabled.checked;
  state.autoStop.goal = els.autoGoal.value.trim();
  state.autoStop.goalCheckEnabled = els.goalCheckEnabled.checked;
  state.autoStop.stopOnAllSkip = els.stopOnAllSkip.checked;
  state.autoStop.maxRoundsEnabled = els.maxRoundsEnabled.checked;
  state.autoStop.maxRounds = Math.min(50, Math.max(1, Number(els.maxRounds.value || defaultState.autoStop.maxRounds)));
}
