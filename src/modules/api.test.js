import { describe, it, expect, beforeEach, vi } from 'vitest';

// api.js imports: state/saveState from state.js, utils (kept real), and the two
// React hook bridges. Mock state + hooks; drive everything through global.fetch.
const { mockState } = vi.hoisted(() => ({
  mockState: {
    settings: {
      model: 'test-model', baseUrl: 'http://127.0.0.1:1234', apiKey: 'lm-studio',
      toolsEnabled: false, streamingEnabled: false, maxTokens: 2000, temperature: 0.8,
      topP: 1.0, repeatPenalty: 1.0, seedEnabled: false, seed: -1,
    },
    scenario: { systems: {} },
    diagnostics: {},
    contextInfo: {},
  },
}));

vi.mock('./state.js', () => ({ state: mockState, saveState: vi.fn() }));
vi.mock('../hooks/useActions.js', () => ({ setConnectionStatus: vi.fn() }));
vi.mock('../hooks/useForumState.js', () => ({ notifyStateChange: vi.fn(), mutateState: vi.fn() }));

import { chatJson, executeToolCall, isJsonSchemaSupported, extractNativeThinking, resolveModelTier } from './api.js';

function chatResponse(content) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 5, completion_tokens: 7 } }),
  };
}
function jsonResponse(obj) {
  return { ok: true, json: async () => obj };
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockState.diagnostics = {};
  mockState.contextInfo = {};
  mockState.settings.model = 'test-model';
  mockState.settings.reasoningModel = '';
  mockState.settings.toolsEnabled = false;
  mockState.settings.streamingEnabled = false;
});

const SCHEMA = { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] };

describe('chatJson — parsing & recovery', () => {
  it('parses a well-formed envelope on the first try', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      chatResponse('{"thought":"t","action":"speak","message":"hi"}')
    );
    const parsed = await chatJson('sys', 'usr', 0.2, null);
    expect(parsed.action).toBe('speak');
    expect(parsed.message).toBe('hi');
    expect(parsed._parseFailure).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('recovers a truncated envelope with a single resume retry', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(chatResponse('{"thought":"t","action":"speak","message":"hello'))
      .mockResolvedValueOnce(chatResponse('{"thought":"t","action":"speak","message":"hello world"}'));
    const parsed = await chatJson('sys', 'usr', 0.2, null);
    expect(parsed.message).toBe('hello world');
    expect(parsed._parseFailure).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('falls back to raw-message injection and logs a parse failure when JSON is unrecoverable', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(chatResponse('totally not json'));
    const parsed = await chatJson('sys', 'usr', 0.2, null);
    // The raw text becomes the message; the failure is recorded for diagnostics.
    expect(parsed.message).toContain('not json');
    expect(parsed._parseFailure).toBe(true);
    expect(mockState.diagnostics.parseFailures.length).toBeGreaterThanOrEqual(1);
    // One initial call + one truncation-resume attempt.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('records token usage from the response onto contextInfo', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      chatResponse('{"thought":"","action":"speak","message":"ok"}')
    );
    await chatJson('sys', 'usr', 0.2, null);
    expect(mockState.contextInfo.lastPromptTokens).toBe(5);
    expect(mockState.contextInfo.lastCompletionTokens).toBe(7);
  });
});

