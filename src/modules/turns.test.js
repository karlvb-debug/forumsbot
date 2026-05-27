import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted() runs before all vi.mock() factories, making mockState safe to reference inside them.
const { mockState } = vi.hoisted(() => {
  const mockState = {
    scenario: {
      mode: 'problem',
      title: 'Test Forum',
      premise: 'Test premise',
      objective: 'Test objective',
      systems: {},
    },
    userContext: {
      interactionMode: 'collaborator',
      displayName: '',
      storyRole: '',
      pausePolicy: {},
    },
    actors: [],
    messages: [],
    memory: { pinnedFacts: [], sharedSummary: '', openQuestions: [], dmState: '', pendingAnchors: [] },
    pendingInjections: [],
    pendingPrivateMessages: [],
    pendingPauses: [],
    autoStop: { enabled: false, goal: '', goalCheckEnabled: false, stopOnAllSkip: false, maxRoundsEnabled: false, maxRounds: 5, roundsRun: 0 },
    settings: { temperature: 0.8, maxTokens: 2000, topP: 1.0, repeatPenalty: 1.1, toolsEnabled: false, turboMode: false, enablePreflightRouter: false, enableHypothesisSampling: false, streamingEnabled: false, enableCrossSessionMemory: false, enableAdaptiveCompression: false },
    ui: { stopModal: null, pauseModal: null, awaitingUserInput: false, currentSpeaker: '' },
    diagnostics: { qualitySignals: [] },
    documents: [],
  };
  return { mockState };
});

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('./constants.js', () => ({
  RECENT_MESSAGE_LIMIT: 80,
  PROMPT_MESSAGE_LIMIT: 20,
  RECALLED_CHUNK_LIMIT: 6,
  PINNED_FACTS_WORD_CAP: 300,
  ANCHOR_WORD_CAP: 400,
  DELTA_REWRITE_EVERY: 4,
  WORD_LIMITS: { sharedSummary: 520, openQuestions: 260, dmState: 320, actorMemory: 260, relationship: 30, chunk: 180, recentTranscript: 2600, cycleDelta: 120 },
  colors: ['#18726d', '#b84738'],
  AVAILABLE_TOOLS: [],
  MAX_TOOL_ROUNDS: 3,
}));

vi.mock('./state.js', () => ({
  state: mockState,
  saveState: vi.fn(),
  logTransition: vi.fn(),
  logWarning: vi.fn(),
  registerSaveCallback: vi.fn(),
}));

vi.mock('./api.js', () => ({
  setStatus: vi.fn(),
  chatJson: vi.fn(),
  chatCompletion: vi.fn(),
  setCurrentSpeaker: vi.fn(),
  getLastToolCalls: vi.fn(() => []),
}));

vi.mock('../hooks/useForumState.js', () => ({
  saveState: vi.fn(),
  notifyStateChange: vi.fn(),
  mutateState: vi.fn((fn) => fn(mockState)),
}));

vi.mock('../hooks/useActions.js', () => ({
  setBusy: vi.fn(),
  getBusy: vi.fn(() => false),
}));

vi.mock('../hooks/useStreaming.js', () => ({
  showStreamingBubble: vi.fn(),
  updateStreamingBubble: vi.fn(),
  removeStreamingBubble: vi.fn(),
  forceRemoveStreamingBubble: vi.fn(),
}));

vi.mock('./db.js', () => ({
  putMessage: vi.fn(),
  getAllChunks: vi.fn(async () => []),
  getActorMemory: vi.fn(async () => null),
  putActorMemory: vi.fn(),
  getAllMessages: vi.fn(async () => []),
}));

vi.mock('./memory.js', () => ({
  summarizeMemory: vi.fn(),
  recallRelevantChunks: vi.fn(async () => []),
  formatCurrentOutcomes: vi.fn(() => 'None.'),
  parseOutcomeJson: vi.fn(),
  extractOutcomes: vi.fn(),
}));

vi.mock('./telemetry.js', () => ({
  calculateTurnMetrics: vi.fn(() => ({})),
  updateSemanticAlignment: vi.fn(),
  calculateToolUsefulness: vi.fn(() => 0),
  calculateInfluenceBudget: vi.fn(() => ({})),
  alignLineAttributions: vi.fn(() => []),
}));

vi.mock('./preflight.js', () => ({
  preflightSkipCheck: vi.fn(async () => false),
}));

vi.mock('./knowledge.js', () => ({
  getKbEntriesForDirector: vi.fn(async () => []),
  splitDocuments: vi.fn(() => ({ editable: [], reference: [] })),
  buildEditableDocSection: vi.fn(() => ''),
  buildReferenceSection: vi.fn(() => ''),
  buildKbSection: vi.fn(() => ''),
}));

