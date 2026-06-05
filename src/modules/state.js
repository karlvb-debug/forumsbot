import { STORAGE_KEY, VALID_TABS, defaultState, colors } from './constants.js';
import { DEFAULT_SYSTEMS, legacySystemsFromMode, normalizeQuickStartConfig, cleanStoredMessage, normalizeStringArray, normalizeCadence, normalizeSpeakingOrderStrategy } from './utils.js';

function normalizeDocumentEntry(e) {
  return {
    id: e.id || crypto.randomUUID(),
    title: e.title || "Untitled",
    type: e.type === "link" ? "link" : "document",
    content: e.content || "",
    url: e.url || "",
    purpose: e.purpose || "",
    format: e.format || "",
    writerId: e.writerId || "",
    enabled: e.enabled !== false,
    createdAt: e.createdAt || new Date().toISOString(),
    updatedAt: e.updatedAt || e.createdAt || new Date().toISOString(),
    wordCount: typeof e.wordCount === "number" ? e.wordCount : (e.content||"").trim().split(/\s+/).filter(Boolean).length,
    aiEditable: e.aiEditable === true,
    versions: Array.isArray(e.versions) ? e.versions : [],
    maxVersions: typeof e.maxVersions === "number" ? e.maxVersions : 20,
  };
}

/**
 * Resolve an actor's scheduling cadence, folding the legacy 'on_every_turn'
 * trigger into a turn cadence. Periodic firing has exactly one source of truth
 * (the cadence); on_every_turn is no longer a distinct trigger. A pre-existing
 * cadence/turnSchedule wins; otherwise an on_every_turn trigger implies { turn, 1 }.
 */
function migrateEveryTurnTrigger(actor) {
  let cadence = normalizeCadence(actor);
  if (!cadence && Array.isArray(actor?.triggerOn) && actor.triggerOn.includes('on_every_turn')) {
    cadence = { unit: 'turn', n: 1 };
  }
  // Pathology guard: a BACKGROUND actor (director/manager/orchestrator) on a
  // per-turn cadence re-fires after every single actor turn, spamming management
  // messages and looking like an infinite loop. Background orchestrators belong
  // on a round cadence; demote per-turn → per-round on load. Visible participants
  // on a turn cadence are left alone (that is a legitimate config).
  if (cadence && cadence.unit === 'turn' && cadence.n === 1 && (actor?.actorMode === 'background')) {
    cadence = { unit: 'round', n: 1 };
  }
  return cadence;
}

