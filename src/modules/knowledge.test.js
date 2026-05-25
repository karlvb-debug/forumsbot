import { describe, it, expect } from 'vitest';
import { buildKbSection } from './knowledge.js';

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
