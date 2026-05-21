const STORAGE_KEY = "forum-state-v1";
const PRESET_VERSION = 1;
const DB_NAME = "forum-memory";
const DB_VERSION = 2;
const MESSAGE_STORE = "messages";
const CHUNK_STORE = "chunks";
const RECENT_MESSAGE_LIMIT = 80;
const PROMPT_MESSAGE_LIMIT = 12;
const RECALLED_CHUNK_LIMIT = 6;
const WORD_LIMITS = {
  sharedSummary: 520,
  openQuestions: 260,
  dmState: 320,
  actorMemory: 260,
  chunk: 180,
  recentTranscript: 2600
};
const VALID_TABS = ["setup", "conversation", "memory"];

const colors = ["#18726d", "#b84738", "#a2611a", "#355f9f", "#6e4c99", "#4f7d2d", "#9a4668"];

const AVAILABLE_TOOLS = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for current information. Use when you need facts, news, documentation, or data you don't have.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_webpage",
      description: "Fetch and read the text content of a specific URL. Use to read articles, documentation, or other web content.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to read" }
        },
        required: ["url"]
      }
    }
  }
];
const MAX_TOOL_ROUNDS = 3;

const defaultState = {
  settings: {
    baseUrl: "http://127.0.0.1:1234",
    apiKey: "lm-studio",
    model: "",
    temperature: 0.8,
    maxTokens: 700,
    showThoughts: true,
    toolsEnabled: true,
    theme: "light"
  },
  ui: {
    activeTab: "",
    quickStartPrompt: "",
    quickStartDraft: null,
    quickStartStatus: "No generated setup yet."
  },
  memory: {
    enabled: true,
    pinnedFacts: "",
    sharedSummary: "",
    openQuestions: "",
    dmState: "",
    pendingPinnedFacts: [],
    turnsSinceSummary: 0,
    lastSummaryMessageId: "",
    migratedLegacyMessages: false,
    archivedCount: 0,
    isSummarizing: false
  },
  outcomes: {
    finalRecommendation: "",
    decisions: "",
    rationale: "",
    rejectedOptions: "",
    actionItems: "",
    risks: "",
    lastExtractedAt: "",
    lastExtractMessageId: "",
    status: "No outcomes extracted yet."
  },
  autoStop: {
    enabled: true,
    goal: "",
    goalCheckEnabled: true,
    stopOnAllSkip: true,
    maxRoundsEnabled: false,
    maxRounds: 5,
    roundsRun: 0,
    status: "Auto-stop ready."
  },
  scenario: {
    mode: "problem",
    title: "Design council",
    premise: "A small group of local AI actors are gathered to discuss the user's topic.",
    objective: "Ask clarifying questions, challenge weak assumptions, and converge on practical next steps."
  },
  dm: {
    enabled: true,
    name: "Director",
    persona: "Keep the scene moving, summarize when useful, and invite quieter actors in without taking over.",
    seesPrivateThoughts: false,
    thoughts: ""
  },
  actors: [
    {
      id: crypto.randomUUID(),
      name: "Architect",
      role: "Systems thinker",
      persona: "You care about structure, tradeoffs, and how pieces fit together.",
      goal: "Turn messy ideas into a workable plan.",
      voice: "Calm, precise, concise.",
      thoughts: "",
      enabled: true,
      color: colors[0]
    },
    {
      id: crypto.randomUUID(),
      name: "Skeptic",
      role: "Risk spotter",
      persona: "You notice gaps, ambiguity, and hidden costs.",
      goal: "Prevent the group from accepting easy answers too quickly.",
      voice: "Direct but constructive.",
      thoughts: "",
      enabled: true,
      color: colors[1]
    },
    {
      id: crypto.randomUUID(),
      name: "Muse",
      role: "Creative spark",
      persona: "You look for surprising angles and emotionally resonant choices.",
      goal: "Add imaginative options that are still usable.",
      voice: "Warm, vivid, specific.",
      thoughts: "",
      enabled: true,
      color: colors[2]
    }
  ],
  messages: [],
  turnQueue: [],
  autoRunning: false
};

let state = loadState();
let abortController = null;
let isGenerating = false;
let db = null;
let storageAvailable = false;
let storageWarning = "";
let fallbackMessages = [];
let fallbackChunks = [];
let isInitialized = false;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const els = {
  tabButtons: $$("[data-tab]"),
  tabPanels: $$("[data-tab-panel]"),
  tabJumps: $$("[data-tab-jump]"),
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
  themeToggle: $("#themeToggle")
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved) return structuredClone(defaultState);
    return normalizeState(saved);
  } catch {
    return structuredClone(defaultState);
  }
}

function normalizeState(value) {
  const merged = {
    ...structuredClone(defaultState),
    ...value,
    settings: { ...defaultState.settings, ...value.settings },
    ui: { ...defaultState.ui, ...value.ui },
    memory: { ...defaultState.memory, ...value.memory },
    outcomes: { ...defaultState.outcomes, ...value.outcomes },
    autoStop: { ...defaultState.autoStop, ...value.autoStop },
    scenario: { ...defaultState.scenario, ...value.scenario },
    dm: { ...defaultState.dm, ...value.dm },
    actors: Array.isArray(value.actors) && value.actors.length ? value.actors : structuredClone(defaultState.actors),
    messages: Array.isArray(value.messages) ? value.messages.map(cleanStoredMessage) : [],
    turnQueue: Array.isArray(value.turnQueue) ? value.turnQueue : []
  };
  merged.memory.isSummarizing = false;
  if (!value.settings?.baseUrl || value.settings.baseUrl === "http://localhost:1234/v1") {
    merged.settings.baseUrl = defaultState.settings.baseUrl;
  }
  if (!VALID_TABS.includes(merged.ui.activeTab)) {
    merged.ui.activeTab = "";
  }
  if (merged.ui.quickStartDraft) {
    merged.ui.quickStartDraft = normalizeQuickStartConfig(merged.ui.quickStartDraft, false);
  }
  if (!Array.isArray(merged.memory.pendingPinnedFacts)) {
    merged.memory.pendingPinnedFacts = [];
  }
  merged.memory.archivedCount = Number(merged.memory.archivedCount || 0);
  merged.memory.turnsSinceSummary = Number(merged.memory.turnsSinceSummary || 0);
  merged.autoStop.maxRounds = Math.min(50, Math.max(1, Number(merged.autoStop.maxRounds || defaultState.autoStop.maxRounds)));
  merged.autoStop.roundsRun = Math.max(0, Number(merged.autoStop.roundsRun || 0));
  merged.actors = merged.actors.map((actor, index) => ({
    id: actor.id || crypto.randomUUID(),
    name: actor.name || `Actor ${index + 1}`,
    role: actor.role || "Participant",
    persona: actor.persona || "",
    goal: actor.goal || "",
    voice: actor.voice || "",
    thoughts: actor.thoughts || "",
    enabled: actor.enabled !== false,
    color: actor.color || colors[index % colors.length]
  }));
  return merged;
}

function saveState() {
  const { messages, autoRunning, ...persisted } = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...persisted, messages: [] }));
}

async function initializeMemoryStorage() {
  const legacyMessages = state.messages.map(cleanStoredMessage);
  try {
    db = await openMemoryDb();
    storageAvailable = true;
    if (legacyMessages.length && !state.memory.migratedLegacyMessages) {
      await putMessages(legacyMessages);
      state.memory.migratedLegacyMessages = true;
    }
    state.messages = await getRecentMessages(RECENT_MESSAGE_LIMIT);
    state.memory.archivedCount = await countChunks();
  } catch (error) {
    storageAvailable = false;
    storageWarning = "IndexedDB unavailable; history will not survive reload.";
    fallbackMessages = legacyMessages;
    state.messages = fallbackMessages.slice(-RECENT_MESSAGE_LIMIT);
    console.warn(error);
  }
  if (!state.ui.activeTab) {
    state.ui.activeTab = state.messages.length ? "conversation" : "setup";
  }
  saveState();
}

function openMemoryDb() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.warn("IndexedDB open timed out (blocked by another tab?). Continuing without DB.");
      reject(new Error("IndexedDB open timed out."));
    }, 4000);
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(MESSAGE_STORE)) {
        const messages = database.createObjectStore(MESSAGE_STORE, { keyPath: "id" });
        messages.createIndex("createdAt", "createdAt");
      }
      if (!database.objectStoreNames.contains(CHUNK_STORE)) {
        const chunks = database.createObjectStore(CHUNK_STORE, { keyPath: "id" });
        chunks.createIndex("createdAt", "createdAt");
      }
    });
    request.addEventListener("blocked", () => {
      console.warn("IndexedDB upgrade blocked by another tab. Close other Forum tabs and reload.");
    });
    request.addEventListener("success", () => { clearTimeout(timeout); resolve(request.result); });
    request.addEventListener("error", () => { clearTimeout(timeout); reject(request.error || new Error("IndexedDB failed to open.")); });
  });
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error || new Error("IndexedDB request failed.")));
  });
}

function idbDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", resolve);
    transaction.addEventListener("abort", () => reject(transaction.error || new Error("IndexedDB transaction aborted.")));
    transaction.addEventListener("error", () => reject(transaction.error || new Error("IndexedDB transaction failed.")));
  });
}

