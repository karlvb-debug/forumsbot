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
export const WORD_LIMITS = {
  sharedSummary: 520,
  openQuestions: 260,
  dmState: 320,
  actorMemory: 260,
  relationship: 30,   // per-actor relationship note (short — injected into every prompt)
  chunk: 180,
  recentTranscript: 2600
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
export const DEFAULT_GLOBAL_STYLE_PROMPT = "Use plain everyday language unless the user, scenario, or actor voice asks for a different style. Prefer short common words, concrete claims, and direct sentences. Avoid ornate, academic, or thesaurus-like wording.";

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
    toolsEnabled: false,
    globalStyleEnabled: true,
    globalStylePrompt: DEFAULT_GLOBAL_STYLE_PROMPT,
    theme: "dark",
    includeTraces: true,

    // Cross-Session Actor Memory. Default OFF: when on, each actor's accumulated
    // memory is distilled once at session end (not per turn).
    enableCrossSessionMemory: false,
    // Streaming: show tokens as they arrive for actor/DM turns
    streamingEnabled: true,
    // Turbo Mode: skip memory cycles, thoughts, alignment, and cross-session memory
    turboMode: false,
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
    assistantOpen: false,       // AI assistant drawer open/closed
    pauseModal: null,           // { pauseRecord } — set by promptPause()
    awaitingUserInput: false,   // true while a pause modal is open
    focusedDocId: null,          // when set, stage shows the document editor
    continueMode: "next"         // "next" | "round" | "auto" — what empty composer Continue does
  },
  memory: {
    enabled: true,
    pinnedFacts: [],
    sharedSummary: "",
    openQuestions: [],
    dmState: "",
    pendingPinnedFacts: [],
    pendingAnchors: [],    // anchor suggestions from DM, pending user approval
    cycleCount: 0,         // total summarization cycles run
    turnsSinceSummary: 0,
    lastSummaryMessageId: "",
    migratedLegacyMessages: false,
    archivedCount: 0,
    isSummarizing: false,
    isDistilling: false,
    distillingActor: ""
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
    outcomeExtractionLog: [] // Sprint 6: { at, attempt, success, error? }
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
    goalCheckEnabled: true,
    stopOnAllSkip: true,
    maxRoundsEnabled: false,
    maxRounds: 5,
    roundsRun: 0,
    status: "Auto-stop ready."
  },
  documentWriting: {
    designatedWriterId: "",
    scribeMode: "auto_apply"
  },
  documents: [],
  documentTasks: [],
  pendingDocumentEdits: [],
  pendingInjections: [],     // CAP-1: director prompt injection queue
  pendingPrivateMessages: [], // CAP-2: actor-to-actor private message queue
  pendingStyleUpdate: null,  // Phase 3: pending global style proposal awaiting user approval
  scenario: {
    title: "Untitled forum",
    premise: "",
    task: "",
    doneWhen: "",
    systems: {
      stageDirections: {
        enabled: false,
        intensity: "moderate",    // "minimal" | "moderate" | "immersive"
        maxTokenShare: 0.2
      },
      alignment: {
        strictness: "moderate",   // "strict" | "moderate" | "loose" | "off"
      },
      turnRouting: {
        strategy: "sequential",  // "sequential" | "agentic"
        allowDirectAddress: true
      },
      dmRole: {
        role: "facilitator",      // "narrator" | "facilitator" | "arbiter" | "observer"
        narrates: false,
        canIntroduceElements: false
      }
    }
  },
  actors: [
    {
      id: crypto.randomUUID(),
      name: "Director",
      role: "Discussion facilitator",
      expanded: false,
      persona: "Keep the scene moving, summarize when useful, and invite quieter actors in without taking over.",
      goal: "Keep the conversation flowing and inclusive.",
      voice: "Calm, concise, neutral.",
      thoughts: "",
      enabled: true,
      color: "#c8a830",
      // Permissions
      canDirect: true,
      canManageCast: true,
      canResearch: false,
      canSeeThoughts: false,
      canInject: true,
      canWriteDocuments: false,
      canPause: true,
      canAnchor: true,
      canPinFacts: true,
      canSuggestSpeaker: true,
      canUpdateStyle: true,
      directorMode: "facilitator",
      authority: 50,
      // Fire once per round, not per turn. A per-turn director re-runs after
      // every actor turn and looks like an infinite "responds again" loop.
      // Keep it visible by default so Director turns appear in the transcript.
      cadence: { unit: 'round', n: 1 },
      actorMode: 'background',
      triggerOn: ['on_conflict'],
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
      canSeeThoughts: false,
      canInject: false,
      canWriteDocuments: false,
      canPause: true,
      canAnchor: true,
      canPinFacts: true,
      canSuggestSpeaker: true,
      canUpdateStyle: true,
      authority: 50,
      cadence: null,
      actorMode: 'participant',
      triggerOn: [],
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
      canSeeThoughts: false,
      canInject: false,
      canWriteDocuments: false,
      canPause: true,
      canAnchor: true,
      canPinFacts: true,
      canSuggestSpeaker: true,
      canUpdateStyle: true,
      authority: 50,
      cadence: null,
      actorMode: 'participant',
      triggerOn: [],
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
      canSeeThoughts: false,
      canInject: false,
      canWriteDocuments: false,
      canPause: true,
      canAnchor: true,
      canPinFacts: true,
      canSuggestSpeaker: true,
      canUpdateStyle: true,
      authority: 50,
      cadence: null,
      actorMode: 'participant',
      triggerOn: [],
    }
  ],
  messages: [],
  turnQueue: [],
  currentRound: 0,
  autoRunning: false,
  // Sprint 7: Conceptual Anchors — settled group agreements, injected into every prompt
  anchors: [],  // [{ id, text, speaker, color, messageId, createdAt }]
  // UserContext — who the user is in this session
  userContext: {
    displayName: "",
    interactionMode: "collaborator",  // "sponsor" | "collaborator" | "observer"
    storyRole: "",                    // optional character name in story sessions
    pausePolicy: {
      allowedReasons: ["decision", "conflict", "question", "clarification", "information"],
      maxPausesPerRound: 2,
    }
  },
  pendingPauses: [],  // PauseRecord[]
  // Runtime-only: not persisted between sessions
  contextInfo: {
    maxContextLength: 0,      // fetched from /api/v0/models
    lastPromptTokens: 0,      // from usage.prompt_tokens in last chat response
    lastCompletionTokens: 0
  }
};
