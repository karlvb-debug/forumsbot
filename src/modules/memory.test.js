import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock state and its dependencies before importing memory
vi.mock('./state.js', () => ({
  state: {
    outcomes: {
      finalRecommendation: '',
      decisions: [],
      rationale: [],
      rejectedOptions: [],
      actionItems: [],
      risks: [],
    },
  },
  saveState: vi.fn(),
  logWarning: vi.fn(),
  logTransition: vi.fn(),
  registerSaveCallback: vi.fn(),
}));
vi.mock('./api.js', () => ({ setStatus: vi.fn(), chatJson: vi.fn(), chatCompletion: vi.fn(), getEmbedding: vi.fn(), getEmbeddingsBatch: vi.fn() }));
vi.mock('./db.js', () => ({ getAllChunks: vi.fn(async () => []), putChunk: vi.fn(), clearChunks: vi.fn(), countChunks: vi.fn(async () => 0), getAllMessages: vi.fn(async () => []) }));
vi.mock('../hooks/useForumState.js', () => ({ saveState: vi.fn(), notifyStateChange: vi.fn(), mutateState: vi.fn() }));
vi.mock('../hooks/useActions.js', () => ({ setBusy: vi.fn(), getBusy: vi.fn(() => false) }));

import { formatCurrentOutcomes } from './memory.js';
import { state } from './state.js';

describe('formatCurrentOutcomes', () => {
  beforeEach(() => {
    state.outcomes = {
      finalRecommendation: '',
      decisions: [],
      rationale: [],
      rejectedOptions: [],
      actionItems: [],
      risks: [],
    };
  });

  it('returns "None." when all fields are empty', () => {
    expect(formatCurrentOutcomes()).toBe('None.');
  });

  it('joins array fields with newlines, not commas', () => {
    state.outcomes.decisions = ['Use React', 'Adopt TypeScript'];
    const result = formatCurrentOutcomes();
    expect(result).toContain('Use React\nAdopt TypeScript');
    expect(result).not.toContain('Use React,Adopt TypeScript');
  });

  it('includes finalRecommendation when set', () => {
    state.outcomes.finalRecommendation = 'Ship it.';
    const result = formatCurrentOutcomes();
    expect(result).toContain('Final recommendation:\nShip it.');
  });

  it('omits sections with empty arrays', () => {
    state.outcomes.decisions = ['One decision'];
    const result = formatCurrentOutcomes();
    expect(result).not.toContain('Rationale:');
    expect(result).not.toContain('Risks:');
    expect(result).toContain('Decisions:');
  });

  it('includes all non-empty sections', () => {
    state.outcomes.decisions = ['d1'];
    state.outcomes.risks = ['r1', 'r2'];
    const result = formatCurrentOutcomes();
    expect(result).toContain('Decisions:\nd1');
    expect(result).toContain('Risks:\nr1\nr2');
  });
});
