import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted() runs before all vi.mock() factories, making mockState safe to reference inside them.
const { mockState } = vi.hoisted(() => {
  const mockState = {
    scenario: {
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
    settings: { temperature: 0.8, maxTokens: 2000, topP: 1.0, repeatPenalty: 1.1, toolsEnabled: false, turboMode: false, enablePreflightRouter: false, streamingEnabled: false, enableCrossSessionMemory: false, enableAdaptiveCompression: false },
    ui: { stopModal: null, pauseModal: null, awaitingUserInput: false, currentSpeaker: '' },
    diagnostics: {},
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
  chatStructured: vi.fn(),
  chatCompletion: vi.fn(),
  setCurrentSpeaker: vi.fn(),
  getLastToolCalls: vi.fn(() => []),
  isJsonSchemaSupported: vi.fn(() => false),
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
  updateSemanticAlignment: vi.fn(),
  alignLineAttributions: vi.fn(() => []),
}));

vi.mock('./preflight.js', () => ({
  preflightSkipCheck: vi.fn(async () => false),
}));

vi.mock('./knowledge.js', () => ({
  getKbEntriesForDirector: vi.fn(async () => []),
  splitDocuments: vi.fn(() => ({ editable: [], reference: [] })),
  buildDocumentManifestSection: vi.fn(() => ''),
  buildReferenceSection: vi.fn(() => ''),
  buildKbSection: vi.fn(() => ''),
}));

// ── Import after mocks ────────────────────────────────────────────────────────
import { resolvePolicy, resolveSystemSettings, scenarioBlock, sanitizeSpeakingPlan } from './turns.js';
import { extractOutcomes } from './memory.js';

// ── resolvePolicy ─────────────────────────────────────────────────────────────
describe('resolvePolicy', () => {
  it('returns collaborator defaults for null/undefined', () => {
    const policy = resolvePolicy(null);
    expect(policy.allowedReasons).toContain('question');
    expect(policy.allowedReasons).toContain('decision');
    expect(policy.maxPausesPerRound).toBe(2);
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
  });

  it('sponsor mode — only decision + conflict', () => {
    const policy = resolvePolicy({ interactionMode: 'sponsor' });
    expect(policy.allowedReasons).toEqual(['decision', 'conflict']);
    expect(policy.allowedReasons).not.toContain('question');
    expect(policy.maxPausesPerRound).toBe(1);
  });

  it('collaborator mode — all 5 reasons', () => {
    const policy = resolvePolicy({ interactionMode: 'collaborator' });
    expect(policy.allowedReasons).toEqual(['decision', 'conflict', 'question', 'clarification', 'information']);
    expect(policy.maxPausesPerRound).toBe(2);
  });

  it('unknown mode falls back to collaborator', () => {
    const policy = resolvePolicy({ interactionMode: 'unknown-mode' });
    expect(policy.allowedReasons).toHaveLength(5);
    expect(policy.maxPausesPerRound).toBe(2);
  });

  it('custom pausePolicy overrides base defaults', () => {
    const policy = resolvePolicy({
      interactionMode: 'collaborator',
      pausePolicy: { maxPausesPerRound: 5 },
    });
    expect(policy.maxPausesPerRound).toBe(5);
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
    mockState.scenario = { systems: {} };
    mockState.actors = [];
  });

  it('uses explicit defaults when no systems are configured', () => {
    const s = resolveSystemSettings();
    expect(s.stageDirectionsEnabled).toBe(false);
    expect(s.alignmentStrictness).toBe('moderate');
    expect(s.dmNarrates).toBe(false);
    expect(s.dmRole).toBe('facilitator');
    expect(s.turnStrategy).toBe('sequential');
    expect(s.allowDirectAddress).toBe(true);
  });

  it('explicit systems are respected', () => {
    mockState.scenario.systems = {
      stageDirections: { enabled: true, intensity: 'immersive', maxTokenShare: 0.4 },
      dmRole: { role: 'narrator', narrates: true },
      alignment: { strictness: 'loose' },
    };
    const s = resolveSystemSettings();
    expect(s.stageDirectionsEnabled).toBe(true);
    expect(s.stageDirectionsIntensity).toBe('immersive');
    expect(s.stageDirectionsMaxShare).toBe(0.4);
    expect(s.dmNarrates).toBe(true);
    expect(s.dmRole).toBe('narrator');
    expect(s.alignmentStrictness).toBe('loose');
  });

  it('a director actor directorMode overrides scenario dmRole', () => {
    mockState.scenario.systems = {
      dmRole: { role: 'narrator', narrates: true },
    };
    mockState.actors = [{ id: 'd1', name: 'Director', enabled: true, canDirect: true, directorMode: 'arbiter' }];
    const s = resolveSystemSettings();
    expect(s.dmRole).toBe('arbiter');
    expect(s.dmNarrates).toBe(false);
  });

  it('partial systems fall back to explicit defaults', () => {
    mockState.scenario.systems = {
      stageDirections: { enabled: false },
    };
    const s = resolveSystemSettings();
    expect(s.stageDirectionsEnabled).toBe(false);
    expect(s.dmNarrates).toBe(false);
  });

  it('alignment strictness defaults to moderate', () => {
    mockState.scenario.systems = {};
    const s = resolveSystemSettings();
    expect(s.alignmentStrictness).toBe('moderate');
  });

  it('normalizes legacy routing names to agentic speaking order', () => {
    mockState.scenario.systems = { turnRouting: { strategy: 'dm-directed', allowDirectAddress: false } };
    const s = resolveSystemSettings();
    expect(s.turnStrategy).toBe('agentic');
    expect(s.allowDirectAddress).toBe(false);
  });
});

// ── scenarioBlock ─────────────────────────────────────────────────────────────
describe('scenarioBlock', () => {
  beforeEach(() => {
    mockState.scenario = { title: 'My Forum', premise: 'Test premise', objective: 'Test objective', systems: {} };
    mockState.userContext = { interactionMode: 'collaborator', displayName: '', storyRole: '', pausePolicy: {} };
  });

  it('includes title, premise, objective without a mode line', () => {
    const block = scenarioBlock();
    expect(block).toContain('Title: My Forum');
    expect(block).toContain('Premise: Test premise');
    expect(block).toContain('Objective: Test objective');
    expect(block).not.toContain('Mode:');
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
import { applyAiResult, fireUserMessageTriggers, runRound, stopGeneration } from './turns.js';
import { chatJson } from './api.js';

describe('applyAiResult', () => {
  beforeEach(() => {
    mockState.actors = [
      {
        id: 'manager-id',
        name: 'Manager',
        role: 'Roster Orchestrator',
        canManageCast: true,
        enabled: true,
        color: '#1a7a6e',
      }
    ];
    mockState.messages = [];
    mockState.turnQueue = ['manager-id'];
    mockState.scenario = { systems: { turnRouting: { strategy: 'sequential', allowDirectAddress: true } } };
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

  it('does not honor nextSpeaker when direct addressing is disabled', async () => {
    mockState.scenario = { systems: { turnRouting: { allowDirectAddress: false } } };
    mockState.actors = [
      { id: 'a1', name: 'Alice', role: 'Participant', enabled: true, color: '#18726d' },
      { id: 'a2', name: 'Bob', role: 'Participant', enabled: true, color: '#b84738' },
    ];
    mockState.turnQueue = ['a1', 'a2'];

    await applyAiResult({ data: mockState.actors[0] }, {
      action: 'speak',
      message: 'Bob should go next.',
      nextSpeaker: 'Bob',
    });

    expect(mockState.turnQueue).toEqual(['a1', 'a2']);
  });

  it('preserves queue rotation when a manager changes the cast during its turn', async () => {
    mockState.actors = [
      { id: 'manager-id', name: 'Manager', role: 'Roster Orchestrator', canManageCast: true, enabled: true, color: '#1a7a6e' },
      { id: 'a1', name: 'Alice', role: 'Participant', enabled: true, color: '#18726d' },
      { id: 'a2', name: 'Bob', role: 'Participant', enabled: true, color: '#b84738' },
    ];
    mockState.turnQueue = ['manager-id', 'a1', 'a2'];

    const participant = nextParticipant();
    expect(participant.data.id).toBe('manager-id');
    expect(mockState.turnQueue).toEqual(['a1', 'a2', 'manager-id']);

    await applyAiResult(participant, {
      action: 'speak',
      message: 'Adding a specialist.',
      manageActors: {
        create: [{ name: 'Carol', role: 'Specialist' }]
      }
    });

    expect(mockState.turnQueue[0]).toBe('a1');
    expect(nextParticipant().data.id).toBe('a1');
  });

  it('does not fire the same director for both user-message trigger and immediate round cadence', async () => {
    chatJson.mockReset();
    chatJson.mockResolvedValue({ action: 'speak', thought: '', message: 'ok' });
    mockState.settings.model = 'test-model';
    mockState.actors = [
      {
        id: 'director-id',
        name: 'Showrunner',
        role: 'Lead Editor',
        enabled: true,
        canDirect: true,
        canInject: true,
        actorMode: 'background',
        cadence: { unit: 'round', n: 1 },
        triggerOn: ['on_user_message'],
        color: '#c8a830',
      },
      { id: 'a1', name: 'Concept Developer', role: 'Premise', enabled: true, cadence: null, color: '#18726d' },
    ];
    mockState.messages = [{ type: 'user', speaker: 'You', content: 'Brainstorm ideas.' }];
    mockState.turnQueue = [];
    mockState.currentRound = 0;

    await fireUserMessageTriggers('Brainstorm ideas.');
    await runRound();

    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(mockState.messages.some(m => m.speaker === 'Concept Developer')).toBe(true);
  });
});

describe('outcome extraction trigger policy', () => {
  beforeEach(() => {
    extractOutcomes.mockClear();
    mockState.autoRunning = true;
  });

  it('does not extract outcomes automatically when stopping generation', () => {
    stopGeneration();
    expect(extractOutcomes).not.toHaveBeenCalled();
  });
});

// ── nextParticipant @mention routing ──────────────────────────────────────────
import { nextParticipant } from './turns.js';

describe('nextParticipant @mention routing', () => {
  beforeEach(() => {
    mockState.actors = [
      { id: 'a1', name: 'Alice', enabled: true, turnSchedule: 'normal' },
      { id: 'a2', name: 'Bob', enabled: true, turnSchedule: 'normal' },
      { id: 'a3', name: 'Carol', enabled: true, turnSchedule: 'normal' },
    ];
    mockState.turnQueue = ['a1', 'a2', 'a3'];
    mockState.currentRound = 0;
    mockState.ui.mentionTarget = null;
  });

  it('routes the mentioned actor to speak next without duplicating them in the queue', () => {
    mockState.ui.mentionTarget = 'a3';
    const result = nextParticipant();

    // Carol speaks now…
    expect(result.data.id).toBe('a3');
    // …and appears exactly once in the rotated queue (the bug pushed her twice,
    // letting her speak again immediately).
    const carolCount = mockState.turnQueue.filter(id => id === 'a3').length;
    expect(carolCount).toBe(1);
    expect(mockState.ui.mentionTarget).toBeNull();
  });

  it('rotates normally when no actor is mentioned', () => {
    const result = nextParticipant();
    expect(result.data.id).toBe('a1');
    expect(mockState.turnQueue.filter(id => id === 'a1').length).toBe(1);
  });
});

// ── Cadence-based queue membership (Phase 6) ──────────────────────────────────
import { buildTurnQueue, participantCycleCount } from './turns.js';

describe('buildTurnQueue — cadence scheduling', () => {
  beforeEach(() => {
    mockState.scenario = { systems: { turnRouting: { strategy: 'sequential' } } };
  });

  it('excludes background and cadence actors from the queue', () => {
    mockState.actors = [
      { id: 'd1', name: 'Director', enabled: true, cadence: { unit: 'turn', n: 1 }, actorMode: 'background' },
      { id: 'a1', name: 'Alice', enabled: true, cadence: null },
      { id: 'a2', name: 'Bob', enabled: true, cadence: null },
      { id: 'r1', name: 'Rounder', enabled: true, cadence: { unit: 'round', n: 2 } },
    ];
    mockState.turnQueue = [];
    const queue = buildTurnQueue();
    expect(queue).toEqual(['a1', 'a2']);
    expect(participantCycleCount()).toBe(2);
  });

  it('migrates legacy turnSchedule on raw actors via isQueueActor', () => {
    mockState.actors = [
      { id: 'd1', name: 'Director', enabled: true, turnSchedule: 'every-turn' },
      { id: 'a1', name: 'Alice', enabled: true, turnSchedule: 'normal' },
    ];
    mockState.turnQueue = [];
    expect(buildTurnQueue()).toEqual(['a1']);
  });
});

describe('sanitizeSpeakingPlan', () => {
  it('keeps only eligible unique actor names or ids', () => {
    const eligible = [
      { id: 'a1', name: 'Alice' },
      { id: 'a2', name: 'Bob' },
    ];
    expect(sanitizeSpeakingPlan(['Bob', 'missing', 'a1', 'bob'], eligible)).toEqual(['a2', 'a1']);
  });

  it('returns null when the router did not return an array', () => {
    expect(sanitizeSpeakingPlan('Alice', [{ id: 'a1', name: 'Alice' }])).toBeNull();
  });
});