async function putMessage(message) {
  if (!storageAvailable || !db) {
    fallbackMessages.push(message);
    return;
  }
  const transaction = db.transaction(MESSAGE_STORE, "readwrite");
  transaction.objectStore(MESSAGE_STORE).put(message);
  await idbDone(transaction);
}

async function putMessages(messages) {
  if (!storageAvailable || !db) {
    fallbackMessages.push(...messages);
    return;
  }
  const transaction = db.transaction(MESSAGE_STORE, "readwrite");
  const store = transaction.objectStore(MESSAGE_STORE);
  messages.forEach((message) => store.put(message));
  await idbDone(transaction);
}

async function getAllMessages() {
  if (!storageAvailable || !db) return [...fallbackMessages].sort(byCreatedAt);
  const transaction = db.transaction(MESSAGE_STORE, "readonly");
  const messages = await idbRequest(transaction.objectStore(MESSAGE_STORE).getAll());
  return messages.map(cleanStoredMessage).sort(byCreatedAt);
}

async function getRecentMessages(limit) {
  const messages = await getAllMessages();
  return messages.slice(-limit);
}

async function clearMessages() {
  fallbackMessages = [];
  if (!storageAvailable || !db) return;
  const transaction = db.transaction(MESSAGE_STORE, "readwrite");
  transaction.objectStore(MESSAGE_STORE).clear();
  await idbDone(transaction);
}

async function putChunk(chunk) {
  if (!storageAvailable || !db) {
    fallbackChunks.push(chunk);
    state.memory.archivedCount = fallbackChunks.length;
    return;
  }
  const transaction = db.transaction(CHUNK_STORE, "readwrite");
  transaction.objectStore(CHUNK_STORE).put(chunk);
  await idbDone(transaction);
  state.memory.archivedCount = await countChunks();
}

async function getAllChunks() {
  if (!storageAvailable || !db) return [...fallbackChunks].sort(byCreatedAt);
  const transaction = db.transaction(CHUNK_STORE, "readonly");
  const chunks = await idbRequest(transaction.objectStore(CHUNK_STORE).getAll());
  return chunks.sort(byCreatedAt);
}

async function countChunks() {
  if (!storageAvailable || !db) return fallbackChunks.length;
  const transaction = db.transaction(CHUNK_STORE, "readonly");
  return idbRequest(transaction.objectStore(CHUNK_STORE).count());
}

async function clearChunks() {
  fallbackChunks = [];
  state.memory.archivedCount = 0;
  if (!storageAvailable || !db) return;
  const transaction = db.transaction(CHUNK_STORE, "readwrite");
  transaction.objectStore(CHUNK_STORE).clear();
  await idbDone(transaction);
}

function byCreatedAt(left, right) {
  return new Date(left.createdAt || 0) - new Date(right.createdAt || 0);
}

function setBusy(value) {
  isGenerating = value;
  document.body.classList.toggle("is-busy", value);
  els.nextTurn.disabled = value;
  els.round.disabled = value;
  els.auto.disabled = value && !state.autoRunning;
  els.stop.disabled = !value && !state.autoRunning;
  els.userInput.disabled = value;
}

function syncFormFromState() {
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
  els.autoStopStatus.textContent = state.autoStop.status;
  els.showThoughts.checked = state.settings.showThoughts;
  els.toolsEnabled.checked = state.settings.toolsEnabled;
  document.documentElement.dataset.theme = state.settings.theme;
  render();
}

function readSettingsFromForm() {
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
  saveState();
  renderStageHeader();
}

function readMemoryFromForm() {
  state.memory.enabled = els.memoryEnabled.checked;
  state.memory.pinnedFacts = els.pinnedFacts.value.trim();
  // Don't overwrite AI-managed fields while a background summarize is running
  if (!state.memory.isSummarizing) {
    state.memory.sharedSummary = els.sharedSummary.value.trim();
    state.memory.openQuestions = els.openQuestions.value.trim();
    state.memory.dmState = els.dmState.value.trim();
  }
}

function readOutcomesFromForm() {
  state.outcomes.finalRecommendation = els.outcomeRecommendation.value.trim();
  state.outcomes.decisions = els.outcomeDecisions.value.trim();
  state.outcomes.rationale = els.outcomeRationale.value.trim();
  state.outcomes.rejectedOptions = els.outcomeRejected.value.trim();
  state.outcomes.actionItems = els.outcomeActions.value.trim();
  state.outcomes.risks = els.outcomeRisks.value.trim();
}

function readAutoStopFromForm() {
  state.autoStop.enabled = els.autoStopEnabled.checked;
  state.autoStop.goal = els.autoGoal.value.trim();
  state.autoStop.goalCheckEnabled = els.goalCheckEnabled.checked;
  state.autoStop.stopOnAllSkip = els.stopOnAllSkip.checked;
  state.autoStop.maxRoundsEnabled = els.maxRoundsEnabled.checked;
  state.autoStop.maxRounds = Math.min(50, Math.max(1, Number(els.maxRounds.value || defaultState.autoStop.maxRounds)));
}

function render() {
  renderTabs();
  renderStageHeader();
  renderActors();
  renderConversationSummary();
  renderQuickStartPreview();
  renderMemory();
  renderOutcomes();
  renderAutoStop();
  renderTranscript();
  els.auto.textContent = state.autoRunning ? "Pause" : "Auto";
}

function renderOutcomes() {
  els.outcomeRecommendation.value = state.outcomes.finalRecommendation;
  els.outcomeDecisions.value = state.outcomes.decisions;
  els.outcomeRationale.value = state.outcomes.rationale;
  els.outcomeRejected.value = state.outcomes.rejectedOptions;
  els.outcomeActions.value = state.outcomes.actionItems;
  els.outcomeRisks.value = state.outcomes.risks;
  els.outcomeStatus.textContent = state.outcomes.status || "No outcomes extracted yet.";
}

