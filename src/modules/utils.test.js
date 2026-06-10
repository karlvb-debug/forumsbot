import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  stripCodeFence,
  sanitizeJsonString,
  trimWords,
  normalizeStringArray,
  normalizeAiResult,
  normalizeQuickStartConfig,
  cosineSimilarity,
  normalizeCadence,
  isQueueActor,
  shouldFireCadence,
  parseTextToolCalls,
  stripTextToolCalls,
} from './utils.js';

describe('normalizeCadence — legacy migration', () => {
  it('maps normal / missing to null (queue participant)', () => {
    expect(normalizeCadence({ turnSchedule: 'normal' })).toBeNull();
    expect(normalizeCadence({})).toBeNull();
    expect(normalizeCadence(null)).toBeNull();
  });
  it('maps every-turn to { turn, 1 }', () => {
    expect(normalizeCadence({ turnSchedule: 'every-turn' })).toEqual({ unit: 'turn', n: 1 });
  });
  it('maps alternate to { round, 2 }', () => {
    expect(normalizeCadence({ turnSchedule: 'alternate' })).toEqual({ unit: 'round', n: 2 });
  });
  it('maps on-call to a never-firing cadence (n=0)', () => {
    expect(normalizeCadence({ turnSchedule: 'on-call' })).toEqual({ unit: 'turn', n: 0 });
  });
  it('passes through an explicit cadence and clamps n to >=1', () => {
    expect(normalizeCadence({ cadence: { unit: 'round', n: 3 } })).toEqual({ unit: 'round', n: 3 });
    expect(normalizeCadence({ cadence: { unit: 'turn', n: 0.4 } })).toEqual({ unit: 'turn', n: 1 });
  });
  it('prefers explicit cadence over legacy turnSchedule', () => {
    expect(normalizeCadence({ cadence: { unit: 'turn', n: 2 }, turnSchedule: 'every-turn' }))
      .toEqual({ unit: 'turn', n: 2 });
  });
});

describe('isQueueActor', () => {
  it('true for a plain participant', () => {
    expect(isQueueActor({ actorMode: 'participant' })).toBe(true);
    expect(isQueueActor({})).toBe(true);
  });
  it('false for background actors', () => {
    expect(isQueueActor({ actorMode: 'background' })).toBe(false);
  });
  it('false for cadence (every-turn) actors even if participant', () => {
    expect(isQueueActor({ turnSchedule: 'every-turn' })).toBe(false);
    expect(isQueueActor({ cadence: { unit: 'round', n: 1 } })).toBe(false);
  });
});

describe('shouldFireCadence', () => {
  it('never fires a null cadence or n<=0', () => {
    expect(shouldFireCadence(null, { turnIndex: 5 })).toBe(false);
    expect(shouldFireCadence({ unit: 'turn', n: 0 }, { turnIndex: 5 })).toBe(false);
  });
  it('fires every turn for { turn, 1 }', () => {
    expect(shouldFireCadence({ unit: 'turn', n: 1 }, { turnIndex: 1 })).toBe(true);
    expect(shouldFireCadence({ unit: 'turn', n: 1 }, { turnIndex: 7 })).toBe(true);
  });
  it('fires every Nth turn', () => {
    const c = { unit: 'turn', n: 2 };
    expect(shouldFireCadence(c, { turnIndex: 1 })).toBe(false);
    expect(shouldFireCadence(c, { turnIndex: 2 })).toBe(true);
    expect(shouldFireCadence(c, { turnIndex: 4 })).toBe(true);
  });
  it('fires on round cadence by roundIndex', () => {
    const c = { unit: 'round', n: 2 };
    expect(shouldFireCadence(c, { roundIndex: 1 })).toBe(false);
    expect(shouldFireCadence(c, { roundIndex: 2 })).toBe(true);
    expect(shouldFireCadence(c, { turnIndex: 99, roundIndex: 3 })).toBe(false);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });
  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });
  it('returns 0 for zero, mismatched-length, or non-array inputs', () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
    expect(cosineSimilarity(null, [1, 2])).toBe(0);
  });
  it('is symmetric', () => {
    const a = [0.2, 0.5, 0.9], b = [0.1, 0.4, 0.3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a));
  });
});