function normalizeState(value = {}) {
  const scenarioInput = value.scenario && typeof value.scenario === "object" ? value.scenario : {};
  const { mode: legacyMode, systems: inputSystems = {}, ...scenarioFields } = scenarioInput;
  const rawScenarioSystems = inputSystems && typeof inputSystems === "object" ? inputSystems : {};
  const legacySystems = legacySystemsFromMode(legacyMode);
  const scenarioSystems = {
    ...DEFAULT_SYSTEMS,
    ...defaultState.scenario.systems,
    ...legacySystems,
    ...rawScenarioSystems,
    stageDirections: {
      ...DEFAULT_SYSTEMS.stageDirections,
      ...defaultState.scenario.systems.stageDirections,
      ...(legacySystems.stageDirections || {}),
      ...(rawScenarioSystems.stageDirections || {})
    },
    alignment: {
      ...DEFAULT_SYSTEMS.alignment,
      ...defaultState.scenario.systems.alignment,
      ...(legacySystems.alignment || {}),
      ...(rawScenarioSystems.alignment || {})
    },
    turnRouting: {
      ...DEFAULT_SYSTEMS.turnRouting,
      ...defaultState.scenario.systems.turnRouting,
      ...(legacySystems.turnRouting || {}),
      ...(rawScenarioSystems.turnRouting || {})
    },
    dmRole: {
      ...DEFAULT_SYSTEMS.dmRole,
      ...defaultState.scenario.systems.dmRole,
      ...(legacySystems.dmRole || {}),
      ...(rawScenarioSystems.dmRole || {})
    }
  };
  scenarioSystems.turnRouting.strategy = normalizeSpeakingOrderStrategy(scenarioSystems.turnRouting.strategy);
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
    documentWriting: { ...defaultState.documentWriting, ...(value.documentWriting || {}) },
    scenario: {
      ...defaultState.scenario,
      ...scenarioFields,
      systems: scenarioSystems
    },
    dm: { ...defaultState.dm, ...value.dm },
    actors: (Array.isArray(value.actors) && value.actors.length ? value.actors : structuredClone(defaultState.actors))
      .map(a => ({
        canInject: false,
        cadence: null,
        actorMode: 'participant',
        triggerOn: [],
        ...a,
        // NOTE: on_every_turn is intentionally NOT stripped here — the second
        // pass (migrateEveryTurnTrigger) folds it into a cadence first, then
        // strips it from triggerOn. Stripping here would defeat that migration.
        triggerOn: Array.isArray(a.triggerOn) ? a.triggerOn : [],
      })),
    messages: Array.isArray(value.messages) ? value.messages.map(cleanStoredMessage) : [],
    turnQueue: Array.isArray(value.turnQueue) ? value.turnQueue : [],
    userContext: {
      ...defaultState.userContext,
      ...(value.userContext || {}),
      pausePolicy: { ...defaultState.userContext.pausePolicy, ...(value.userContext?.pausePolicy || {}) }
    }
  };

  // Migrate old document + knowledgeBase → unified documents[]
  // Also handles the case where value.documents is [] (empty array from an intermediate build)
  // but value.document still has content that hasn't been migrated yet.
  if (!Array.isArray(value.documents) || (value.documents.length === 0 && value.document?.content)) {
    const docs = Array.isArray(value.documents) ? value.documents.map(normalizeDocumentEntry) : [];
    // Old KB entries → read-only reference documents (only if not already migrated)
    if (!Array.isArray(value.documents)) {
      for (const e of (Array.isArray(value.knowledgeBase) ? value.knowledgeBase : [])) {
        docs.push(normalizeDocumentEntry({ ...e, aiEditable: false }));
      }
    }
    // Old single editable document → first editable document
    const d = value.document;
    if (d && (d.content || d.title || d.enabled)) {
      docs.unshift(normalizeDocumentEntry({
        id: crypto.randomUUID(),
        title: d.title || "Shared Document",
        type: "document",
        content: d.content || "",
        url: "",
        enabled: d.enabled !== false,
        aiEditable: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        wordCount: (d.content || "").trim().split(/\s+/).filter(Boolean).length,
        versions: d.versions || [],
        maxVersions: d.maxVersions || 20,
      }));
    }
    merged.documents = docs;
  } else {
    merged.documents = value.documents.map(normalizeDocumentEntry);
  }
  delete merged.document;
  delete merged.knowledgeBase;
  if (!Array.isArray(merged.documentTasks)) merged.documentTasks = [];
  if (!Array.isArray(merged.pendingDocumentEdits)) merged.pendingDocumentEdits = [];

  if (!Array.isArray(merged.telemetry.alignmentHistory)) merged.telemetry.alignmentHistory = [];
  if (!Array.isArray(merged.diagnostics.transitions)) merged.diagnostics.transitions = [];
  if (!Array.isArray(merged.diagnostics.warnings)) merged.diagnostics.warnings = [];
  if (!Array.isArray(merged.diagnostics.sessionsIndex)) merged.diagnostics.sessionsIndex = [];
  if (!Array.isArray(merged.diagnostics.apiCallLogs)) merged.diagnostics.apiCallLogs = [];
  if (!Array.isArray(merged.diagnostics.parseFailures)) merged.diagnostics.parseFailures = [];
  if (!Array.isArray(merged.diagnostics.outcomeExtractionLog)) merged.diagnostics.outcomeExtractionLog = [];
  if (!Array.isArray(merged.anchors)) merged.anchors = [];
  if (!Array.isArray(merged.pendingInjections)) merged.pendingInjections = [];
  if (!Array.isArray(merged.pendingPrivateMessages)) merged.pendingPrivateMessages = [];
  if (!Array.isArray(merged.pendingPauses)) merged.pendingPauses = [];

  merged.memory.isSummarizing = false;
  merged.memory.isDistilling = false;
  merged.memory.distillingActor = "";
  merged.ui.pauseModal = null;
  merged.ui.awaitingUserInput = false;
  merged.ui.focusedDocId = null;
  if (!value.settings?.baseUrl || value.settings.baseUrl === "http://localhost:1234/v1") {
    merged.settings.baseUrl = defaultState.settings.baseUrl;
  }
  // toolsEnabled didn't exist in early versions. Default missing values to false:
  // web tools are expensive on local models and researcher-scoped when enabled.
  if (value.settings && typeof value.settings.toolsEnabled === "undefined") {
    merged.settings.toolsEnabled = false;
  }
  if (value.settings && typeof value.settings.globalStyleEnabled === "undefined" && typeof value.settings.plainLanguageDefault === "boolean") {
    merged.settings.globalStyleEnabled = value.settings.plainLanguageDefault;
  }
  if (typeof merged.settings.globalStylePrompt !== "string" || !merged.settings.globalStylePrompt.trim()) {
    merged.settings.globalStylePrompt = defaultState.settings.globalStylePrompt;
  }
  delete merged.settings.plainLanguageDefault;
  if (!VALID_TABS.includes(merged.ui.activeTab)) {
    merged.ui.activeTab = "";
  }
  if (merged.ui.quickStartDraft) {
    if (merged.ui.quickStartDraft.type === "patch") {
      // Keep patch draft as-is
    } else {
      merged.ui.quickStartDraft = normalizeQuickStartConfig(merged.ui.quickStartDraft, false);
    }
  }
  if (!Array.isArray(merged.memory.pendingPinnedFacts)) {
    merged.memory.pendingPinnedFacts = [];
  }
  if (!Array.isArray(merged.memory.pendingAnchors)) {
    merged.memory.pendingAnchors = [];
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
  // ── DM → Actor migration ──
  // If old state has a `dm` object, convert it into an actor with permissions
  if (merged.dm && typeof merged.dm === "object" && merged.dm.name) {
    const dmActor = {
      id: merged.dm.id || crypto.randomUUID(),
      name: merged.dm.name || "Director",
      role: "Discussion facilitator",
      persona: merged.dm.persona || "",
      goal: "Keep the conversation flowing and inclusive.",
      voice: "Calm, concise, neutral.",
      thoughts: merged.dm.thoughts || "",
      enabled: merged.dm.enabled !== false,
      expanded: false,
      color: "#c8a830",
      canDirect: true,
      canManageCast: true,
      canResearch: false,
      canSeeThoughts: !!merged.dm.seesPrivateThoughts,
      temperature: 0.8,
      relationships: {}
    };
    // Prepend Director to actors array if not already present
    const hasDirector = merged.actors.some(a => a.canDirect || a.name === merged.dm.name);
    if (!hasDirector) {
      merged.actors.unshift(dmActor);
    }
    delete merged.dm;
  }

  const scenarioDirectorMode = merged.scenario.systems?.dmRole?.role || 'facilitator';
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
    maxTokens: typeof actor.maxTokens === "number" && actor.maxTokens > 0 ? actor.maxTokens : undefined,
    temperature: typeof actor.temperature === "number" ? actor.temperature : 0.8,
    color: actor.color || colors[index % colors.length] || "#18726d",
    // Permissions — migrate old flags to new model
    canDirect: !!(actor.canDirect),
    canManageCast: !!(actor.canManageCast || actor.isManager),
    canResearch: !!(actor.canResearch || actor.isResearcher),
    canSeeThoughts: !!(actor.canSeeThoughts),
    canInject: !!(actor.canInject),
    canWriteDocuments: !!(actor.canWriteDocuments || actor.isWriter),
    directorMode: actor.directorMode || ((actor.canDirect || actor.isDirector) ? scenarioDirectorMode : 'facilitator'),
    authority: typeof actor.authority === "number" ? Math.max(0, Math.min(100, actor.authority)) : 50,
    // Scheduling: migrate the legacy four-way turnSchedule enum to the cadence
    // model. Queue participants have cadence: null; background/periodic actors
    // have { unit: 'turn'|'round', n }. See utils.normalizeCadence.
    // The legacy 'on_every_turn' trigger is redundant with a turn cadence — fold
    // it in so periodic firing has exactly one source of truth (the cadence).
    cadence: migrateEveryTurnTrigger(actor),
    // Built-in/template directors were briefly saved as background actors, which
    // made them run hidden orchestration hooks instead of visible Director turns.
    actorMode: (actor.canDirect || actor.isDirector) && actor.actorMode === 'background' ? 'participant' : (actor.actorMode || 'participant'),
    // Event triggers (genuine events only — periodic firing is the cadence's job,
    // so 'on_every_turn' is filtered out here as part of the Phase 6 unification).
    triggerOn: Array.isArray(actor.triggerOn) ? actor.triggerOn.filter(t => t !== 'on_every_turn') : [],
  }));
  const writerId = merged.documentWriting?.designatedWriterId;
  const writerActive = writerId && merged.actors.some(a => a.id === writerId && a.enabled && a.canWriteDocuments);
  if (!writerActive) {
    const fallbackWriter = merged.actors.find(a => a.enabled && a.canWriteDocuments);
    merged.documentWriting.designatedWriterId = fallbackWriter?.id || "";
  }
  const validScribeModes = ["manual", "ask", "auto_review", "auto_apply"];
  if (!validScribeModes.includes(merged.documentWriting.scribeMode)) {
    merged.documentWriting.scribeMode = "auto_apply";
  }
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

export const state = loadState();

export function setState(newState) {
  for (const key of Object.keys(state)) {
    delete state[key];
  }
  Object.assign(state, newState);
}

// Callback registered by useForumState to notify React on every save.
let _onSaveCallback = null;
export function registerSaveCallback(fn) {
  _onSaveCallback = fn;
}

export function saveState() {
  const { messages, autoRunning, ...persisted } = state;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...persisted, messages: [] }));
  } catch (err) {
    // Most likely QuotaExceededError — large diagnostics logs and/or imported
    // PR diffs in documents can blow the localStorage budget. Shed the heaviest
    // disposable arrays and retry once before giving up.
    try {
      const trimmed = {
        ...persisted,
        messages: [],
        diagnostics: { ...(persisted.diagnostics || {}), apiCallLogs: [], transitions: [] },
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (err2) {
      console.warn('[state] saveState failed (storage quota?):', err2.message);
    }
  }
  if (_onSaveCallback) _onSaveCallback();
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
