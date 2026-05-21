import { STORAGE_KEY, VALID_TABS, defaultState } from './constants.js';
import { normalizeQuickStartConfig, cleanStoredMessage } from './utils.js';

function normalizeState(value) {
  const merged = {
    ...structuredClone(defaultState),
    ...value,
    settings: { ...defaultState.settings, ...value.settings },
    ui: { ...defaultState.ui, ...value.ui },
    memory: { ...defaultState.memory, ...value.memory },
    outcomes: { ...defaultState.outcomes, ...value.outcomes },
    autoStop: { ...defaultState.autoStop, ...value.autoStop },
    document: { ...defaultState.document, ...value.document },
    scenario: { ...defaultState.scenario, ...value.scenario },
    dm: { ...defaultState.dm, ...value.dm },
    actors: Array.isArray(value.actors) && value.actors.length ? value.actors : structuredClone(defaultState.actors),
    messages: Array.isArray(value.messages) ? value.messages.map(cleanStoredMessage) : [],
    turnQueue: Array.isArray(value.turnQueue) ? value.turnQueue : []
  };
  if (!Array.isArray(merged.document.versions)) merged.document.versions = [];
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
  // Ensure all memory text fields are strings (AI sometimes returns objects)
  for (const key of ["pinnedFacts", "sharedSummary", "openQuestions", "dmState"]) {
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
    color: actor.color || defaultState.actors[index % defaultState.actors.length]?.color || "#18726d"
  }));
  return merged;
}

export { normalizeState };

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
