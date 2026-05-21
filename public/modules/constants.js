export const STORAGE_KEY = "forum-state-v1";
export const PRESET_VERSION = 1;
export const DB_NAME = "forum-memory";
export const DB_VERSION = 2;
export const MESSAGE_STORE = "messages";
export const CHUNK_STORE = "chunks";
export const RECENT_MESSAGE_LIMIT = 80;
export const PROMPT_MESSAGE_LIMIT = 20;
export const RECALLED_CHUNK_LIMIT = 6;
export const PINNED_FACTS_WORD_CAP = 300; // ~40 facts; above this, offer compaction
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
    baseUrl: "http://127.0.0.1:1234",
    apiKey: "lm-studio",
    model: "",
    temperature: 0.8,
    maxTokens: 1200,
    showThoughts: false,
    toolsEnabled: true,
    theme: "dark"
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
    recentDeltas: [],      // short bullet summaries appended each cycle
    cycleCount: 0,         // total cycles since last full summary rewrite
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
  document: {
    enabled: false,
    title: "Untitled Document",
    content: "",
    versions: [],
    maxVersions: 20
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
      expanded: false,
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
      expanded: false,
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
      expanded: false,
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
  autoRunning: false,
  // Runtime-only: not persisted between sessions
  contextInfo: {
    maxContextLength: 0,      // fetched from /api/v0/models
    lastPromptTokens: 0,      // from usage.prompt_tokens in last chat response
    lastCompletionTokens: 0
  }
};
