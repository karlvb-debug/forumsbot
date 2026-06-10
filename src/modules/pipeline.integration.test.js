/**
 * Pipeline integration harness — runs the REAL turn pipeline (state, api,
 * resolver, prompt assembly, result application) against a mock LM Studio.
 * Only global fetch is stubbed; no module mocks. This is the regression net
 * for prompt-assembly and orchestration refactors: it asserts turn order,
 * call counts, schema usage, and prompt-prefix stability across rounds.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { state, setState, normalizeState } from './state.js';
import { runRound, runSingleResponse, askActor } from './turns.js';

// ── Mock LM Studio ────────────────────────────────────────────────────────────

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Installs a fetch stub emulating the proxy endpoints. `envelopeFor(req, n)`
 * lets a test shape the model's reply per request; default is a plain speak
 * envelope. Returns the recorder: `chatCalls` holds every /api/chat request
 * payload in order.
 */
function installMockLmStudio({ envelopeFor = null } = {}) {
  const chatCalls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    if (url === '/api/chat') {
      const req = body.request;
      chatCalls.push(req);
      const content = envelopeFor
        ? envelopeFor(req, chatCalls.length)
        : JSON.stringify({ thought: `thinking ${chatCalls.length}`, action: 'speak', message: `message ${chatCalls.length}` });
      return jsonResponse({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      });
    }
    if (url === '/api/embeddings') {
      const inputs = Array.isArray(body.request?.input) ? body.request.input : ['x'];
      return jsonResponse({ data: inputs.map((_t, i) => ({ index: i, embedding: [0.1, 0.2, 0.3] })) });
    }
    if (url === '/api/models') return jsonResponse({ data: [{ id: 'test-model' }] });
    if (url === '/api/model-info') return jsonResponse({ data: [] });
    return jsonResponse({ error: `unmocked: ${url}` }, 404);
  }));
  return { chatCalls };
}

// ── Scenario setup ────────────────────────────────────────────────────────────

function actor(name, overrides = {}) {
  return {
    id: `id-${name.toLowerCase()}`,
    name,
    role: 'Participant',
    persona: `${name}'s persona.`,
    goal: '',
    voice: '',
    enabled: true,
    temperature: 0.7,
    ...overrides,
  };
}

function seedState({ actors, messages = [], scenario = {}, settings = {} } = {}) {
  const normalized = normalizeState({
    settings: {
      model: 'test-model',
      streamingEnabled: false,
      toolsEnabled: false,
      turboMode: false,
      intentPass: 'off',
      ...settings,
    },
    scenario: {
      title: 'Harness Forum',
      premise: 'A test premise.',
      task: 'Decide the test outcome.',
      ...scenario,
    },
    actors,
    messages,
  });
  setState(normalized);
  // Quiet the background machinery so call counts are deterministic.
  state.memory.enabled = false;
  state.autoStop.enabled = false;
  state.settings.enableCrossSessionMemory = false;
  // Pre-set a plan so round 1 doesn't fire the planning pre-pass call.
  state.scenario.plan = { steps: ['Open the topic', 'Decide'], currentStep: 0 };
  state.currentRound = 0;
  state.turnQueue = [];
}

function userMessage(content) {
  return {
    id: `user-${Math.random().toString(36).slice(2)}`,
    type: 'user',
    speaker: 'You',
    content,
    createdAt: new Date().toISOString(),
  };
}

function visibleMessages() {
  return state.messages.filter(m => m.type === 'actor' || m.type === 'dm' || m.type === 'skip');
}

