import { beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('./api.js', () => ({
  getEmbedding: vi.fn(),
  getEmbeddingsBatch: vi.fn(),
}));

import { buildKbSection, buildReferenceSectionSemantic, splitIntoParagraphs } from './knowledge.js';
import { getEmbedding, getEmbeddingsBatch } from './api.js';
import { state } from './state.js';

// allocateChars is not exported, so we test it through buildKbSection

describe('buildKbSection', () => {
  it('returns empty string for no entries', () => {
    expect(buildKbSection([])).toBe('');
    expect(buildKbSection(null)).toBe('');
  });

  it('includes heading and entry title', () => {
    const entries = [{ id: '1', title: 'Spec', content: 'hello world' }];
    const result = buildKbSection(entries);
    expect(result).toContain('## Knowledge Base');
    expect(result).toContain('### Spec');
    expect(result).toContain('hello world');
  });

  it('truncates content that exceeds budget', () => {
    const longContent = 'x'.repeat(100_000);
    const entries = [{ id: '1', title: 'Big', content: longContent }];
    const result = buildKbSection(entries, { maxSection: 1000 });
    expect(result.length).toBeLessThan(1200);
    expect(result).toContain('[truncated]');
  });

  it('small entries do not steal budget from large ones — water-fill', () => {
    // Two small entries (10 chars each) + one large entry (50k chars)
    // Small entries should each get their 10 chars; large gets the rest
    const small = { id: '1', title: 'A', content: 'short-text' };  // 10 chars
    const large = { id: '2', title: 'B', content: 'x'.repeat(50_000) };
    const budget = 10_000;
    const result = buildKbSection([small, large], { maxSection: budget });
    expect(result).toContain('short-text');
    // Large entry should get significantly more than 5000 chars (its fair half)
    const largeSection = result.split('---')[1] || '';
    expect(largeSection.length).toBeGreaterThan(4000);
  });

  it('multiple entries each get fair share when all are large', () => {
    const entries = [
      { id: '1', title: 'A', content: 'x'.repeat(20_000) },
      { id: '2', title: 'B', content: 'y'.repeat(20_000) },
    ];
    const result = buildKbSection(entries, { maxSection: 4000 });
    // Each should be truncated
    expect(result.match(/\[truncated\]/g)?.length).toBe(2);
  });
});

describe('splitIntoParagraphs', () => {
  it('splits on blank lines and merges small paragraphs up to the word cap', () => {
    const text = 'one two three\n\nfour five\n\n' + 'w '.repeat(200).trim();
    const paras = splitIntoParagraphs(text, 10);
    // First two small paragraphs merge (5 words ≤ 10); the long one hard-splits.
    expect(paras[0]).toBe('one two three\n\nfour five');
    expect(paras.length).toBeGreaterThan(2);
    for (const p of paras) {
      expect(p.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(10);
    }
  });

  it('handles empty input', () => {
    expect(splitIntoParagraphs('')).toEqual([]);
    expect(splitIntoParagraphs(null)).toEqual([]);
  });
});

describe('buildReferenceSectionSemantic', () => {
  // Deterministic fake embeddings: dimension 0 counts "alpha", 1 counts "beta".
  const vec = (text) => [
    (String(text).match(/alpha/g) || []).length,
    (String(text).match(/beta/g) || []).length,
    0.01,
  ];

  beforeEach(() => {
    getEmbedding.mockReset().mockImplementation(async (text) => vec(text));
    getEmbeddingsBatch.mockReset().mockImplementation(async (texts) => texts.map(vec));
    state.settings.embeddingModel = 'fake-embed';
    state.ui.embeddingProbeResult = { ok: true };
    state.scenario.task = 'Investigate the alpha question in depth';
    state.messages = [];
    state.currentRound = (state.currentRound || 0) + 1; // bust the per-round cache
  });

  it('selects the paragraphs most relevant to the session focus when over budget', async () => {
    // Each paragraph exceeds the 120-word merge cap so they stay separate chunks.
    const alphaPara = ('alpha alpha findings: ' + 'detail '.repeat(125)).trim();
    const betaPara = ('beta background notes: ' + 'filler '.repeat(125)).trim();
    const doc = { id: 'doc-sem-1', title: 'Research', content: `${betaPara}\n\n${alphaPara}` };

    const result = await buildReferenceSectionSemantic([doc], { maxSection: alphaPara.length + 40 });

    expect(result).toContain('## Reference Documents');
    expect(result).toContain('(most relevant excerpts)');
    expect(result).toContain('alpha alpha findings');
    expect(result).not.toContain('beta background notes');
  });

  it('includes everything verbatim when the documents fit the budget', async () => {
    const doc = { id: 'doc-sem-2', title: 'Tiny', content: 'alpha and beta both fit.' };
    const result = await buildReferenceSectionSemantic([doc], { maxSection: 5000 });
    expect(result).toContain('alpha and beta both fit.');
    expect(getEmbedding).not.toHaveBeenCalled();
  });

  it('falls back to the even split when the embedding probe failed', async () => {
    state.ui.embeddingProbeResult = { ok: false, reason: 'down' };
    const doc = { id: 'doc-sem-3', title: 'Big', content: 'x'.repeat(10_000) };
    const result = await buildReferenceSectionSemantic([doc], { maxSection: 1000 });
    expect(result).toContain('[truncated]');
    expect(getEmbedding).not.toHaveBeenCalled();
  });

  it('falls back to the even split when an embedding call throws', async () => {
    getEmbedding.mockRejectedValueOnce(new Error('embeddings down'));
    const doc = { id: 'doc-sem-4', title: 'Big', content: 'alpha '.repeat(500) + '\n\n' + 'beta '.repeat(500) };
    const result = await buildReferenceSectionSemantic([doc], { maxSection: 1000 });
    expect(result).toContain('[truncated]');
  });

  it('reuses the rendered section within a round (one query embedding per round)', async () => {
    const doc = { id: 'doc-sem-5', title: 'Doc', content: 'alpha '.repeat(300) + '\n\n' + 'beta '.repeat(300) };
    const first = await buildReferenceSectionSemantic([doc], { maxSection: 1200 });
    const second = await buildReferenceSectionSemantic([doc], { maxSection: 1200 });
    expect(second).toBe(first);
    expect(getEmbedding).toHaveBeenCalledTimes(1);
  });
});
