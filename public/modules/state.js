import { STORAGE_KEY, VALID_TABS, defaultState } from './constants.js';
import { normalizeQuickStartConfig, cleanStoredMessage, normalizeStringArray } from './utils.js';

function normalizeDocumentEntry(e) {
  return {
    id: e.id || crypto.randomUUID(),
    title: e.title || "Untitled",
    type: "document",
    content: e.content || "",
    enabled: e.enabled !== false,
    aiEditable: !!e.aiEditable,
    createdAt: e.createdAt || new Date().toISOString(),
    updatedAt: e.updatedAt || e.createdAt || new Date().toISOString(),
    wordCount: typeof e.wordCount === "number" ? e.wordCount : (e.content||"").trim().split(/\s+/).filter(Boolean).length,
    versions: Array.isArray(e.versions) ? e.versions : [],
    maxVersions: typeof e.maxVersions === "number" ? e.maxVersions : 20,
    target: "all",
  };
}

function normalizeState(value) {
  const merged = {
    ...structuredClone(defaultState),
    ...value,
    settings: { ...defaultState.settings, ...value.settings },
    ui: { ...defaultState.ui, ...value.ui },
    memory: { ...defaultState.memory, ...value.memory },
    telemetry: { ...defaultState.telemetry, ...value.telemetry },
    diagnostics: { ...defaultState.diagnostics, ...value.diagnostics },
    outcomes: { ...defaultState.outcomes, ...value.outcomes },
    autoStop: { ...defaultState.autoStop, ...value.autoStop },
    scenario: { ...defaultState.scenario, ...value.scenario },
    dm: { ...defaultState.dm, ...value.dm },
    actors: Array.isArray(value.actors) && value.actors.length ? value.actors : structuredClone(defaultState.actors),
    messages: Array.isArray(value.messages) ? value.messages.map(cleanStoredMessage) : [],
    turnQueue: Array.isArray(value.turnQueue) ? value.turnQueue : []
  };
  // Migrate old single document → documents[] entry
  if (!Array.isArray(value.documents)) {
    const docs = [];
    const d = value.document;
    if (d && (d.content || d.title || d.enabled)) {
      docs.push(normalizeDocumentEntry({
        id: crypto.randomUUID(),
        title: d.title || 'Shared Document',
        content: d.content || '',
        enabled: d.enabled !== false,
        aiEditable: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        wordCount: (d.content||'').trim().split(/\s+/).filter(Boolean).length,
        versions: d.versions || [],
        maxVersions: d.maxVersions || 20,
        target: 'all',
      }));
    }
    merged.documents = docs;
  } else {
    merged.documents = value.documents.map(normalizeDocumentEntry);
  }
  delete merged.document;

  if (!Array.isArray(merged.telemetry.alignmentHistory)) merged.telemetry.alignmentHistory = [];
  if (!Array.isArray(merged.diagnostics.transitions)) merged.diagnostics.transitions = [];
  if (!Array.isArray(merged.diagnostics.warnings)) merged.diagnostics.warnings = [];
  if (!Array.isArray(merged.diagnostics.sessionsIndex)) merged.diagnostics.sessionsIndex = [];
  if (!Array.isArray(merged.diagnostics.apiCallLogs)) merged.diagnostics.apiCallLogs = [];
  if (!Array.isArray(merged.diagnostics.parseFailures)) merged.diagnostics.parseFailures = [];
  if (!Array.isArray(merged.diagnostics.outcomeExtractionLog)) merged.diagnostics.outcomeExtractionLog = [];
  if (!Array.isArray(merged.anchors)) merged.anchors = [];

  merged.memory.isSummarizing = false;
  if (!value.settings?.baseUrl || value.settings.baseUrl === "http://localhost:1234/v1") {
    merged.settings.baseUrl = defaultState.settings.baseUrl;
  }
  // Migrate old maxTokens default (700) to new default (1200)
  if (value.settings?.maxTokens === 700) {
    merged.settings.maxTokens = defaultState.settings.maxTokens;
  }
  // toolsEnabled didn't exist in early versions — treat undefined/missing as true
  if (value.settings && typeof value.settings.toolsEnabled === "undefined") {
    merged.settings.toolsEnabled = true;
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
  if (!Array.isArray(merged.memory.recentDeltas)) {
    merged.memory.recentDeltas = [];
  }
  
  // Ensure memory array fields are clean arrays (excluding single characters or empty strings)
  for (const key of ["pinnedFacts", "openQuestions"]) {
    const val = value.memory?.[key];
    merged.memory[key] = normalizeStringArray(val)
      .filter((item) => typeof item === "string" && item.trim().length > 1);
  }

  // Ensure outcome array fields are clean arrays
  for (const key of ["decisions", "rationale", "rejectedOptions", "actionItems", "risks"]) {
    const val = value.outcomes?.[key];
    merged.outcomes[key] = normalizeStringArray(val);
  }
  merged.outcomes.isExtracting = false;
  merged.outcomes.isExtractingOutcomes = false;
  
  // Ensure other memory fields are strings
  for (const key of ["sharedSummary", "dmState"]) {
    const val = merged.memory[key];
    if (val && typeof val === "object") {
      merged.memory[key] = JSON.stringify(val);
    } else if (typeof val !== "string") {
      merged.memory[key] = String(val || "");
    }
  }
  
  merged.memory.cycleCount = Number(merged.memory.cycleCount || 0);
  merged.memory.archivedCount = Number(merged.memory.archivedCount || 0);
  merged.memory.turnsSinceSummary = Number(merged.memory.turnsSinceSummary || 0);
  merged.autoStop.maxRounds = Math.min(50, Math.max(1, Number(merged.autoStop.maxRounds || defaultState.autoStop.maxRounds)));
  merged.autoStop.roundsRun = Math.max(0, Number(merged.autoStop.roundsRun || 0));
  
  if (merged.autoStop.enabled && !String(merged.autoStop.goal || "").trim()) {
    merged.autoStop.goal = String(merged.scenario.objective || "").trim();
  }
  merged.actors = merged.actors.map((actor, index) => ({
    id: actor.id || crypto.randomUUID(),
    name: actor.name || `Actor ${index + 1}`,
    role: actor.role || "Participant",
    persona: actor.persona || "",
    goal: actor.goal || "",
    voice: actor.voice || "",
    thoughts: (actor.thoughts && typeof actor.thoughts === "object") ? JSON.stringify(actor.thoughts) : String(actor.thoughts || ""),
    relationships: (actor.relationships && typeof actor.relationships === "object") ? actor.relationships : {},
    enabled: actor.enabled !== false,
    expanded: actor.expanded || false,
    isResearcher: !!actor.isResearcher,
    canManageCast: !!actor.canManageCast,
    maxTokens: typeof actor.maxTokens === "number" && actor.maxTokens > 0 ? actor.maxTokens : undefined,
    temperature: typeof actor.temperature === "number" ? actor.temperature : 0.8,
    color: actor.color || defaultState.actors[index % defaultState.actors.length]?.color || "#18726d"
  }));
  return merged;
}

export { normalizeState, normalizeDocumentEntry };

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved) return structuredClone(defaultState);
    return normalizeState(saved);
  } catch {
    return structuredClone(defaultState);
  }
}

export let state = loadState();

export function setState(newState) {
  state = newState;
}

export function saveState() {
  const { messages, autoRunning, ...persisted } = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...persisted, messages: [] }));
}

export function logTransition(type, detail = {}) {
  if (!state.diagnostics) state.diagnostics = {};
  if (!Array.isArray(state.diagnostics.transitions)) state.diagnostics.transitions = [];
  state.diagnostics.transitions.push({
    at: new Date().toISOString(),
    type,
    ...detail
  });
  if (state.diagnostics.transitions.length > 500) {
    state.diagnostics.transitions.shift();
  }
}

export function logWarning(category, msg, severity = "warn") {
  if (!state.diagnostics) state.diagnostics = {};
  if (!Array.isArray(state.diagnostics.warnings)) state.diagnostics.warnings = [];
  state.diagnostics.warnings.push({
    at: new Date().toISOString(),
    severity,
    category,
    msg
  });
  if (state.diagnostics.warnings.length > 100) {
    state.diagnostics.warnings.shift();
  }
}