describe('chatJson — grammar schema & capability detection', () => {
  it('sends response_format and records schema support when the server accepts it', async () => {
    mockState.settings.model = 'schema-yes';
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      chatResponse('{"thought":"","action":"speak","message":"ok"}')
    );
    await chatJson('sys', 'usr', 0.2, null, null, null, SCHEMA);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.request.response_format?.type).toBe('json_schema');
    expect(isJsonSchemaSupported('schema-yes')).toBe(true);
  });

  it('falls back to prompt-only JSON (no response_format) when the server rejects the schema', async () => {
    mockState.settings.model = 'schema-no';
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'response_format not supported' }) })
      .mockResolvedValueOnce(chatResponse('{"thought":"","action":"speak","message":"ok"}'));
    const parsed = await chatJson('sys', 'usr', 0.2, null, null, null, SCHEMA);
    expect(parsed.message).toBe('ok');
    expect(fetchSpy).toHaveBeenCalledTimes(2); // probe + fallback, without consuming a tool round
    const retryBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
    expect(retryBody.request.response_format).toBeUndefined();
    expect(isJsonSchemaSupported('schema-no')).toBe(false);
  });

  it('does not retry a genuine (non-schema) HTTP error indefinitely', async () => {
    mockState.settings.model = 'schema-no'; // already marked unsupported above is per-model; use fresh
    mockState.settings.model = 'err-model';
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'model not loaded' }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'model not loaded' }) });
    // Schema probe disables schema and retries once; the retry still fails → throws.
    await expect(chatJson('sys', 'usr', 0.2, null, null, null, SCHEMA)).rejects.toThrow(/model not loaded/);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('chatJson — text tool gating', () => {
  it('does not execute text-tag tools when the caller disables tools', async () => {
    mockState.settings.toolsEnabled = true;
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      chatResponse('{"thought":"[SEARCH: local llms]","action":"speak","message":"No tool call should run."}')
    );

    const parsed = await chatJson('sys', 'usr', 0.2, null, null, null, null, { toolsAllowed: false });

    expect(parsed.message).toContain('No tool call should run');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('extractNativeThinking', () => {
  it('returns content unchanged when there is no think block', () => {
    const { reasoning, content } = extractNativeThinking('{"action":"speak","message":"hi"}');
    expect(reasoning).toBe('');
    expect(content).toBe('{"action":"speak","message":"hi"}');
  });

  it('strips a leading think block and captures the reasoning', () => {
    const raw = '<think>Let me weigh the options.</think>{"action":"speak","message":"go"}';
    const { reasoning, content } = extractNativeThinking(raw);
    expect(reasoning).toBe('Let me weigh the options.');
    expect(content).toBe('{"action":"speak","message":"go"}');
    expect(() => JSON.parse(content)).not.toThrow(); // the parse-bug fix
  });

  it('handles the <thinking> tag variant and multiple blocks', () => {
    expect(extractNativeThinking('<thinking>hmm</thinking>answer').reasoning).toBe('hmm');
    const multi = extractNativeThinking('<think>one</think>mid<think>two</think>end');
    expect(multi.reasoning).toContain('one');
    expect(multi.reasoning).toContain('two');
    expect(multi.content).toBe('midend');
  });

  it('treats an unclosed think block as reasoning that never terminated', () => {
    const { reasoning, content } = extractNativeThinking('<think>still reasoning when cut off');
    expect(reasoning).toBe('still reasoning when cut off');
    expect(content).toBe('');
  });

  it('is a no-op on empty / non-string input', () => {
    expect(extractNativeThinking('').content).toBe('');
    expect(extractNativeThinking(null).content).toBe('');
  });
});

describe('resolveModelTier', () => {
  beforeEach(() => { mockState.settings.model = 'main-model'; mockState.settings.reasoningModel = ''; });

  it('uses the main model for fast/think/unknown tiers', () => {
    expect(resolveModelTier('fast')).toBe('main-model');
    expect(resolveModelTier('think')).toBe('main-model');
    expect(resolveModelTier(undefined)).toBe('main-model');
  });

  it('uses the reasoning model for the reason tier when configured', () => {
    mockState.settings.reasoningModel = 'thinking-model';
    expect(resolveModelTier('reason')).toBe('thinking-model');
  });

  it('falls back to the main model for reason when no reasoning model is set (incl. whitespace)', () => {
    expect(resolveModelTier('reason')).toBe('main-model');
    mockState.settings.reasoningModel = '   ';
    expect(resolveModelTier('reason')).toBe('main-model');
  });
});

describe('chatJson — native reasoning routing', () => {
  it('strips a native <think> block and routes it into the thought field', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      chatResponse('<think>I should greet them.</think>{"thought":"","action":"speak","message":"hello"}')
    );
    const parsed = await chatJson('sys', 'usr', 0.2, null);
    expect(parsed.message).toBe('hello');           // <think> prefix did not break JSON parsing
    expect(parsed.thought).toBe('I should greet them.'); // reasoning surfaced in the thought slot
    expect(parsed._parseFailure).toBe(false);
  });

  it('routes reason-tier calls to the configured reasoning model', async () => {
    mockState.settings.reasoningModel = 'thinker';
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      chatResponse('{"thought":"","action":"speak","message":"ok"}')
    );
    await chatJson('sys', 'usr', 0.2, null, null, null, null, { tier: 'reason' });
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).request.model).toBe('thinker');
  });

  it('keeps think-tier calls on the main model even when a reasoning model exists', async () => {
    mockState.settings.reasoningModel = 'thinker';
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      chatResponse('{"thought":"","action":"speak","message":"ok"}')
    );
    await chatJson('sys', 'usr', 0.2, null, null, null, null, { tier: 'think' });
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).request.model).toBe('test-model');
  });
});

describe('executeToolCall — web_search', () => {
  it('formats search results and inlines the auto-read of the top hit', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ results: [{ title: 'Result One', snippet: 'a snippet', url: 'https://example.com/a' }] }))
      .mockResolvedValueOnce(jsonResponse({ text: 'Full page body text here' }));
    const out = await executeToolCall('web_search', JSON.stringify({ query: 'local llms' }), undefined);
    expect(out).toContain('Result One');
    expect(out).toContain('https://example.com/a');
    expect(out).toContain('Full page body text here');
    expect(fetchSpy).toHaveBeenCalledTimes(2); // search + auto-read
  });

  it('returns a tool-error string when the fetch rejects', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
    const out = await executeToolCall('web_read', JSON.stringify({ url: 'https://example.com' }), undefined);
    expect(out).toContain('Tool error');
  });
});