// ── Import after mocks ────────────────────────────────────────────────────────
import { resolvePolicy, resolveSystemSettings, scenarioBlock } from './turns.js';

// ── resolvePolicy ─────────────────────────────────────────────────────────────
describe('resolvePolicy', () => {
  it('returns collaborator defaults for null/undefined', () => {
    const policy = resolvePolicy(null);
    expect(policy.allowedReasons).toContain('question');
    expect(policy.allowedReasons).toContain('decision');
    expect(policy.maxPausesPerRound).toBe(2);
    expect(policy.honoredWindow).toBe(0);
  });

  it('returns collaborator defaults when interactionMode is omitted', () => {
    const policy = resolvePolicy({});
    expect(policy.allowedReasons).toHaveLength(5);
    expect(policy.maxPausesPerRound).toBe(2);
  });

  it('observer mode — no allowed reasons, zero pauses', () => {
    const policy = resolvePolicy({ interactionMode: 'observer' });
    expect(policy.allowedReasons).toEqual([]);
    expect(policy.maxPausesPerRound).toBe(0);
    expect(policy.honoredWindow).toBe(Infinity);
  });

  it('sponsor mode — only decision + conflict', () => {
    const policy = resolvePolicy({ interactionMode: 'sponsor' });
    expect(policy.allowedReasons).toEqual(['decision', 'conflict']);
    expect(policy.allowedReasons).not.toContain('question');
    expect(policy.maxPausesPerRound).toBe(1);
    expect(policy.honoredWindow).toBe(60000);
  });

  it('collaborator mode — all 5 reasons', () => {
    const policy = resolvePolicy({ interactionMode: 'collaborator' });
    expect(policy.allowedReasons).toEqual(['decision', 'conflict', 'question', 'clarification', 'information']);
    expect(policy.maxPausesPerRound).toBe(2);
    expect(policy.honoredWindow).toBe(0);
  });

  it('unknown mode falls back to collaborator', () => {
    const policy = resolvePolicy({ interactionMode: 'unknown-mode' });
    expect(policy.allowedReasons).toHaveLength(5);
    expect(policy.maxPausesPerRound).toBe(2);
  });

  it('custom pausePolicy overrides base defaults', () => {
    const policy = resolvePolicy({
      interactionMode: 'collaborator',
      pausePolicy: { maxPausesPerRound: 5, honoredWindow: 3000 },
    });
    expect(policy.maxPausesPerRound).toBe(5);
    expect(policy.honoredWindow).toBe(3000);
    expect(policy.allowedReasons).toHaveLength(5);
  });

  it('custom pausePolicy can override allowedReasons', () => {
    const policy = resolvePolicy({
      interactionMode: 'sponsor',
      pausePolicy: { allowedReasons: ['decision', 'conflict', 'question'] },
    });
    expect(policy.allowedReasons).toContain('question');
    expect(policy.allowedReasons).toHaveLength(3);
  });
});

// ── resolveSystemSettings ─────────────────────────────────────────────────────
describe('resolveSystemSettings', () => {
  beforeEach(() => {
    mockState.scenario = { mode: 'problem', systems: {} };
  });

  it('problem mode — stageDirections off, alignment strict, facilitator DM', () => {
    const s = resolveSystemSettings();
    expect(s.stageDirectionsEnabled).toBe(false);
    expect(s.alignmentStrictness).toBe('strict');
    expect(s.dmNarrates).toBe(false);
    expect(s.dmRole).toBe('facilitator');
    expect(s.documentSchema).toBe('findings');
  });

  it('story mode — stageDirections on by default, DM narrates, narrator role', () => {
    mockState.scenario.mode = 'story';
    const s = resolveSystemSettings();
    expect(s.stageDirectionsEnabled).toBe(true);
    expect(s.dmNarrates).toBe(true);
    expect(s.dmRole).toBe('narrator');
    expect(s.documentSchema).toBe('story-bible');
  });

  it('freeform mode — does NOT inherit story defaults', () => {
    mockState.scenario.mode = 'freeform';
    const s = resolveSystemSettings();
    expect(s.stageDirectionsEnabled).toBe(false);
    expect(s.dmNarrates).toBe(false);
    expect(s.dmRole).toBe('facilitator');
    expect(s.documentSchema).toBe('freeform');
  });

  it('explicit systems override mode defaults', () => {
    mockState.scenario.systems = {
      stageDirections: { enabled: true, intensity: 'immersive', maxTokenShare: 0.4 },
      dmRole: { role: 'narrator', narrates: true },
      alignment: { strictness: 'loose' },
      document: { schema: 'story-bible' },
    };
    const s = resolveSystemSettings();
    expect(s.stageDirectionsEnabled).toBe(true);
    expect(s.stageDirectionsIntensity).toBe('immersive');
    expect(s.stageDirectionsMaxShare).toBe(0.4);
    expect(s.dmNarrates).toBe(true);
    expect(s.dmRole).toBe('narrator');
    expect(s.alignmentStrictness).toBe('loose');
    expect(s.documentSchema).toBe('story-bible');
  });

  it('partial systems overrides fall through to mode defaults', () => {
    mockState.scenario.mode = 'story';
    mockState.scenario.systems = {
      stageDirections: { enabled: false },
    };
    const s = resolveSystemSettings();
    expect(s.stageDirectionsEnabled).toBe(false);
    expect(s.dmNarrates).toBe(true); // story mode default still applies
  });

  it('alignment strictness defaults to moderate for freeform', () => {
    mockState.scenario.mode = 'freeform';
    mockState.scenario.systems = {};
    const s = resolveSystemSettings();
    expect(s.alignmentStrictness).toBe('moderate');
  });
});