const systemOf = (req) => req.messages.find(m => m.role === 'system')?.content || '';
const userOf = (req) => req.messages.find(m => m.role === 'user')?.content || '';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('pipeline integration (mock LM Studio)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('runs a full round: addressed actor first, then the remaining actor, one chat call each', async () => {
    const { chatCalls } = installMockLmStudio();
    seedState({
      actors: [actor('Alice'), actor('Bob')],
      messages: [userMessage('@Alice please open the discussion.')],
    });

    const ok = await runRound();

    expect(ok).toBe(true);
    const spoken = visibleMessages();
    expect(spoken.map(m => m.speaker)).toEqual(['Alice', 'Bob']);
    expect(spoken.map(m => m.type)).toEqual(['actor', 'actor']);
    // Exactly two generation calls — no hidden routing/judge/scribe calls.
    expect(chatCalls).toHaveLength(2);
    // Routing audit trail: Alice via @mention addressing, Bob as last eligible.
    expect(spoken[0].routeInfo?.reason).toBe('addressed');
    expect(spoken[1].routeInfo?.reason).toBe('only-one');
  });

  it('sends grammar-constrained envelopes and persona-bearing prompts', async () => {
    const { chatCalls } = installMockLmStudio();
    seedState({
      actors: [actor('Alice'), actor('Bob')],
      messages: [userMessage('@Alice start please.')],
    });

    await runRound();

    for (const req of chatCalls) {
      expect(req.model).toBe('test-model');
      expect(req.response_format?.type).toBe('json_schema');
      expect(req.response_format.json_schema.schema.required).toContain('message');
    }
    expect(systemOf(chatCalls[0])).toContain('You are Alice.');
    expect(systemOf(chatCalls[1])).toContain('You are Bob.');
    expect(userOf(chatCalls[0])).toContain('Title: Harness Forum');
    expect(userOf(chatCalls[0])).toContain('### Recent transcript');
  });

  it('applies envelope results: thoughts accumulate, skip is recorded as a skip turn', async () => {
    installMockLmStudio({
      envelopeFor: (req) => systemOf(req).includes('You are Bob.')
        ? JSON.stringify({ thought: 'nothing to add', action: 'skip', message: '' })
        : JSON.stringify({ thought: 'opening thought', action: 'speak', message: 'Here is my take.' }),
    });
    seedState({
      actors: [actor('Alice'), actor('Bob')],
      messages: [userMessage('@Alice start please.')],
    });

    await runRound();

    const spoken = visibleMessages();
    expect(spoken[0].speaker).toBe('Alice');
    expect(spoken[0].content).toBe('Here is my take.');
    expect(spoken[1].speaker).toBe('Bob');
    expect(spoken[1].type).toBe('skip');
    const alice = state.actors.find(a => a.name === 'Alice');
    expect(alice.thoughts).toContain('opening thought');
    expect(alice.turnCount).toBe(1);
    expect(state.actors.find(a => a.name === 'Bob').skipCount).toBe(1);
  });

  it('aggregates per-round LLM call and token stats into diagnostics.roundCallStats', async () => {
    installMockLmStudio();
    seedState({
      actors: [actor('Alice'), actor('Bob')],
      messages: [userMessage('@Alice round one.')],
    });

    await runRound();
    state.messages.push(userMessage('@Alice round two.'));
    await runRound();

    const stats = state.diagnostics.roundCallStats;
    expect(stats).toHaveLength(2);
    // Two actors, no hidden routing/judge/scribe calls in this configuration.
    expect(stats[0]).toMatchObject({ round: 1, calls: 2, errors: 0 });
    expect(stats[1]).toMatchObject({ round: 2, calls: 2, errors: 0 });
    // Mock reports 100 prompt + 20 completion tokens per call.
    expect(stats[0].promptTokens).toBe(200);
    expect(stats[0].completionTokens).toBe(40);
  });

  it('runSingleResponse answers an @mention with exactly one turn', async () => {
    const { chatCalls } = installMockLmStudio();
    seedState({
      actors: [actor('Alice'), actor('Bob')],
      messages: [userMessage('@Bob what do you think?')],
    });

    const ok = await runSingleResponse();

    expect(ok).toBe(true);
    expect(chatCalls).toHaveLength(1);
    expect(visibleMessages().map(m => m.speaker)).toEqual(['Bob']);
  });

  it('keeps each actor\'s system prompt byte-identical across rounds (KV-cache prefix reuse)', async () => {
    const { chatCalls } = installMockLmStudio();
    seedState({
      actors: [actor('Alice'), actor('Bob')],
      messages: [userMessage('@Alice round one.')],
    });

    await runRound();
    state.messages.push(userMessage('@Alice round two.'));
    await runRound();

    expect(chatCalls).toHaveLength(4);
    const aliceSystems = chatCalls.filter(c => systemOf(c).includes('You are Alice.')).map(systemOf);
    const bobSystems = chatCalls.filter(c => systemOf(c).includes('You are Bob.')).map(systemOf);
    expect(aliceSystems).toHaveLength(2);
    expect(aliceSystems[0]).toBe(aliceSystems[1]);
    expect(bobSystems[0]).toBe(bobSystems[1]);
  });

  it('keeps the system prompt stable even when intent routing targets the actor (hint moves to the user tail)', async () => {
    const { chatCalls } = installMockLmStudio();
    seedState({
      actors: [actor('Alice'), actor('Bob')],
      messages: [userMessage('@Alice round one.')],
    });

    await runRound();
    // Simulate the intent pass choosing Alice with a turn directive.
    state.lastIntent = {
      read: 'Needs a counterpoint.', need: 'challenge', speaker: 'Alice',
      rationale: 'most contrarian', confidence: 0.9,
      expectedOutput: 'one concrete risk', at: new Date().toISOString(),
    };
    state.messages.push(userMessage('@Alice round two.'));
    await runRound();

    const aliceCalls = chatCalls.filter(c => systemOf(c).includes('You are Alice.'));
    expect(aliceCalls).toHaveLength(2);
    // System prompt unchanged — the per-turn hint must not break the prefix.
    expect(systemOf(aliceCalls[0])).toBe(systemOf(aliceCalls[1]));
    // The hint still reaches the model, in the volatile user tail.
    expect(userOf(aliceCalls[1])).toContain('DISCUSSION FOCUS');
    expect(userOf(aliceCalls[1])).toContain('THIS TURN, produce: one concrete risk');
    expect(userOf(aliceCalls[0])).not.toContain('DISCUSSION FOCUS');
  });

  it('keeps the user-prompt head stable while goal progress changes between rounds', async () => {
    const { chatCalls } = installMockLmStudio();
    seedState({
      actors: [actor('Alice'), actor('Bob')],
      messages: [userMessage('@Alice round one.')],
      scenario: { doneWhen: 'A decision is recorded.' },
    });
    state.discussion.goal = {
      ...state.discussion.goal,
      verdict: 'continue', verdictReason: 'Still exploring options.', progressPct: 30,
    };

    await runRound();
    // Judge updates progress between rounds — this must not invalidate the head.
    state.discussion.goal.progressPct = 60;
    state.discussion.goal.verdictReason = 'Options narrowed to two.';
    state.messages.push(userMessage('@Alice round two.'));
    await runRound();

    const aliceUsers = chatCalls.filter(c => systemOf(c).includes('You are Alice.')).map(userOf);
    expect(aliceUsers).toHaveLength(2);
    // Progress renders after the transcript, not in the head…
    for (const u of aliceUsers) {
      const progressIdx = u.indexOf('Progress: ~');
      expect(progressIdx).toBeGreaterThan(u.indexOf('### Recent transcript'));
    }
    expect(aliceUsers[1]).toContain('Progress: ~60%');
    // …so everything before the actor's own (per-turn) memory is byte-stable.
    const headOf = (u) => u.slice(0, u.indexOf('Your private actor memory'));
    expect(headOf(aliceUsers[0]).length).toBeGreaterThan(50);
    expect(headOf(aliceUsers[0])).toBe(headOf(aliceUsers[1]));
  });
});

