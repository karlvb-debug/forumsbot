import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  stripCodeFence,
  sanitizeJsonString,
  trimWords,
  normalizeStringArray,
  normalizeAiResult,
} from './utils.js';

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
});

describe('normalizeAiResult — pinFact and rateSignal passthrough', () => {
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

  it('passes through rateSignal when it is an object', () => {
    const sig = { novel: false, advancing: false, flag: 'repeat' };
    const result = normalizeAiResult({ ...base, rateSignal: sig }, fallback);
    expect(result.rateSignal).toEqual(sig);
  });

  it('drops rateSignal when it is a string', () => {
    const result = normalizeAiResult({ ...base, rateSignal: 'bad' }, fallback);
    expect(result.rateSignal).toBeUndefined();
  });
});
