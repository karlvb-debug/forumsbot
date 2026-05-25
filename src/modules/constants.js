export const STORAGE_KEY = "forum-state-v1";
export const PRESET_VERSION = 1;
export const DB_NAME = "forum-memory";
export const DB_VERSION = 6;
export const MESSAGE_STORE = "messages";
export const CHUNK_STORE = "chunks";
export const ACTOR_MEMORY_STORE = "actor-memory";
export const SESSION_STORE = "sessions";
export const KB_STORE = "knowledge-base";
export const RECENT_MESSAGE_LIMIT = 80;
export const PROMPT_MESSAGE_LIMIT = 20;
export const RECALLED_CHUNK_LIMIT = 6;
export const PINNED_FACTS_WORD_CAP = 300; // ~40 facts; above this, offer compaction
export const ANCHOR_WORD_CAP = 400;       // Sprint 7: max words injected from anchors
export const DELTA_REWRITE_EVERY = 4;   // full summary rewrite every N delta cycles
export const WORD_LIMITS = {
  sharedSummary: 520,
  openQuestions: 260,
  dmState: 320,
  actorMemory: 260,
  relationship: 30,   // per-actor relationship note (short — injected into every prompt)
  chunk: 180,
  recentTranscript: 2600,
  cycleDelta: 120
};
export const VALID_TABS = ["setup", "conversation", "memory"];

export const colors = ["#18726d", "#b84738", "#a2611a", "#355f9f", "#6e4c99", "#4f7d2d", "#9a4668"];

