import { describe, it, expect, beforeEach, vi } from 'vitest';

// preflight.js imports: state/logTransition from state.js, chatCompletion from api.js,
// trimWords from utils.js (kept real). Mock the first two.
const { mockState } = vi.hoisted(() => ({
  mockState: { settings: { enablePreflightRouter: true, preflightThreshold: 0.35 } },
}));

vi.mock('./state.js', () => ({ state: mockState, logTransition: vi.fn() }));
vi.mock('./api.js', () => ({ chatCompletion: vi.fn() }));

import { preflightSkipCheck, parsePreflightResponse } from './preflight.js';
import { chatCompletion } from './api.js';

// Two messages minimum so the router doesn't short-circuit on "too early".
const baseMessages = [
  { type: 'user', speaker: 'You', content: 'Kick things off please.' },
  { type: 'actor', speaker: 'Bob', content: 'Here is my opening point.' },
];
const actor = { id: 'a1', name: 'Bob', role: 'Analyst', canDirect: false };
const scenario = { objective: 'Reach a decision' };
const opts = { directlyAddressed: false, speakingMap: {}, actorCount: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  mockState.settings = { enablePreflightRouter: true, preflightThreshold: 0.35 };
});

describe('parsePreflightResponse', () => {
  it('parses an explicit confident skip', () => {
    const r = parsePreflightResponse('{"skip":true,"confidence":0.9,"reason":"duplicate"}');
    expect(r.shouldSkip).toBe(true);
    expect(r.confidence).toBe(0.9);
  });

  it('parses an explicit low-confidence skip without inflating it', () => {
    const r = parsePreflightResponse('{"skip":true,"confidence":0.1}');
    expect(r.shouldSkip).toBe(true);
    expect(r.confidence).toBeCloseTo(0.1);
  });

  it('defaults a bare skip to a high enough confidence to be honoured', () => {
    const r = parsePreflightResponse('{"skip":true}');
    expect(r.shouldSkip).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(0.35);
  });

  it('parses speak', () => {
    const r = parsePreflightResponse('{"skip":false,"confidence":0.9}');
    expect(r.shouldSkip).toBe(false);
  });

  it('handles code-fenced JSON', () => {
    const r = parsePreflightResponse('```json\n{"skip":true,"confidence":0.8}\n```');
    expect(r.shouldSkip).toBe(true);
    expect(r.confidence).toBeCloseTo(0.8);
  });

  it('falls back to plain-text skip with an honourable confidence', () => {
    const r = parsePreflightResponse('skip — nothing new to add');
    expect(r.shouldSkip).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(0.35);
  });

  it('treats ambiguous text as speak', () => {
    const r = parsePreflightResponse('I think there is more to say here');
    expect(r.shouldSkip).toBe(false);
  });
});

describe('preflightSkipCheck — passthroughs', () => {
  it('passes through when the router is disabled', async () => {
    mockState.settings.enablePreflightRouter = false;
    const r = await preflightSkipCheck(actor, baseMessages, scenario, opts);
    expect(r.shouldSkip).toBe(false);
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it('exempts directors', async () => {
    const r = await preflightSkipCheck({ ...actor, canDirect: true }, baseMessages, scenario, opts);
    expect(r.shouldSkip).toBe(false);
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it('passes through when there is too little context', async () => {
    const r = await preflightSkipCheck(actor, baseMessages.slice(0, 1), scenario, opts);
    expect(r.shouldSkip).toBe(false);
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it('never skips a directly-addressed actor', async () => {
    const r = await preflightSkipCheck(actor, baseMessages, scenario, { ...opts, directlyAddressed: true });
    expect(r.shouldSkip).toBe(false);
    expect(chatCompletion).not.toHaveBeenCalled();
  });
});

describe('preflightSkipCheck — gate semantics (regression for inverted confidence)', () => {
  it('HONOURS a confident skip (the previously-broken case)', async () => {
    // Before the fix, confidence 0.9 with `<= threshold(0.35)` meant a confident
    // skip was ignored. It must now be honoured.
    chatCompletion.mockResolvedValue('{"skip":true,"confidence":0.9,"reason":"already covered"}');
    const r = await preflightSkipCheck(actor, baseMessages, scenario, opts);
    expect(r.shouldSkip).toBe(true);
  });

  it('does NOT honour a low-confidence skip', async () => {
    chatCompletion.mockResolvedValue('{"skip":true,"confidence":0.1,"reason":"maybe"}');
    const r = await preflightSkipCheck(actor, baseMessages, scenario, opts);
    expect(r.shouldSkip).toBe(false);
  });

  it('does not skip when the model recommends speaking', async () => {
    chatCompletion.mockResolvedValue('{"skip":false,"confidence":0.9}');
    const r = await preflightSkipCheck(actor, baseMessages, scenario, opts);
    expect(r.shouldSkip).toBe(false);
  });

  it('honours a bare skip (no explicit confidence) at the default threshold', async () => {
    chatCompletion.mockResolvedValue('{"skip":true}');
    const r = await preflightSkipCheck(actor, baseMessages, scenario, opts);
    expect(r.shouldSkip).toBe(true);
  });

  it('fails open when the classifier call throws', async () => {
    chatCompletion.mockRejectedValue(new Error('connection refused'));
    const r = await preflightSkipCheck(actor, baseMessages, scenario, opts);
    expect(r.shouldSkip).toBe(false);
  });
});

describe('preflightSkipCheck — speaking-share threshold adjustment', () => {
  it('lowers the bar for an over-represented actor so a mid-confidence skip is honoured', async () => {
    // Bob has spoken far more than his fair share → easier to skip (lower bar).
    const speakingMap = { a1: 90, a2: 10 };
    chatCompletion.mockResolvedValue('{"skip":true,"confidence":0.2}');
    const r = await preflightSkipCheck(actor, baseMessages, scenario, {
      directlyAddressed: false, speakingMap, actorCount: 2,
    });
    expect(r.shouldSkip).toBe(true); // 0.2 clears the lowered bar
  });

  it('raises the bar for an under-represented actor so the same skip is rejected', async () => {
    // Bob has barely spoken → harder to skip (higher bar).
    const speakingMap = { a1: 5, a2: 95 };
    chatCompletion.mockResolvedValue('{"skip":true,"confidence":0.2}');
    const r = await preflightSkipCheck(actor, baseMessages, scenario, {
      directlyAddressed: false, speakingMap, actorCount: 2,
    });
    expect(r.shouldSkip).toBe(false); // 0.2 fails the raised bar
  });
});