// ── scenarioBlock ─────────────────────────────────────────────────────────────
describe('scenarioBlock', () => {
  beforeEach(() => {
    mockState.scenario = { mode: 'problem', title: 'My Forum', premise: 'Test premise', objective: 'Test objective', systems: {} };
    mockState.userContext = { interactionMode: 'collaborator', displayName: '', storyRole: '', pausePolicy: {} };
  });

  it('includes mode, title, premise, objective', () => {
    const block = scenarioBlock();
    expect(block).toContain('Mode: Problem');
    expect(block).toContain('Title: My Forum');
    expect(block).toContain('Premise: Test premise');
    expect(block).toContain('Objective: Test objective');
  });

  it('no user line when displayName and storyRole are empty', () => {
    const block = scenarioBlock();
    expect(block).not.toContain('human participant');
  });

  it('displayName only — injected as user label', () => {
    mockState.userContext.displayName = 'Alice';
    const block = scenarioBlock();
    expect(block).toContain('human participant in this session is: Alice');
  });

  it('storyRole only — injected without parenthetical', () => {
    mockState.userContext.storyRole = 'The Mayor';
    const block = scenarioBlock();
    expect(block).toContain('human participant in this session is: The Mayor');
    expect(block).not.toContain('(');
  });

  it('storyRole + displayName — storyRole (displayName)', () => {
    mockState.userContext.storyRole = 'The Mayor';
    mockState.userContext.displayName = 'Alice';
    const block = scenarioBlock();
    expect(block).toContain('human participant in this session is: The Mayor (Alice)');
  });

  it('omits premise line when empty', () => {
    mockState.scenario.premise = '';
    const block = scenarioBlock();
    expect(block).not.toContain('Premise:');
  });

  it('omits objective line when empty', () => {
    mockState.scenario.objective = '';
    const block = scenarioBlock();
    expect(block).not.toContain('Objective:');
  });

  it('falls back to "Untitled forum" when title is blank', () => {
    mockState.scenario.title = '';
    const block = scenarioBlock();
    expect(block).toContain('Title: Untitled forum');
  });

  it('includes [USER] label hint in user line', () => {
    mockState.userContext.displayName = 'Bob';
    const block = scenarioBlock();
    expect(block).toContain('[USER]');
  });
});

// ── applyAiResult ─────────────────────────────────────────────────────────────
import { applyAiResult } from './turns.js';

describe('applyAiResult', () => {
  beforeEach(() => {
    mockState.actors = [
      {
        id: 'manager-id',
        name: 'Manager',
        role: 'Roster Orchestrator',
        canManageCast: true,
        color: '#1a7a6e',
      }
    ];
    mockState.messages = [];
    mockState.turnQueue = ['manager-id'];
  });

  it('creates new actors via applyAiResult with custom permissions, authority, and temperature', async () => {
    const result = {
      action: 'speak',
      message: 'I have created specialist Bob for you.',
      manageActors: {
        create: [
          {
            name: 'Bob',
            role: 'Scientist',
            persona: 'Analytical',
            goal: 'Solve problems',
            voice: 'Monotone',
            canResearch: true,
            canDirect: true,
            authority: 80,
            temperature: 0.5,
          }
        ]
      }
    };

    const participant = { data: mockState.actors[0] };
    await applyAiResult(participant, result);

    expect(mockState.actors).toHaveLength(2);
    const bob = mockState.actors.find(a => a.name === 'Bob');
    expect(bob).toBeDefined();
    expect(bob.role).toBe('Scientist');
    expect(bob.canResearch).toBe(true);
    expect(bob.canDirect).toBe(true);
    expect(bob.authority).toBe(80);
    expect(bob.temperature).toBe(0.5);
  });
});