function renderAutoStop() {
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

function switchTab(tabName) {
  if (!VALID_TABS.includes(tabName)) return;
  state.ui.activeTab = tabName;
  saveState();
  renderTabs();
  renderMemory();
  renderAutoStop();
}

function renderTabs() {
  const activeTab = VALID_TABS.includes(state.ui.activeTab) ? state.ui.activeTab : "setup";
  els.tabButtons.forEach((button) => {
    const isActive = button.dataset.tab === activeTab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.tabIndex = 0;
  });
  els.tabPanels.forEach((panel) => {
    const isActive = panel.dataset.tabPanel === activeTab;
    panel.hidden = !isActive;
  });
}

function renderConversationSummary() {
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

function summaryLine(label, value) {
  const row = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = `${label}: `;
  const span = document.createElement("span");
  span.textContent = value;
  row.append(strong, span);
  return row;
}

function renderQuickStartPreview() {
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

function quickStartPreviewSection(title, lines) {
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

function renderMemory() {
  els.memoryEnabled.checked = state.memory.enabled;
  els.pinnedFacts.value = state.memory.pinnedFacts;
  els.sharedSummary.value = state.memory.sharedSummary;
  els.openQuestions.value = state.memory.openQuestions;
  els.dmState.value = state.memory.dmState;
  renderPendingFacts();
  const storageText = storageAvailable ? "IndexedDB" : "in-memory";
  const warning = storageWarning ? ` ${storageWarning}` : "";
  els.memoryStatus.textContent = `${storageText} memory. ${state.memory.archivedCount} archived chunk${state.memory.archivedCount === 1 ? "" : "s"}.${warning}`;
}

function renderPendingFacts() {
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

function renderStageHeader() {
  els.modeLabel.textContent = labelForMode(state.scenario.mode);
  els.stageTitle.textContent = state.scenario.title || "Untitled forum";
}

function labelForMode(mode) {
  if (mode === "story") return "Story";
  if (mode === "freeform") return "Freeform";
  return "Problem";
}

function renderActors() {
  const template = $("#actorTemplate");
  els.actorList.innerHTML = "";
  state.actors.forEach((actor, index) => {
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.actorId = actor.id;
    $(".actor-enabled", node).checked = actor.enabled;
    $(".actor-swatch", node).style.background = actor.color;
    $(".actor-name", node).value = actor.name;
    $(".actor-role", node).value = actor.role;
    $(".actor-persona", node).value = actor.persona;
    $(".actor-goal", node).value = actor.goal;
    $(".actor-voice", node).value = actor.voice;
    $(".actor-thoughts", node).value = actor.thoughts;
    $(".remove-actor", node).disabled = state.actors.length <= 1;

    node.addEventListener("input", () => {
      actor.enabled = $(".actor-enabled", node).checked;
      actor.name = $(".actor-name", node).value.trim() || `Actor ${index + 1}`;
      actor.role = $(".actor-role", node).value.trim();
      actor.persona = $(".actor-persona", node).value.trim();
      actor.goal = $(".actor-goal", node).value.trim();
      actor.voice = $(".actor-voice", node).value.trim();
      actor.thoughts = $(".actor-thoughts", node).value.trim();
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

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

function formatMessageHtml(text, color) {
  const escaped = escapeHtml(text);
  const styleAttr = color ? `style="--rp-color: ${color};"` : "";
  let formatted = escaped.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  formatted = formatted.replace(/\*([^*\n"]+?)\*/g, `<span class="rp-action" ${styleAttr}>$1</span>`);
  return formatted;
}

function renderTranscript() {
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
    node.classList.add(message.type || "actor");
    $(".speaker-dot", node).style.background = message.color || actor?.color || colorForType(message.type);
    $(".message-meta strong", node).textContent = speaker;
    $(".message-time", node).textContent = formatTime(message.createdAt);
    $(".message-content", node).innerHTML = formatMessageHtml(publicMessageContent(message), message.color || actor?.color);

    const thoughtBlock = $(".thought-block", node);
    if (message.thought && state.settings.showThoughts) {
      $("p", thoughtBlock).textContent = message.thought;
      thoughtBlock.hidden = false;
    } else {
      thoughtBlock.hidden = true;
    }

    els.transcript.append(node);
  });
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

function colorForType(type) {
  if (type === "user") return "var(--blue)";
  if (type === "dm") return "var(--gold)";
  if (type === "skip") return "var(--muted)";
  return "var(--accent)";
}

function formatTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

async function addMessage(message) {
  const storedMessage = cleanStoredMessage({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...message
  });
  state.messages.push(storedMessage);
  state.messages = state.messages.slice(-RECENT_MESSAGE_LIMIT);
  await putMessage(storedMessage);
  saveState();
  renderTranscript();
  return storedMessage;
}

function buildTurnQueue() {
  const enabledIds = state.actors.filter((actor) => actor.enabled).map((actor) => actor.id);
  const queue = [...enabledIds];
  if (state.dm.enabled) queue.push("dm");
  state.turnQueue = queue;
  return queue;
}

function nextParticipant() {
  const enabled = new Set(state.actors.filter((actor) => actor.enabled).map((actor) => actor.id));
  state.turnQueue = state.turnQueue.filter((id) => id === "dm" ? state.dm.enabled : enabled.has(id));
  if (!state.turnQueue.length) buildTurnQueue();
  const id = state.turnQueue.shift();
  if (!id) return null;
  state.turnQueue.push(id);
  if (id === "dm") return { kind: "dm", data: state.dm };
  const actor = state.actors.find((item) => item.id === id);
  return actor ? { kind: "actor", data: actor } : null;
}

async function runNextTurn(options = {}) {
  readSettingsFromForm();
  if (!state.settings.model) {
    setStatus("Choose or type a model first.", "warn");
    return false;
  }

  const participant = nextParticipant();
  if (!participant) {
    setStatus("Add at least one enabled actor or turn on the DM.", "warn");
    return false;
  }

  setBusy(true);
  abortController = new AbortController();

  try {
    const result = participant.kind === "dm"
      ? await askDirector(participant.data, abortController.signal)
      : await askActor(participant.data, abortController.signal);
    await applyAiResult(participant, result);
    if (state.memory.enabled && options.summarizeCycle !== false) {
      state.memory.turnsSinceSummary += 1;
      const cycleSize = participantCycleCount();
      if (state.memory.turnsSinceSummary >= cycleSize) {
        summarizeMemory("cycle");
      }
    }
    setStatus(`Last turn: ${participant.data.name}`, "ok");
    return true;
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus("Generation stopped.", "warn");
    } else {
      setStatus(error.message || "Generation failed.", "error");
      await addMessage({
        type: "system",
        speaker: "System",
        content: error.message || "Generation failed.",
        color: "var(--coral)"
      });
    }
    return false;
  } finally {
    abortController = null;
    setBusy(false);
  }
}

async function runRound(options = {}) {
  readSettingsFromForm();
  const count = state.actors.filter((actor) => actor.enabled).length + (state.dm.enabled ? 1 : 0);
  if (!count) {
    setStatus("Add at least one enabled actor or turn on the DM.", "warn");
    return false;
  }
  const startIndex = state.messages.length;
  let completedTurns = 0;
  for (let index = 0; index < count; index += 1) {
    if (abortController?.signal.aborted) break;
    const ok = await runNextTurn({ summarizeCycle: false });
    if (!ok) break;
    completedTurns += 1;
  }
  const roundMessages = state.messages.slice(startIndex);
  if (roundMessages.length && state.memory.enabled) {
    state.memory.turnsSinceSummary = 0;
    summarizeMemory("round", roundMessages);
  }
  if (roundMessages.length) {
    const shouldStop = await evaluateAutoStopAfterRound(roundMessages, options);
    if (shouldStop) return false;
  }
  return completedTurns === count;
}

function participantCycleCount() {
  return Math.max(1, state.actors.filter((actor) => actor.enabled).length + (state.dm.enabled ? 1 : 0));
}

async function runAutoLoop() {
  const starting = !state.autoRunning;
  state.autoRunning = starting;
  if (starting) {
    state.autoStop.roundsRun = 0;
    setAutoStopStatus("Auto running.");
  } else {
    setAutoStopStatus("Auto paused.");
  }
  render();
  while (state.autoRunning) {
    const ok = await runRound({ fromAuto: true });
    if (!ok) {
      state.autoRunning = false;
      break;
    }
    await wait(450);
  }
  render();
}

function stopGeneration() {
  state.autoRunning = false;
  abortController?.abort();
  setAutoStopStatus("Auto paused.");
  render();
}

async function evaluateAutoStopAfterRound(roundMessages, options = {}) {
  readAutoStopFromForm();
  if (!state.autoStop.enabled) {
    saveState();
    return false;
  }

  state.autoStop.roundsRun += 1;

  if (state.autoStop.stopOnAllSkip && roundMessages.length && roundMessages.every((message) => message.type === "skip")) {
    return promptStopOrContinue("Everyone skipped this round. The forum may be out of useful things to add.", options);
  }

  if (state.autoStop.maxRoundsEnabled && state.autoStop.roundsRun >= state.autoStop.maxRounds) {
    return promptStopOrContinue(`Reached the ${state.autoStop.maxRounds}-round limit.`, options);
  }

  if (state.autoStop.goalCheckEnabled && state.autoStop.goal.trim()) {
    const verdict = await judgeGoal(roundMessages);
    if (verdict.achieved) {
      const confidence = Number.isFinite(verdict.confidence) ? ` (${Math.round(verdict.confidence * 100)}% confidence)` : "";
      return promptStopOrContinue(`Goal looks achieved${confidence}: ${verdict.reason || "The group appears to have satisfied the goal."}`, {
        ...options,
        suggestedGoal: verdict.nextGoalSuggestion
      });
    }
    setAutoStopStatus(`Goal not complete yet: ${verdict.reason || "Needs more discussion."}`);
  } else {
    setAutoStopStatus(`Round ${state.autoStop.roundsRun} complete. Auto-stop is watching for skips and limits.`);
  }

  saveState();
  renderAutoStop();
  return false;
}

async function judgeGoal(roundMessages = [], options = {}) {
  readSettingsFromForm();
  if (!state.autoStop.goal.trim()) {
    setAutoStopStatus("Add a goal before checking.");
    return { achieved: false, confidence: 0, reason: "No goal set.", nextGoalSuggestion: "" };
  }
  if (!state.settings.model) {
    setAutoStopStatus("Choose or type a model before checking the goal.");
    return { achieved: false, confidence: 0, reason: "No model selected.", nextGoalSuggestion: "" };
  }

  const alreadyBusy = isGenerating;
  setBusy(true);
  setAutoStopStatus("Checking goal...");

  const chunks = await getAllChunks();
  const archiveText = chunks.slice(-6).map((chunk) => `- ${chunk.text}`).join("\n");
  const system = [
    "You judge whether a multi-actor AI forum has achieved a user-defined goal.",
    "Be conservative: mark achieved only when the transcript contains a concrete answer, decision, deliverable, or next-step plan matching the goal.",
    "Do not require perfect consensus, but do require enough substance that stopping would be reasonable.",
    "Return only valid JSON with this exact shape:",
    "{\"achieved\":false,\"confidence\":0.0,\"reason\":\"short reason\",\"nextGoalSuggestion\":\"optional next goal\"}"
  ].join("\n");
  const user = [
    `Goal:\n${state.autoStop.goal}`,
    scenarioBlock(),
    `Pinned facts:\n${state.memory.pinnedFacts || "None."}`,
    `Shared memory summary:\n${state.memory.sharedSummary || "None."}`,
    `Open questions:\n${state.memory.openQuestions || "None."}`,
    `Known outcomes:\n${formatCurrentOutcomes()}`,
    `Recent transcript:\n${formatTranscript(state.messages.slice(-24), 2200)}`,
    `Latest round:\n${formatTranscript(roundMessages, 900)}`,
    `Recent archive summaries:\n${archiveText || "None."}`
  ].join("\n\n");

  try {
    const content = await chatCompletion(system, user, { temperature: 0.1, maxTokens: 500 });
    const parsed = parseOutcomeJson(content);
    const verdict = normalizeGoalVerdict(parsed);
    if (options.manual) {
      if (verdict.achieved) {
        await promptStopOrContinue(`Goal looks achieved: ${verdict.reason || "The group appears to have satisfied the goal."}`, {
          fromAuto: false,
          suggestedGoal: verdict.nextGoalSuggestion
        });
      } else {
        setAutoStopStatus(`Goal not complete yet: ${verdict.reason || "Needs more discussion."}`);
      }
    }
    return verdict;
  } catch (error) {
    const message = error.message || "Goal check failed.";
    setAutoStopStatus(message);
    return { achieved: false, confidence: 0, reason: message, nextGoalSuggestion: "" };
  } finally {
    if (!alreadyBusy) setBusy(false);
  }
}

function normalizeGoalVerdict(value) {
  const achievedValue = value?.achieved;
  const achieved = achievedValue === true || String(achievedValue).toLowerCase() === "true" || String(achievedValue).toLowerCase() === "yes";
  const confidence = Math.min(1, Math.max(0, Number(value?.confidence || 0)));
  return {
    achieved,
    confidence,
    reason: trimWords(stringifyList(value?.reason), 80),
    nextGoalSuggestion: trimWords(stringifyList(value?.nextGoalSuggestion), 80)
  };
}

async function promptStopOrContinue(reason, options = {}) {
  state.autoRunning = false;
  setAutoStopStatus(reason);
  render();

  const shouldStop = window.confirm(`${reason}\n\nOK = stop here.\nCancel = enter a new goal and continue.`);
  if (shouldStop) {
    state.autoStop.roundsRun = 0;
    setAutoStopStatus(`Stopped: ${reason}`);
    saveState();
    render();
    return true;
  }

  const suggested = options.suggestedGoal || "";
  const newGoal = window.prompt("New goal to continue toward:", suggested);
  if (newGoal && newGoal.trim()) {
    state.autoStop.goal = newGoal.trim();
    state.autoStop.roundsRun = 0;
    setAutoStopStatus(options.fromAuto ? "New goal saved. Continuing Auto." : "New goal saved. Press Auto to continue.");
    if (options.fromAuto) state.autoRunning = true;
    saveState();
    render();
    return false;
  }

  state.autoStop.roundsRun = 0;
  setAutoStopStatus("Auto paused. No new goal was set.");
  saveState();
  render();
  return true;
}

function setAutoStopStatus(message) {
  state.autoStop.status = message;
  if (els.autoStopStatus) els.autoStopStatus.textContent = message;
  saveState();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function askActor(actor, signal) {
  const isStoryMode = state.scenario.mode === "story" || state.scenario.mode === "freeform";
  const contextLine = isStoryMode
    ? [
        "You are a character in an interactive roleplay/story.",
        "Stay in character at all times.",
        "IMPORTANT: The \"thought\" field is your PRIVATE out-of-character reasoning (strategy, analysis, what you notice). The \"message\" field is ONLY what you say and do IN CHARACTER. Never put analysis or meta-commentary in message.",
        "In your message, you MUST include physical actions wrapped in asterisks alongside your spoken dialogue. Show what your character physically does—gestures, expressions, movements, interactions with objects and the environment.",
        "Example of a good message: *peers through the undergrowth, gripping the strap of his pack* \"I don't like the look of that ravine.\" *takes a cautious step back, scanning the treeline*",
        state.dm.enabled
          ? "The Director (prefixed with [DIRECTOR] in the transcript) narrates the scene, settings, and consequences. Read the Director's narration carefully and react to it. Do not confuse the Director's words with other characters' speech."
          : ""
      ].filter(Boolean).join("\n")
    : "You are one participant in a local AI forum. You can read the public transcript, but not other actors' private thoughts. You can optionally describe actions with asterisks, e.g. *nods in agreement*.";

  const system = [
    `You are ${actor.name}.`,
    actor.role ? `Role: ${actor.role}` : "",
    actor.persona ? `Persona: ${actor.persona}` : "",
    actor.goal ? `Personal goal: ${actor.goal}` : "",
    actor.voice ? `Voice: ${actor.voice}` : "",
    contextLine,
    "For every turn, think privately first, then either speak or skip.",
    "Skip when you have nothing new to add, when another actor already said your point, or when waiting would help.",
    isStoryMode
      ? "Return only valid JSON: {\"thought\":\"your PRIVATE reasoning (not shown to others)\",\"action\":\"speak or skip\",\"message\":\"*actions in asterisks* plus \\\"spoken dialogue in quotes\\\"\"}"
      : "Return only valid JSON with this exact shape: {\"thought\":\"private reasoning for your memory\",\"action\":\"speak or skip\",\"message\":\"public message, empty if skipping\"}.",
    "The JSON is transport only. Put natural public dialogue only inside message; do not make message itself JSON.",
    (!isStoryMode && state.settings.toolsEnabled)
      ? "You have access to web tools. To search the web, include [SEARCH: your query] in your message. To read a webpage, include [READ: https://example.com]. The system will execute these, return results, and let you respond again with the information. Use tools when you need current facts or data."
      : ""
  ].filter(Boolean).join("\n");

  const user = await buildPromptContext({ kind: "actor", actor });

  return chatJson(system, user, actor.temperature ?? state.settings.temperature, signal);
}

async function askDirector(dm, signal) {
  const privateThoughts = state.dm.seesPrivateThoughts ? privateThoughtDigest() : "";
  const isStoryMode = state.scenario.mode === "story" || state.scenario.mode === "freeform";
  const modeInstruction = isStoryMode
    ? "You are the narrative DM. Describe the environment, atmosphere, sounds, and consequences of the characters' actions using rich descriptive narration wrapped in asterisks. Frame scene beats, introduce complications, and advance the story. Do NOT speak for the characters—react to what they do and set the stage for their next moves."
    : "Help move the exchange forward. Surface decisions, conflicts, and next questions. Summarize when useful and invite quieter actors in without taking over.";

  const system = [
    `You are ${dm.name}, the DM/director for a local AI forum.`,
    dm.persona ? `Style: ${dm.persona}` : "",
    modeInstruction,
    "Do not dominate the forum. You may skip if the actors are already progressing.",
    "You can describe physical actions, scenery changes, or narrator actions by surrounding them with asterisks, e.g. *the wind howls in the background* or *gestures to the map*.",
    "Return only valid JSON with this exact shape: {\"thought\":\"private director note\",\"action\":\"speak or skip\",\"message\":\"public message, empty if skipping\"}.",
    "The JSON is transport only. Put natural public dialogue only inside message; do not make message itself JSON.",
    (!isStoryMode && state.settings.toolsEnabled)
      ? "You have access to web tools. To search, include [SEARCH: your query] in your message. To read a page, include [READ: url]. The system will execute these and return results for you to use."
      : ""
  ].filter(Boolean).join("\n");

  const user = await buildPromptContext({ kind: "dm", dm, privateThoughts });

  return chatJson(system, user, state.settings.temperature, signal);
}

async function buildPromptContext({ kind, actor, dm, privateThoughts = "" }) {
  const recentMessages = state.messages.slice(-PROMPT_MESSAGE_LIMIT);
  const recallChunks = state.memory.enabled ? await recallRelevantChunks(kind === "actor" ? actor : null) : [];
  const participantMemory = kind === "actor"
    ? `Your private actor memory:\n${trimWords(actor.thoughts || "Empty.", WORD_LIMITS.actorMemory)}`
    : `Your private director notes:\n${trimWords(dm.thoughts || "Empty.", WORD_LIMITS.actorMemory)}`;

  const sections = [
    scenarioBlock(),
    state.memory.enabled ? memoryBlock(recallChunks) : "",
    participantMemory,
    privateThoughts,
    `Recent public transcript, shown as plain speech only:\n${formatTranscript(recentMessages, WORD_LIMITS.recentTranscript)}`,
    kind === "actor" ? "Take your next turn now." : "Take the director turn now."
  ];

  return sections.filter(Boolean).join("\n\n");
}

function memoryBlock(recallChunks) {
  const chunkText = recallChunks.length
    ? recallChunks.map((chunk, index) => `${index + 1}. ${trimWords(chunk.text || chunk.summary || "", WORD_LIMITS.chunk)}`).join("\n")
    : "No older archived memory recalled.";
  return [
    "Long-term memory:",
    state.memory.pinnedFacts ? `Pinned facts:\n${trimWords(state.memory.pinnedFacts, WORD_LIMITS.sharedSummary)}` : "Pinned facts: none.",
    state.memory.sharedSummary ? `Shared summary:\n${trimWords(state.memory.sharedSummary, WORD_LIMITS.sharedSummary)}` : "Shared summary: none yet.",
    state.memory.openQuestions ? `Open questions:\n${trimWords(state.memory.openQuestions, WORD_LIMITS.openQuestions)}` : "Open questions: none recorded.",
    state.dm.enabled && state.memory.dmState ? `DM state:\n${trimWords(state.memory.dmState, WORD_LIMITS.dmState)}` : "",
    `Relevant archived memory:\n${chunkText}`
  ].filter(Boolean).join("\n");
}

async function getEmbedding(text) {
  readSettingsFromForm();
  if (!state.settings.model) {
    throw new Error("No model selected.");
  }
  const response = await fetch("/api/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      baseUrl: state.settings.baseUrl,
      apiKey: state.settings.apiKey,
      request: {
        model: state.settings.model,
        input: text
      }
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Embeddings request failed.");
  }
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error("Invalid embedding response format.");
  }
  return embedding;
}

function cosineSimilarity(vecA, vecB) {
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

async function recallRelevantChunks(actor) {
  const chunks = await getAllChunks();
  if (!chunks.length) return [];

  const queryText = [
    state.scenario.title,
    state.scenario.objective,
    state.scenario.premise,
    state.memory.openQuestions,
    actor?.name,
    actor?.role,
    actor?.goal,
    formatTranscript(state.messages.slice(-6), 800)
  ].filter(Boolean).join("\n");

  const queryKeywords = extractKeywords(queryText);
  const latest = chunks[chunks.length - 1];

  let queryVector = null;
  const hasVectors = chunks.some(c => Array.isArray(c.vector));
  if (hasVectors) {
    try {
      queryVector = await getEmbedding(queryText);
    } catch (err) {
      console.warn("Embeddings API not available or failed; falling back to keywords.", err);
    }
  }

  const scored = chunks.map((chunk, index) => {
    let similarity = 0;
    if (queryVector && Array.isArray(chunk.vector)) {
      similarity = cosineSimilarity(queryVector, chunk.vector);
    } else {
      const chunkKeywords = Array.isArray(chunk.keywords) ? chunk.keywords : extractKeywords(chunk.text || "");
      const overlap = chunkKeywords.filter((keyword) => queryKeywords.includes(keyword)).length;
      similarity = Math.min(1, overlap / 15);
    }
    const speakerBonus = actor && (chunk.speakers || []).includes(actor.name) ? 2 : 0;
    const recency = index / Math.max(1, chunks.length);
    return { chunk, score: similarity * 8 + speakerBonus + recency };
  }).sort((left, right) => right.score - left.score);

  const selected = [latest, ...scored.map((item) => item.chunk)]
    .filter((chunk, index, list) => chunk && list.findIndex((item) => item.id === chunk.id) === index)
    .slice(0, RECALLED_CHUNK_LIMIT);
  return selected.sort(byCreatedAt);
}

function formatTranscript(messages, wordLimit = WORD_LIMITS.recentTranscript) {
  if (!messages.length) return "No public messages yet.";
  const text = messages.map((message) => {
    const name = message.speaker || state.actors.find((actor) => actor.id === message.actorId)?.name || "Forum";
    if (message.type === "dm") {
      return `[DIRECTOR] ${name}: ${publicMessageContent(message)}`;
    }
    return `${name}: ${publicMessageContent(message)}`;
  }).join("\n");
  return trimWords(text, wordLimit);
}

async function chatJson(system, user, temperature, signal) {
  const content = await chatCompletion(system, user, {
    temperature,
    maxTokens: state.settings.maxTokens,
    signal,
    useTools: true
  });
  return parseAiJson(content);
}

async function chatCompletion(system, user, { temperature = state.settings.temperature, maxTokens = state.settings.maxTokens, signal, useTools = false } = {}) {
  const isToolMode = useTools && state.settings.toolsEnabled && state.scenario.mode !== "story";
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user }
  ];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const payload = {
      model: state.settings.model,
      messages,
      temperature,
      max_tokens: maxTokens
    };

    if (isToolMode && round < MAX_TOOL_ROUNDS) {
      payload.tools = AVAILABLE_TOOLS;
      payload.tool_choice = "auto";
    }

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseUrl: state.settings.baseUrl,
        apiKey: state.settings.apiKey,
        request: payload
      }),
      signal
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "LM Studio request failed.");
    }

    const choice = data?.choices?.[0];
    const msg = choice?.message;

    // Path A: Native tool calls (OpenAI format)
    if (msg?.tool_calls?.length) {
      console.log(`[tools] Round ${round + 1}: native tool_calls (${msg.tool_calls.length})`);
      messages.push({ role: "assistant", content: msg.content || null, tool_calls: msg.tool_calls });

      for (const call of msg.tool_calls) {
        const result = await executeToolCall(call.function?.name, call.function?.arguments, signal);
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
      continue;
    }

    const content = msg?.content || "";

    // Path B: Prompt-based tool calls (fallback for models without native support)
    if (isToolMode && round < MAX_TOOL_ROUNDS) {
      const textCalls = parseTextToolCalls(content);
      if (textCalls.length) {
        console.log(`[tools] Round ${round + 1}: text-based tool calls (${textCalls.length})`);
        let toolResults = "";
        for (const tc of textCalls) {
          const result = await executeToolCall(tc.tool, JSON.stringify(tc.args), signal);
          toolResults += `\n\n--- ${tc.tool} result ---\n${result}\n--- end ---`;
        }
        // Strip the tool tags from the content and re-prompt with results
        const cleanedContent = stripTextToolCalls(content);
        messages.push({ role: "assistant", content: cleanedContent || "Let me look that up." });
        messages.push({ role: "user", content: `Here are the tool results you requested:${toolResults}\n\nNow incorporate these results into your response. Remember to return valid JSON with thought, action, and message fields.` });
        continue;
      }
    }

    return content;
  }

  // If we exhausted rounds, return whatever we have
  const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
  return lastAssistant?.content || "";
}

async function executeToolCall(toolName, argsString, signal) {
  let toolArgs;
  try {
    toolArgs = JSON.parse(argsString || "{}");
  } catch {
    toolArgs = {};
  }

  console.log(`[tools] Executing: ${toolName}(${JSON.stringify(toolArgs)})`);

  try {
    const toolResponse = await fetch("/api/tool-execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: toolName, args: toolArgs }),
      signal
    });
    const toolData = await toolResponse.json();
    const resultText = toolName === "web_search"
      ? (toolData.results || []).map((r) => `${r.title}\n${r.snippet}\n${r.url}`).join("\n\n")
      : toolData.text || toolData.error || "No content returned.";

    console.log(`[tools] ${toolName} returned ${resultText.length} chars`);
    return resultText;
  } catch (err) {
    console.warn(`[tools] ${toolName} execution failed:`, err);
    return `Tool error: ${err.message}`;
  }
}

function parseTextToolCalls(content) {
  const calls = [];
  const searchPattern = /\[SEARCH:\s*(.+?)\]/gi;
  const readPattern = /\[READ:\s*(.+?)\]/gi;
  let match;
  while ((match = searchPattern.exec(content)) !== null) {
    calls.push({ tool: "web_search", args: { query: match[1].trim() } });
  }
  while ((match = readPattern.exec(content)) !== null) {
    calls.push({ tool: "read_webpage", args: { url: match[1].trim() } });
  }
  return calls;
}

function stripTextToolCalls(content) {
  return content
    .replace(/\[SEARCH:\s*.+?\]/gi, "")
    .replace(/\[READ:\s*.+?\]/gi, "")
    .trim();
}

async function generateQuickStart() {
  readSettingsFromForm();
  if (!state.settings.model) {
    setQuickStartStatus("Choose or type a model first.", "warn");
    return;
  }
  if (!state.ui.quickStartPrompt) {
    setQuickStartStatus("Describe the forum you want first.", "warn");
    return;
  }

  setQuickStartBusy(true);
  setQuickStartStatus("Generating setup...", "pending");
  const system = [
    "You create complete configurations for a local multi-actor AI forum.",
    "Return only valid JSON. Do not include markdown or commentary.",
    "Use concise but vivid actors. Keep local-model context limits in mind.",
    "The JSON must have this shape:",
    "{\"scenario\":{\"mode\":\"problem|story|freeform\",\"title\":\"\",\"premise\":\"\",\"objective\":\"\"},\"dm\":{\"enabled\":true,\"name\":\"\",\"persona\":\"\",\"seesPrivateThoughts\":false},\"actors\":[{\"name\":\"\",\"role\":\"\",\"persona\":\"\",\"goal\":\"\",\"voice\":\"\",\"thoughts\":\"\",\"enabled\":true}],\"memory\":{\"pinnedFacts\":\"\",\"sharedSummary\":\"\",\"openQuestions\":\"\",\"dmState\":\"\"}}"
  ].join("\n");
  const user = [
    `User request:\n${state.ui.quickStartPrompt}`,
    "Generate 3-5 actors unless the request clearly needs a different count.",
    "Use mode problem for collaborative problem solving, story for scenes/roleplay, and freeform for open-ended discussion."
  ].join("\n\n");

  try {
    const content = await chatCompletion(system, user, { temperature: 0.5, maxTokens: 1800 });
    state.ui.quickStartDraft = normalizeQuickStartConfig(parseQuickStartConfig(content));
    state.ui.quickStartStatus = "Generated setup ready for review.";
    saveState();
    renderQuickStartPreview();
  } catch (error) {
    state.ui.quickStartDraft = null;
    setQuickStartStatus(error.message || "Quick Start generation failed.", "error");
    renderQuickStartPreview();
  } finally {
    setQuickStartBusy(false);
  }
}

function parseQuickStartConfig(content) {
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
        // Try the next object-shaped response.
      }
    }
  }
  throw new Error("The model did not return usable setup JSON.");
}

function normalizeQuickStartConfig(config, assignFreshIds = true) {
  const source = config && typeof config === "object" ? config : {};
  const scenario = source.scenario && typeof source.scenario === "object" ? source.scenario : {};
  const dm = source.dm && typeof source.dm === "object" ? source.dm : {};
  const memory = source.memory && typeof source.memory === "object" ? source.memory : {};
  const actorSources = Array.isArray(source.actors) && source.actors.length
    ? source.actors.slice(0, 8)
    : structuredClone(defaultState.actors);

  return {
    scenario: {
      mode: ["problem", "story", "freeform"].includes(scenario.mode) ? scenario.mode : "problem",
      title: cleanConfigText(scenario.title, "Untitled forum", 80),
      premise: cleanConfigText(scenario.premise, defaultState.scenario.premise, 700),
      objective: cleanConfigText(scenario.objective, defaultState.scenario.objective, 500)
    },
    dm: {
      enabled: dm.enabled !== false,
      name: cleanConfigText(dm.name, "Director", 50),
      persona: cleanConfigText(dm.persona, defaultState.dm.persona, 500),
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

function normalizeQuickStartActor(actor, index, assignFreshIds) {
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
    color: colors[index % colors.length]
  };
}

function cleanConfigText(value, fallback, maxLength) {
  const text = stringifyList(value).replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, maxLength);
}

async function applyQuickStartConfig() {
  const draft = state.ui.quickStartDraft;
  if (!draft) {
    setQuickStartStatus("Generate a setup first.", "warn");
    return;
  }
  const normalized = normalizeQuickStartConfig(draft);
  const hadConversation = state.messages.length > 0;
  state.scenario = normalized.scenario;
  state.dm = {
    ...state.dm,
    enabled: normalized.dm.enabled,
    name: normalized.dm.name,
    persona: normalized.dm.persona,
    seesPrivateThoughts: normalized.dm.seesPrivateThoughts,
    thoughts: ""
  };
  state.actors = normalized.actors;
  state.memory = {
    ...state.memory,
    pinnedFacts: normalized.memory.pinnedFacts,
    sharedSummary: normalized.memory.sharedSummary,
    openQuestions: normalized.memory.openQuestions,
    dmState: normalized.memory.dmState,
    pendingPinnedFacts: [],
    turnsSinceSummary: 0,
    lastSummaryMessageId: ""
  };
  state.turnQueue = [];
  state.ui.quickStartDraft = null;
  state.ui.quickStartStatus = "Setup applied.";
  saveState();
  syncFormFromState();
  if (hadConversation) {
    await addMessage({
      type: "system",
      speaker: "System",
      content: `Setup changed by AI Quick Start: ${state.scenario.title}.`,
      color: "var(--coral)"
    });
  }
  switchTab("conversation");
}

function discardQuickStartConfig() {
  state.ui.quickStartDraft = null;
  state.ui.quickStartStatus = "Generated setup discarded.";
  saveState();
  renderQuickStartPreview();
}

function setQuickStartBusy(value) {
  els.generateQuickStart.disabled = value;
  els.applyQuickStart.disabled = value || !state.ui.quickStartDraft;
  els.discardQuickStart.disabled = value || !state.ui.quickStartDraft;
}

function setQuickStartStatus(message) {
  state.ui.quickStartStatus = message;
  els.quickStartStatus.textContent = message;
  saveState();
}

function parseAiJson(content) {
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

function stripCodeFence(content) {
  return String(content || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function parseStrictEnvelope(content) {
  try {
    const envelope = unwrapParsedEnvelope(JSON.parse(content));
    if (envelope) return envelope;
  } catch {
    for (const candidate of extractBalancedObjects(content)) {
      try {
        const envelope = unwrapParsedEnvelope(JSON.parse(candidate));
        if (envelope) return envelope;
      } catch {
        // Keep trying later object-shaped candidates.
      }
    }
  }
  return null;
}

function unwrapParsedEnvelope(value) {
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

function extractBalancedObjects(content) {
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

function parseLooseEnvelope(content) {
  if (!looksLikeEnvelope(content)) return null;
  const message = readLooseField(content, "message") || readLooseField(content, "content") || readLooseField(content, "response");
  const thought = readLooseField(content, "thought") || "";
  const action = readLooseField(content, "action") || "speak";
  if (!message && !thought) return null;
  return { thought, action, message };
}

function readLooseField(content, field) {
  const key = `["']?${field}["']?\\s*:`;
  const pattern = new RegExp(`${key}\\s*(?:"((?:\\\\.|[^"\\\\])*)"|'((?:\\\\.|[^'\\\\])*)'|([\\s\\S]*?)(?=,\\s*["']?(?:thought|action|message|content|response)["']?\\s*:|\\s*}\\s*$))`, "i");
  const match = content.match(pattern);
  if (!match) return "";
  if (match[1] !== undefined) return unescapeLooseString(match[1]);
  if (match[2] !== undefined) return unescapeLooseString(match[2]);
  return String(match[3] || "").trim().replace(/,$/, "").trim();
}

function unescapeLooseString(value) {
  try {
    return JSON.parse(`"${value.replace(/"/g, "\\\"")}"`);
  } catch {
    return value.replace(/\\n/g, "\n").replace(/\\"/g, "\"").replace(/\\\\/g, "\\").trim();
  }
}

function extractEmbeddedMessage(content) {
  if (!looksLikeEnvelope(content)) return "";
  return readLooseField(content, "message") || readLooseField(content, "content") || readLooseField(content, "response") || "";
}

function looksLikeEnvelope(content) {
  const text = stripCodeFence(content);
  return text.includes("{") && text.includes("}") && /["']?(?:thought|action|message|content|response)["']?\s*:/i.test(text);
}

function normalizeAiResult(result, fallback) {
  const action = String(result.action || "speak").toLowerCase().includes("skip") ? "skip" : "speak";
  const message = stringifyMessage(result.message || result.content || result.response || "").trim();
  return {
    thought: String(result.thought || "").trim(),
    action: action === "skip" || !message ? "skip" : "speak",
    message: message || fallback.trim()
  };
}

function stringifyMessage(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return String(value.message || value.content || value.response || value.text || JSON.stringify(value));
  }
  return String(value);
}

function cleanStoredMessage(message) {
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

function publicMessageContent(message) {
  if (!message) return "";
  const cleaned = cleanStoredMessage(message);
  return cleaned?.content || "";
}

async function applyAiResult(participant, result) {
  if (participant.kind === "dm") {
    state.dm.thoughts = appendMemory(state.dm.thoughts, result.thought);
    if (result.action === "skip") {
      return addMessage({ type: "skip", speaker: state.dm.name, content: "Skipped.", thought: result.thought, color: "var(--gold)" });
    }
    return addMessage({ type: "dm", speaker: state.dm.name, content: result.message, thought: result.thought, color: "var(--gold)" });
  }

  const actor = participant.data;
  actor.thoughts = appendMemory(actor.thoughts, result.thought);
  if (result.action === "skip") {
    return addMessage({ type: "skip", actorId: actor.id, speaker: actor.name, content: "Skipped.", thought: result.thought, color: actor.color });
  }
  return addMessage({ type: "actor", actorId: actor.id, speaker: actor.name, content: result.message, thought: result.thought, color: actor.color });
}

function appendMemory(existing, thought) {
  if (!thought) return existing || "";
  const entries = [existing, `[${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}] ${thought}`]
    .filter(Boolean)
    .join("\n");
  return entries.split("\n").slice(-14).join("\n");
}

function scenarioBlock() {
  return [
    `Mode: ${labelForMode(state.scenario.mode)}`,
    `Title: ${state.scenario.title || "Untitled forum"}`,
    state.scenario.premise ? `Premise: ${state.scenario.premise}` : "",
    state.scenario.objective ? `Objective: ${state.scenario.objective}` : ""
  ].filter(Boolean).join("\n");
}

function publicTranscript() {
  return formatTranscript(state.messages.slice(-PROMPT_MESSAGE_LIMIT), WORD_LIMITS.recentTranscript);
}

function privateThoughtDigest() {
  const actorNotes = state.actors
    .filter((actor) => actor.enabled && actor.thoughts)
    .map((actor) => `${actor.name}: ${actor.thoughts}`)
    .join("\n\n");
  return actorNotes ? `Private actor thoughts:\n${actorNotes}` : "";
}

async function summarizeMemory(reason = "manual", sourceMessages = null, options = {}) {
  if (reason === "manual" || reason === "rebuild") readSettingsFromForm();
  if (!state.memory.enabled) {
    if (reason === "manual") setStatus("Memory is off.", "warn");
    return;
  }
  if (!state.settings.model) {
    if (reason === "manual") setStatus("Choose or type a model before summarizing memory.", "warn");
    return;
  }

  if (state.memory.isSummarizing) {
    return;
  }

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
  }

  const isBackground = reason === "cycle" || reason === "round";
  state.memory.isSummarizing = true;

  if (isBackground) {
    if (els.memoryStatus) {
      els.memoryStatus.textContent = "Updating memory in background...";
    }
  } else {
    setBusy(true);
    setStatus("Updating memory...", "pending");
  }

  const system = [
    "You update compact long-term memory for a local multi-actor AI forum.",
    "Be ruthless about compression because the next model may have a small context window.",
    "For 'actorMemoryUpdates', summarize what each actor learned, how their thoughts progressed, and how their relationships, trust, or disagreements with other specific actors changed.",
    "Return only valid JSON with this exact shape:",
    "{\"sharedSummary\":\"300-600 word durable summary\",\"openQuestions\":\"short unresolved question list\",\"dmState\":\"scenario/project/world state, empty if none\",\"actorMemoryUpdates\":{\"Actor Name\":\"short private memory update including relationship changes and perspective of other actors\"},\"pinnedFactSuggestions\":[\"facts the user may want pinned\"],\"chunkSummary\":\"100-180 word summary of the source turns\",\"keywords\":[\"lowercase\",\"keywords\"]}"
  ].join("\n");
  const user = [
    `Reason: ${reason}`,
    scenarioBlock(),
    `Existing pinned facts:\n${state.memory.pinnedFacts || "None."}`,
    `Existing shared summary:\n${state.memory.sharedSummary || "None."}`,
    `Existing open questions:\n${state.memory.openQuestions || "None."}`,
    `Existing DM state:\n${state.memory.dmState || "None."}`,
    `Source turns:\n${formatTranscript(usableMessages, 1800)}`
  ].join("\n\n");

  try {
    const content = await chatCompletion(system, user, { temperature: 0.2, maxTokens: 950 });
    const memoryUpdate = normalizeMemoryUpdate(parseMemoryJson(content), usableMessages);
    applyMemoryUpdate(memoryUpdate, usableMessages);
    await archiveMemoryChunk(memoryUpdate, usableMessages);
    state.memory.lastSummaryMessageId = usableMessages[usableMessages.length - 1]?.id || state.memory.lastSummaryMessageId;
    state.memory.turnsSinceSummary = 0;
    saveState();
    renderActors();
    renderMemory();
    if (!isBackground) {
      setStatus("Memory updated.", "ok");
    }
  } catch (error) {
    if (!isBackground) {
      setStatus(error.message || "Memory update failed.", "error");
    } else {
      console.warn("Background memory update failed:", error);
    }
  } finally {
    state.memory.isSummarizing = false;
    if (isBackground) {
      renderMemory();
    } else {
      setBusy(false);
    }
  }
}

function messagesSinceLastSummary() {
  if (!state.memory.lastSummaryMessageId) return state.messages.slice(-PROMPT_MESSAGE_LIMIT);
  const index = state.messages.findIndex((message) => message.id === state.memory.lastSummaryMessageId);
  return index >= 0 ? state.messages.slice(index + 1) : state.messages.slice(-PROMPT_MESSAGE_LIMIT);
}

function parseMemoryJson(content) {
  const cleaned = stripCodeFence(content);
  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    for (const candidate of extractBalancedObjects(cleaned)) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {
        // Try the next candidate.
      }
    }
  }
  return { sharedSummary: cleaned };
}

function normalizeMemoryUpdate(update, sourceMessages) {
  const fallbackKeywords = extractKeywords(formatTranscript(sourceMessages, 1200)).slice(0, 16);
  return {
    sharedSummary: trimWords(stringifyList(update.sharedSummary), WORD_LIMITS.sharedSummary),
    openQuestions: trimWords(stringifyList(update.openQuestions), WORD_LIMITS.openQuestions),
    dmState: trimWords(stringifyList(update.dmState), WORD_LIMITS.dmState),
    actorMemoryUpdates: update.actorMemoryUpdates && typeof update.actorMemoryUpdates === "object" ? update.actorMemoryUpdates : {},
    pinnedFactSuggestions: normalizeStringArray(update.pinnedFactSuggestions).slice(0, 8),
    chunkSummary: trimWords(stringifyList(update.chunkSummary || update.sharedSummary), WORD_LIMITS.chunk),
    keywords: normalizeStringArray(update.keywords).concat(fallbackKeywords).map((keyword) => keyword.toLowerCase()).filter(Boolean).slice(0, 24)
  };
}

function applyMemoryUpdate(update) {
  if (update.sharedSummary) state.memory.sharedSummary = update.sharedSummary;
  if (update.openQuestions) state.memory.openQuestions = update.openQuestions;
  if (state.dm.enabled && update.dmState) state.memory.dmState = update.dmState;
  applyActorMemoryUpdates(update.actorMemoryUpdates);
  update.pinnedFactSuggestions.forEach((fact) => {
    if (!fact) return;
    const duplicate = state.memory.pendingPinnedFacts.some((existing) => existing.toLowerCase() === fact.toLowerCase())
      || state.memory.pinnedFacts.toLowerCase().includes(fact.toLowerCase());
    if (!duplicate) state.memory.pendingPinnedFacts.push(trimWords(fact, 40));
  });
}

function applyActorMemoryUpdates(updates) {
  Object.entries(updates || {}).forEach(([nameOrId, update]) => {
    const text = trimWords(stringifyList(update), 80);
    if (!text) return;
    const actor = state.actors.find((item) => item.id === nameOrId || item.name.toLowerCase() === nameOrId.toLowerCase());
    if (actor) {
      actor.thoughts = trimWords(appendMemory(actor.thoughts, text), WORD_LIMITS.actorMemory);
    }
  });
}

async function archiveMemoryChunk(update, sourceMessages) {
  const speakers = [...new Set(sourceMessages.map((message) => message.speaker).filter(Boolean))];
  const chunkText = update.chunkSummary || formatTranscript(sourceMessages, WORD_LIMITS.chunk);

  let vector = null;
  try {
    vector = await getEmbedding(chunkText);
  } catch (err) {
    console.warn("Could not generate vector embedding for archived memory chunk:", err);
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
    vector
  };
  try {
    await putChunk(chunk);
  } catch (err) {
    console.error("Failed to archive memory chunk in database:", err);
  }
}

function approvePinnedFacts() {
  const checks = $$(".pending-fact-check", els.pendingFactsList);
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
}

async function clearArchivedMemory() {
  await clearChunks();
  state.memory.lastSummaryMessageId = "";
  state.memory.archivedCount = 0;
  saveState();
  renderMemory();
  setStatus("Archived memory cleared.", "ok");
}

async function extractOutcomes() {
  readSettingsFromForm();
  if (!state.settings.model) {
    setOutcomeStatus("Choose or type a model before extracting outcomes.");
    return;
  }

  const chunks = await getAllChunks();
  const sourceMessages = state.messages.slice(-24);
  const archiveText = chunks.slice(-8).map((chunk) => `- ${chunk.text}`).join("\n");
  const hasSource = sourceMessages.length || archiveText || state.memory.sharedSummary || state.memory.pinnedFacts;
  if (!hasSource) {
    setOutcomeStatus("No conversation or memory to mine yet.");
    return;
  }

  const alreadyBusy = isGenerating;
  setBusy(true);
  setOutcomeStatus("Extracting outcomes...");
  const system = [
    "You mine a multi-actor AI forum transcript for useful project outcomes.",
    "Separate firm conclusions from suggestions and unresolved ideas.",
    "Prefer concise, implementation-ready bullets.",
    "Return only valid JSON with this exact shape:",
    "{\"finalRecommendation\":\"short final recommendation\",\"decisions\":[\"decision bullets\"],\"rationale\":[\"why these decisions were made\"],\"rejectedOptions\":[\"rejected/deferred options\"],\"actionItems\":[\"next implementation tasks\"],\"risks\":[\"risks or caveats\"]}"
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
    renderOutcomes();
  } catch (error) {
    setOutcomeStatus(error.message || "Outcome extraction failed.");
  } finally {
    if (!alreadyBusy) setBusy(false);
  }
}

function parseOutcomeJson(content) {
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

function normalizeOutcomeUpdate(update) {
  return {
    finalRecommendation: trimWords(stringifyList(update.finalRecommendation), 260),
    decisions: trimWords(stringifyBullets(update.decisions), 360),
    rationale: trimWords(stringifyBullets(update.rationale), 360),
    rejectedOptions: trimWords(stringifyBullets(update.rejectedOptions), 260),
    actionItems: trimWords(stringifyBullets(update.actionItems), 360),
    risks: trimWords(stringifyBullets(update.risks), 260)
  };
}

function stringifyBullets(value) {
  const items = normalizeStringArray(value);
  if (items.length) return items.map((item) => `- ${item}`).join("\n");
  return stringifyList(value);
}

function formatCurrentOutcomes() {
  return [
    state.outcomes.finalRecommendation ? `Final recommendation:\n${state.outcomes.finalRecommendation}` : "",
    state.outcomes.decisions ? `Decisions:\n${state.outcomes.decisions}` : "",
    state.outcomes.rationale ? `Rationale:\n${state.outcomes.rationale}` : "",
    state.outcomes.rejectedOptions ? `Rejected options:\n${state.outcomes.rejectedOptions}` : "",
    state.outcomes.actionItems ? `Action items:\n${state.outcomes.actionItems}` : "",
    state.outcomes.risks ? `Risks:\n${state.outcomes.risks}` : ""
  ].filter(Boolean).join("\n\n") || "None.";
}

function setOutcomeStatus(message) {
  state.outcomes.status = message;
  els.outcomeStatus.textContent = message;
  saveState();
}

function stringifyList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join("\n");
  if (value && typeof value === "object") return Object.entries(value).map(([key, item]) => `${key}: ${stringifyList(item)}`).join("\n");
  return String(value || "").trim();
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  const text = String(value || "").trim();
  if (!text) return [];
  return text.split(/\n|,/).map((item) => item.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
}

function extractKeywords(text) {
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

function trimWords(text, limit) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= limit) return words.join(" ");
  return `${words.slice(0, limit).join(" ")}...`;
}

async function loadModels() {
  readSettingsFromForm();
  setStatus("Checking LM Studio...", "pending");
  try {
    const response = await fetch("/api/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseUrl: state.settings.baseUrl,
        apiKey: state.settings.apiKey
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load models.");
    const models = (data.data || []).map((model) => model.id).filter(Boolean);
    els.modelOptions.innerHTML = "";
    models.forEach((id) => {
      const option = document.createElement("option");
      option.value = id;
      els.modelOptions.append(option);
    });
    if (!state.settings.model && models[0]) {
      state.settings.model = models[0];
      els.model.value = models[0];
      saveState();
    }
    setStatus(models.length ? `Loaded ${models.length} model${models.length === 1 ? "" : "s"}.` : "Connected, but no models were listed.", "ok");
  } catch (error) {
    setStatus(error.message || "Could not reach LM Studio.", "error");
  }
}

function setStatus(message, tone = "pending") {
  els.connectionStatus.textContent = message;
  els.connectionStatus.dataset.tone = tone;
}

function addActor() {
  const index = state.actors.length;
  state.actors.push({
    id: crypto.randomUUID(),
    name: `Actor ${index + 1}`,
    role: "Participant",
    persona: "",
    goal: "",
    voice: "",
    thoughts: "",
    enabled: true,
    color: colors[index % colors.length]
  });
  saveState();
  render();
}

function savePreset() {
  readSettingsFromForm();
  const preset = {
    version: PRESET_VERSION,
    settings: state.settings,
    memory: {
      enabled: state.memory.enabled,
      pinnedFacts: state.memory.pinnedFacts,
      sharedSummary: state.memory.sharedSummary,
      openQuestions: state.memory.openQuestions,
      dmState: state.memory.dmState
    },
    scenario: state.scenario,
    dm: state.dm,
    actors: state.actors,
    autoStop: {
      ...state.autoStop,
      roundsRun: 0,
      status: "Auto-stop ready."
    }
  };
  downloadJson(`forum-preset-${slugDate()}.json`, preset);
}

async function exportSession() {
  readSettingsFromForm();
  const messages = await getAllMessages();
  const chunks = await getAllChunks();
  downloadJson(`forum-session-${slugDate()}.json`, {
    version: PRESET_VERSION,
    exportedAt: new Date().toISOString(),
    ...state,
    messages,
    chunks
  });
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function slugDate() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

async function resetSession(fullReset = false) {
  try { await clearMessages(); } catch (err) { console.warn("clearMessages failed:", err); }
  try { await clearChunks(); } catch (err) { console.warn("clearChunks failed:", err); }

  if (fullReset) {
    state = structuredClone(defaultState);
  } else {
    const keepConfig = {
      settings: state.settings,
      scenario: state.scenario,
      dm: { ...state.dm, thoughts: "" },
      actors: state.actors.map((actor) => ({ ...actor, thoughts: "" })),
      memory: {
        ...structuredClone(defaultState.memory),
        enabled: state.memory.enabled,
        migratedLegacyMessages: true
      },
      outcomes: structuredClone(defaultState.outcomes),
      autoStop: {
        ...state.autoStop,
        roundsRun: 0,
        status: "Auto-stop ready."
      }
    };
    state = normalizeState({ ...structuredClone(defaultState), ...keepConfig, messages: [], turnQueue: [] });
  }

  saveState();
  syncFormFromState();
  switchTab(fullReset ? "setup" : "conversation");
  setStatus(fullReset ? "Everything reset to defaults." : "Conversation cleared.", "ok");
}

async function confirmAndResetSession() {
  const ok = window.confirm("Clear the conversation, actor memories, summaries, and archived memory? Your setup (actors, scenario, settings) will be kept.");
  if (!ok) return;
  await resetSession(false);
}

async function confirmAndFullReset() {
  const ok = window.confirm("Full factory reset: clear EVERYTHING and restore all defaults? This cannot be undone.");
  if (!ok) return;
  await resetSession(true);
}

function loadPresetFile(file) {
  const reader = new FileReader();
  reader.addEventListener("load", async () => {
    try {
      const preset = JSON.parse(String(reader.result || "{}"));
      state = normalizeState({
        ...state,
        settings: { ...state.settings, ...preset.settings },
        memory: { ...state.memory, ...preset.memory },
        autoStop: { ...state.autoStop, ...preset.autoStop, roundsRun: 0 },
        scenario: { ...state.scenario, ...preset.scenario },
        dm: { ...state.dm, ...preset.dm },
        actors: preset.actors || state.actors
      });
      if (Array.isArray(preset.messages)) {
        await clearMessages();
        await putMessages(preset.messages.map(cleanStoredMessage));
        state.messages = await getRecentMessages(RECENT_MESSAGE_LIMIT);
      }
      if (Array.isArray(preset.chunks)) {
        await clearChunks();
        for (const chunk of preset.chunks) {
          await putChunk(chunk);
        }
      }
      state.memory.archivedCount = await countChunks();
      saveState();
      syncFormFromState();
      setStatus("Preset loaded.", "ok");
    } catch {
      setStatus("That preset file could not be read.", "error");
    }
  });
  reader.readAsText(file);
}

function wireEvents() {
  [
    els.baseUrl,
    els.apiKey,
    els.model,
    els.temperature,
    els.mode,
    els.title,
    els.premise,
    els.objective,
    els.dmEnabled,
    els.dmName,
    els.dmPersona,
    els.dmPrivate,
    els.quickStartPrompt,
    els.memoryEnabled,
    els.pinnedFacts,
    els.sharedSummary,
    els.openQuestions,
    els.dmState,
    els.outcomeRecommendation,
    els.outcomeDecisions,
    els.outcomeRationale,
    els.outcomeRejected,
    els.outcomeActions,
    els.outcomeRisks,
    els.autoStopEnabled,
    els.autoGoal,
    els.goalCheckEnabled,
    els.stopOnAllSkip,
    els.maxRoundsEnabled,
    els.maxRounds,
    els.showThoughts,
    els.toolsEnabled
  ].forEach((element) => {
    const handler = () => {
      if (!isInitialized) return;
      readSettingsFromForm();
      renderConversationSummary();
      renderAutoStop();
      renderTranscript();
    };
    element.addEventListener("input", handler);
    element.addEventListener("change", handler);
  });

  els.tabButtons.forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });
  els.tabJumps.forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tabJump));
  });

  els.composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    const content = els.userInput.value.trim();
    if (!content) return;
    readSettingsFromForm();
    await addMessage({ type: "user", speaker: "You", content, color: "var(--blue)" });
    els.userInput.value = "";
  });

  els.loadModels.addEventListener("click", loadModels);
  els.nextTurn.addEventListener("click", runNextTurn);
  els.round.addEventListener("click", () => runRound());
  els.auto.addEventListener("click", runAutoLoop);
  els.clearConversation.addEventListener("click", confirmAndResetSession);
  els.stop.addEventListener("click", stopGeneration);
  els.generateQuickStart.addEventListener("click", generateQuickStart);
  els.applyQuickStart.addEventListener("click", () => applyQuickStartConfig());
  els.discardQuickStart.addEventListener("click", discardQuickStartConfig);
  els.addActor.addEventListener("click", addActor);
  els.savePreset.addEventListener("click", savePreset);
  els.loadPreset.addEventListener("click", () => els.presetFile.click());
  els.exportSession.addEventListener("click", () => exportSession());
  els.reset.addEventListener("click", confirmAndFullReset);
  els.summarizeNow.addEventListener("click", () => summarizeMemory("manual"));
  els.rebuildMemory.addEventListener("click", () => summarizeMemory("rebuild", state.messages.slice(-24), { reset: true }));
  els.approveFacts.addEventListener("click", approvePinnedFacts);
  els.clearArchive.addEventListener("click", clearArchivedMemory);
  els.extractOutcomes.addEventListener("click", extractOutcomes);
  els.checkGoalNow.addEventListener("click", () => judgeGoal(state.messages.slice(-participantCycleCount()), { manual: true }));
  els.presetFile.addEventListener("change", () => {
    const [file] = els.presetFile.files;
    if (file) loadPresetFile(file);
    els.presetFile.value = "";
  });
  els.themeToggle.addEventListener("click", () => {
    state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = state.settings.theme;
    saveState();
  });
}

async function startApp() {
  wireEvents();
  syncFormFromState();
  isInitialized = true;
  try {
    await initializeMemoryStorage();
    render();
  } catch (err) {
    console.warn("Memory storage initialization failed, app continues:", err);
  }
}

startApp();