// ── Role prompt snapshots ─────────────────────────────────────────────────────
// Byte-exact pins of each role's system prompt. These exist so prompt-assembly
// refactors can prove behavioral equivalence: any diff here is a deliberate
// prompt change and must be reviewed as one, not refactor fallout.

describe('role system-prompt snapshots', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  async function captureSystem(target) {
    const { chatCalls } = installMockLmStudio();
    seedState({
      actors: [
        target,
        actor('Alice'),
        actor('Bob'),
      ],
      messages: [userMessage('Please proceed.')],
    });
    await askActor(state.actors.find(a => a.id === target.id), null, null, false, {});
    expect(chatCalls).toHaveLength(1);
    return systemOf(chatCalls[0]);
  }

  it('participant system prompt', async () => {
    expect(await captureSystem(actor('Pat', { role: 'Analyst', goal: 'Find risks.' }))).toMatchSnapshot();
  });

  it('director system prompt', async () => {
    expect(await captureSystem(actor('Dirk', {
      role: 'Facilitator', canDirect: true, canManageCast: true, canSeeThoughts: true,
      canInject: true, canSuggestSpeaker: true, canAnchor: true, canPause: true,
      canPinFacts: true, canUpdateStyle: true, directorMode: 'facilitator',
    }))).toMatchSnapshot();
  });

  it('manager system prompt', async () => {
    expect(await captureSystem(actor('Mona', { role: 'Casting', canManageCast: true }))).toMatchSnapshot();
  });

  it('researcher system prompt (tools disabled)', async () => {
    expect(await captureSystem(actor('Rae', { role: 'Researcher', canResearch: true }))).toMatchSnapshot();
  });

  it('background mode prefixes the system prompt identically for every role', async () => {
    for (const target of [
      actor('Dirk', { canDirect: true }),
      actor('Mona', { canManageCast: true }),
      actor('Rae', { canResearch: true }),
      actor('Pat'),
    ]) {
      const sys = await captureSystem({ ...target, actorMode: 'background' });
      expect(sys.startsWith('BACKGROUND MODE: Your response will NOT appear in the transcript.')).toBe(true);
      expect(sys).toContain('No next actor determined yet.');
    }
  });
});