describe('estimateTokens', () => {
  it('returns 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(null)).toBe(0);
  });

  it('estimates ~1 token per 4 chars', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });

  it('rounds up for partial tokens', () => {
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('stripCodeFence', () => {
  it('strips opening and closing fences', () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('passes through content without fences', () => {
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');
  });

  it('handles null/undefined', () => {
    expect(stripCodeFence(null)).toBe('');
    expect(stripCodeFence(undefined)).toBe('');
  });
});

describe('sanitizeJsonString', () => {
  it('passes through valid JSON unchanged', () => {
    const json = '{"name":"Alice","age":30}';
    expect(sanitizeJsonString(json)).toBe(json);
  });

  it('replaces raw newlines inside string values', () => {
    const input = '{"msg":"hello\nworld"}';
    const result = sanitizeJsonString(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result).msg).toBe('hello\nworld');
  });

  it('does not corrupt numbers or booleans', () => {
    const input = '{"n":42,"b":true,"s":"ok"}';
    expect(sanitizeJsonString(input)).toBe(input);
  });
});

describe('trimWords', () => {
  it('returns text unchanged when under limit', () => {
    expect(trimWords('hello world', 5)).toBe('hello world');
  });

  it('truncates with ellipsis when over limit', () => {
    const result = trimWords('one two three four five six', 3);
    expect(result).toBe('one two three...');
  });

  it('handles empty input', () => {
    expect(trimWords('', 10)).toBe('');
    expect(trimWords(null, 10)).toBe('');
  });
});

describe('normalizeStringArray', () => {
  it('passes through a clean string array', () => {
    expect(normalizeStringArray(['alpha', 'beta', 'gamma'])).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('splits newline-separated strings', () => {
    expect(normalizeStringArray('alpha\nbeta\ngamma')).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('splits comma-separated strings when flag is set', () => {
    expect(normalizeStringArray('alpha,beta,gamma', true)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('parses a JSON array string', () => {
    expect(normalizeStringArray('["foo","bar","baz"]')).toEqual(['foo', 'bar', 'baz']);
  });

  it('repairs char-spread array corruption', () => {
    expect(normalizeStringArray(['P', 'r', 'o', 'd'])).toEqual(['Prod']);
  });

  it('repairs word-split array corruption (4+ single-word short items)', () => {
    const wordSpread = ['Use', 'React', 'hooks', 'here'];
    expect(normalizeStringArray(wordSpread)).toEqual(['Use React hooks here']);
  });

  it('returns empty array for empty input', () => {
    expect(normalizeStringArray('')).toEqual([]);
    expect(normalizeStringArray([])).toEqual([]);
  });

  it('removes bullet prefixes', () => {
    expect(normalizeStringArray('- item one\n* item two')).toEqual(['item one', 'item two']);
  });
});

// ── normalizeAiResult ─────────────────────────────────────────────────────────
describe('normalizeAiResult — pauseRequest passthrough', () => {
  const fallback = 'fallback message';
  const base = { action: 'speak', message: 'hello' };

  it('passes through a valid pauseRequest with all fields', () => {
    const result = normalizeAiResult({
      ...base,
      pauseRequest: {
        reason: 'question',
        context: 'We need to decide something.',
        question: 'What do you prefer?',
        options: ['Option A', 'Option B'],
        defaultIfNoResponse: 'proceed with A',
      },
    }, fallback);
    expect(result.pauseRequest).toBeDefined();
    expect(result.pauseRequest.reason).toBe('question');
    expect(result.pauseRequest.defaultIfNoResponse).toBe('proceed with A');
  });

  it('passes through a valid pauseRequest when question is absent (question is optional)', () => {
    const result = normalizeAiResult({
      ...base,
      pauseRequest: {
        reason: 'decision',
        context: 'Key decision point.',
        defaultIfNoResponse: 'use default',
      },
    }, fallback);
    expect(result.pauseRequest).toBeDefined();
    expect(result.pauseRequest.reason).toBe('decision');
  });

  it('drops pauseRequest when reason is missing', () => {
    const result = normalizeAiResult({
      ...base,
      pauseRequest: { context: 'ctx', question: 'q', defaultIfNoResponse: 'default' },
    }, fallback);
    expect(result.pauseRequest).toBeUndefined();
  });

  it('drops pauseRequest when defaultIfNoResponse is missing', () => {
    const result = normalizeAiResult({
      ...base,
      pauseRequest: { reason: 'question', context: 'ctx', question: 'q?' },
    }, fallback);
    expect(result.pauseRequest).toBeUndefined();
  });

  it('drops pauseRequest when it is a string instead of object', () => {
    const result = normalizeAiResult({
      ...base,
      pauseRequest: 'ask the user something',
    }, fallback);
    expect(result.pauseRequest).toBeUndefined();
  });

  it('drops pauseRequest when both reason and defaultIfNoResponse are absent', () => {
    const result = normalizeAiResult({
      ...base,
      pauseRequest: { context: 'ctx' },
    }, fallback);
    expect(result.pauseRequest).toBeUndefined();
  });

  it('does not corrupt other normalized fields when pauseRequest is present', () => {
    const result = normalizeAiResult({
      action: 'speak',
      message: 'My message.',
      thought: 'My thought.',
      pauseRequest: { reason: 'conflict', context: 'ctx', defaultIfNoResponse: 'continue' },
    }, fallback);
    expect(result.action).toBe('speak');
    expect(result.message).toBe('My message.');
    expect(result.thought).toBe('My thought.');
    expect(result.pauseRequest.reason).toBe('conflict');
  });

  it('strips leaked transcript label lines from public messages', () => {
    const result = normalizeAiResult({
      action: 'speak',
      message: '[USER] Hi everyone. Director, are we aligned?\nYes, we should define constraints first.',
    }, fallback);
    expect(result.action).toBe('speak');
    expect(result.message).toBe('Yes, we should define constraints first.');
  });

  it('does not inject malformed prompt envelopes as fallback public text', () => {
    const result = normalizeAiResult({ action: 'speak', message: '' }, '{"thought":"x","message":"[USER] leaked');
    expect(result.action).toBe('skip');
    expect(result.message).toBe('');
  });
});

describe('normalizeAiResult — pinFact passthrough', () => {
  const fallback = 'fallback';
  const base = { action: 'speak', message: 'Hi' };

  it('passes through a non-empty pinFact string', () => {
    const result = normalizeAiResult({ ...base, pinFact: 'The lighthouse is abandoned.' }, fallback);
    expect(result.pinFact).toBe('The lighthouse is abandoned.');
  });

  it('drops pinFact when empty string', () => {
    const result = normalizeAiResult({ ...base, pinFact: '  ' }, fallback);
    expect(result.pinFact).toBeUndefined();
  });

  it('truncates pinFact to 200 chars', () => {
    const result = normalizeAiResult({ ...base, pinFact: 'x'.repeat(300) }, fallback);
    expect(result.pinFact.length).toBe(200);
  });

  it('does not carry a rateSignal field (CAP-14 removed)', () => {
    const result = normalizeAiResult({ ...base, rateSignal: { flag: 'repeat' } }, fallback);
    expect(result.rateSignal).toBeUndefined();
  });
});

describe('normalizeQuickStartConfig', () => {
  it('correctly parses memory.pinnedFacts and memory.openQuestions as arrays', () => {
    const rawConfig = {
      scenario: { title: 'Test Scenario' },
      memory: {
        pinnedFacts: 'Fact 1\nFact 2',
        openQuestions: '["Question 1", "Question 2"]'
      }
    };
    const result = normalizeQuickStartConfig(rawConfig);
    expect(result.memory.pinnedFacts).toEqual(['Fact 1', 'Fact 2']);
    expect(result.memory.openQuestions).toEqual(['Question 1', 'Question 2']);
  });

  it('does not emit scenario.mode for new quick-start configs', () => {
    const result = normalizeQuickStartConfig({ scenario: { title: 'No Modes' } });
    expect(result.scenario.mode).toBeUndefined();
    expect(result.scenario.systems.stageDirections.enabled).toBe(false);
    expect(result.scenario.systems.document).toBeUndefined();
    expect(result.scenario.systems.turnRouting.strategy).toBe('sequential');
  });

  it('translates legacy story mode into explicit systems', () => {
    const result = normalizeQuickStartConfig({ scenario: { mode: 'story', title: 'Legacy Story' } });
    expect(result.scenario.mode).toBeUndefined();
    expect(result.scenario.systems.stageDirections.enabled).toBe(true);
    expect(result.scenario.systems.turnRouting.strategy).toBe('agentic');
    expect(result.scenario.systems.dmRole.role).toBe('narrator');
    expect(result.scenario.systems.document).toBeUndefined();
  });
});

describe('parseTextToolCalls — generic [TOOL:] tags', () => {
  const KNOWN = ['web_search', 'web_read', 'mcp:memory.search_nodes', 'mcp:echo.echo'];

  it('parses legacy [SEARCH:] and [READ:] tags without a registry', () => {
    const calls = parseTextToolCalls('look [SEARCH: llama benchmarks] then [READ: https://a.io/x]');
    expect(calls).toEqual([
      { tool: 'web_search', args: { query: 'llama benchmarks' } },
      { tool: 'web_read', args: { url: 'https://a.io/x' } },
    ]);
  });

  it('parses a known [TOOL:] tag with JSON args', () => {
    const calls = parseTextToolCalls('[TOOL: mcp:echo.echo {"message": "hi"}]', KNOWN);
    expect(calls).toEqual([{ tool: 'mcp:echo.echo', args: { message: 'hi' } }]);
  });

  it('handles nested braces and braces inside strings in args', () => {
    const content = '[TOOL: mcp:memory.search_nodes {"filter": {"depth": 2}, "note": "a } b"}]';
    const calls = parseTextToolCalls(content, KNOWN);
    expect(calls).toEqual([
      { tool: 'mcp:memory.search_nodes', args: { filter: { depth: 2 }, note: 'a } b' } },
    ]);
  });

  it('never executes unregistered tool names', () => {
    expect(parseTextToolCalls('[TOOL: rm_rf {"path": "/"}]', KNOWN)).toEqual([]);
    // No registry at all → no generic tags parse.
    expect(parseTextToolCalls('[TOOL: mcp:echo.echo {"message": "hi"}]')).toEqual([]);
  });

  it('filters legacy [SEARCH:]/[READ:] tags against the grant list too', () => {
    // An MCP-only grant list must not let web tools through.
    const mcpOnly = ['mcp:echo.echo'];
    expect(parseTextToolCalls('[SEARCH: secrets] [READ: https://a.io]', mcpOnly)).toEqual([]);
    // …while an ungated call (no list) still parses them, for legacy callers.
    expect(parseTextToolCalls('[SEARCH: ok]')).toHaveLength(1);
  });

  it('recovers canonical casing for case-drifted names', () => {
    const calls = parseTextToolCalls('[TOOL: MCP:Echo.ECHO {"message": "hi"}]', KNOWN);
    expect(calls).toEqual([{ tool: 'mcp:echo.echo', args: { message: 'hi' } }]);
  });

  it('treats unparseable args as empty and tolerates missing args', () => {
    expect(parseTextToolCalls('[TOOL: mcp:echo.echo {not json}]', KNOWN)).toEqual([
      { tool: 'mcp:echo.echo', args: {} },
    ]);
    expect(parseTextToolCalls('[TOOL: mcp:echo.echo]', KNOWN)).toEqual([
      { tool: 'mcp:echo.echo', args: {} },
    ]);
  });

  it('ignores malformed tags with no closing bracket', () => {
    expect(parseTextToolCalls('[TOOL: mcp:echo.echo {"a": 1}', KNOWN)).toEqual([]);
  });

  it('parses args with escaped quotes (tag embedded in a JSON envelope thought string)', () => {
    // What the raw model output actually looks like: the tag sits inside the
    // envelope's thought string, so the args object arrives escaped.
    const raw = '{"thought":"Let me check. [TOOL: mcp:echo.echo {\\"message\\": \\"hi there\\"}]","action":"speak","message":""}';
    const calls = parseTextToolCalls(raw, KNOWN);
    expect(calls).toEqual([{ tool: 'mcp:echo.echo', args: { message: 'hi there' } }]);
  });

  it('parses nested args in escaped envelope form', () => {
    const raw = '{"thought":"[TOOL: mcp:memory.search_nodes {\\"filter\\": {\\"depth\\": 2}}]","action":"speak","message":""}';
    const calls = parseTextToolCalls(raw, KNOWN);
    expect(calls).toEqual([{ tool: 'mcp:memory.search_nodes', args: { filter: { depth: 2 } } }]);
  });

  it('parses multiple tags in one response', () => {
    const calls = parseTextToolCalls(
      'first [TOOL: mcp:echo.echo {"message": "a"}] then [SEARCH: x]', KNOWN);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.tool).sort()).toEqual(['mcp:echo.echo', 'web_search']);
  });
});

describe('stripTextToolCalls — generic [TOOL:] tags', () => {
  it('strips well-formed TOOL tags regardless of registry', () => {
    const out = stripTextToolCalls('before [TOOL: anything {"a": {"b": 1}}] after');
    expect(out).toBe('before  after');
  });

  it('still strips legacy tags and leaves malformed TOOL tags alone', () => {
    expect(stripTextToolCalls('a [SEARCH: q] b [READ: u] c')).toBe('a  b  c');
    expect(stripTextToolCalls('keep [TOOL: broken {')).toBe('keep [TOOL: broken {');
  });
});