export const AVAILABLE_TOOLS = [
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
      name: "web_read",
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
export const MAX_TOOL_ROUNDS = 3;

export const defaultState = {
  settings: {
    provider: "lm-studio",
    baseUrl: "http://127.0.0.1:1234",
    apiKey: "lm-studio",
    model: "",
    embeddingModel: "",
    temperature: 0.8,
    maxTokens: 2000,
    topP: 1.0,
    repeatPenalty: 1.1,
    seed: -1,
    seedEnabled: false,
    showThoughts: false,
    toolsEnabled: true,
    theme: "dark",
    includeTraces: true,
    gravitySensitivity: 50,
    // Sprint 5: Preflight Skip Router
    enablePreflightRouter: true,
    preflightThreshold: 0.35,
    // Sprint 5: Parallel Hypothesis Sampling
    enableHypothesisSampling: false,
    hypothesisSampleCount: 2,
    hypothesisAutoSelect: true,
    // Sprint 6: Cross-Session Actor Memory
    enableCrossSessionMemory: true,
    // Sprint 7: Influence Budget
    showInfluenceBars: false,
    // Streaming: show tokens as they arrive for actor/DM turns
    streamingEnabled: true,
    // Turbo Mode: skip memory cycles, thoughts, alignment, and cross-session memory
    turboMode: false,
    // Adaptive compression: LLM micro-summarize private memory when prompt is over budget
    enableAdaptiveCompression: true,
    // KV cache: freeze transcript at round start so all actors share a byte-identical prefix
    roundSnapshotEnabled: true,
    // Pause between turns when auto-running (seconds, 0 = instant)
    turnDelay: 0
  },
  ui: {
    activeTab: "",
    quickStartPrompt: "",
    quickStartDraft: null,
    quickStartStatus: "No generated setup yet.",
    quickStartHistory: [],
    quickStartTemperature: 0.8,
    stopModal: null,            // { reason, suggestedGoal } — set by promptStopOrContinue
    confirmModal: null,         // { message, confirmLabel } — set by requestConfirm()
    embeddingProbeResult: null, // { ok, reason? } — set by pingConnection embedding probe
    currentSpeaker: "",         // name of actor currently generating
    assistantOpen: false        // AI assistant drawer open/closed
  },
  memory: {
    enabled: true,
    pinnedFacts: [],
    sharedSummary: "",
    openQuestions: [],
    dmState: "",
    pendingPinnedFacts: [],
    pendingAnchors: [],    // anchor suggestions from DM, pending user approval
    recentDeltas: [],      // short bullet summaries appended each cycle
    cycleCount: 0,         // total cycles since last full summary rewrite
    turnsSinceSummary: 0,
    lastSummaryMessageId: "",
    migratedLegacyMessages: false,
    archivedCount: 0,
    isSummarizing: false
  },
  telemetry: {
    objectiveEmbedding: null,
    embeddedObjectiveText: "",
    currentAlignmentScore: 100,
    alignmentMode: "none",      // "embedding" | "keyword" | "none" — shown in UI
    alignmentHistory: [],
    nudgeTriggered: false
  },
  diagnostics: {
    transitions: [],
    warnings: [],
    sessionsIndex: [],
    apiCallLogs: [],
    parseFailures: [],
    outcomeExtractionLog: []  // Sprint 6: { at, attempt, success, error? }
  },
  outcomes: {
    finalRecommendation: "",
    decisions: [],
    rationale: [],
    rejectedOptions: [],
    actionItems: [],
    risks: [],
    lastExtractedAt: "",
    lastExtractMessageId: "",
    status: "No outcomes extracted yet.",
    isExtracting: false,
    isExtractingOutcomes: false
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
  documents: [],
  scenario: {
    mode: "problem",
    title: "Design council",
    premise: "A small group of local AI actors are gathered to discuss the user's topic.",
    objective: "Ask clarifying questions, challenge weak assumptions, and converge on practical next steps."
  },
  actors: [
    {
      id: crypto.randomUUID(),
      name: "Director",
      role: "Discussion facilitator",
      expanded: false,
      persona: "Keep the scene moving, summarize when useful, and invite quieter actors in without taking over.",
      goal: "Guide the group toward clear decisions and next steps.",
      voice: "Calm, concise, neutral.",
      thoughts: "",
      enabled: true,
      color: "#c8a830",
      // Permissions
      canDirect: true,
      canManageCast: true,
      canResearch: false,
      canSeeThoughts: false
    },
    {
      id: crypto.randomUUID(),
      name: "Architect",
      role: "Systems thinker",
      expanded: false,
      persona: "You care about structure, tradeoffs, and how pieces fit together.",
      goal: "Turn messy ideas into a workable plan.",
      voice: "Calm, precise, concise.",
      thoughts: "",
      enabled: true,
      color: colors[0],
      canDirect: false,
      canManageCast: false,
      canResearch: false,
      canSeeThoughts: false
    },
    {
      id: crypto.randomUUID(),
      name: "Skeptic",
      role: "Risk spotter",
      expanded: false,
      persona: "You notice gaps, ambiguity, and hidden costs.",
      goal: "Prevent the group from accepting easy answers too quickly.",
      voice: "Direct but constructive.",
      thoughts: "",
      enabled: true,
      color: colors[1],
      canDirect: false,
      canManageCast: false,
      canResearch: false,
      canSeeThoughts: false
    },
    {
      id: crypto.randomUUID(),
      name: "Muse",
      role: "Creative spark",
      expanded: false,
      persona: "You look for surprising angles and emotionally resonant choices.",
      goal: "Add imaginative options that are still usable.",
      voice: "Warm, vivid, specific.",
      thoughts: "",
      enabled: true,
      color: colors[2],
      canDirect: false,
      canManageCast: false,
      canResearch: false,
      canSeeThoughts: false
    }
  ],
  messages: [],
  turnQueue: [],
  currentRound: 0,
  autoRunning: false,
  // Sprint 7: Conceptual Anchors — settled group agreements, injected into every prompt
  anchors: [],  // [{ id, text, speaker, color, messageId, createdAt }]
  // Runtime-only: not persisted between sessions
  contextInfo: {
    maxContextLength: 0,      // fetched from /api/v0/models
    lastPromptTokens: 0,      // from usage.prompt_tokens in last chat response
    lastCompletionTokens: 0
  }
};
