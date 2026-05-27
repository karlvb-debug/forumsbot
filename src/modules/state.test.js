import { describe, it, expect, vi, beforeEach } from 'vitest';

// state.js uses crypto.randomUUID — ensure it's available in jsdom
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) };
}

vi.mock('./constants.js', async () => {
  const { defaultState: ds } = await import('./constants.js');
  return {
    STORAGE_KEY: 'forum-state-v1',
    VALID_TABS: ['setup', 'conversation', 'memory'],
    colors: ['#18726d', '#b84738'],
    defaultState: ds,
  };
});

// Prevent localStorage access in loadState()
vi.stubGlobal('localStorage', {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
});

import { normalizeState } from './state.js';
import { defaultState } from './constants.js';

// ── userContext normalization ──────────────────────────────────────────────────
describe('normalizeState — userContext', () => {
  it('fills in default userContext when absent from stored state', () => {
    const result = normalizeState({});
    expect(result.userContext.interactionMode).toBe('collaborator');
    expect(result.userContext.displayName).toBe('');
    expect(result.userContext.storyRole).toBe('');
    expect(typeof result.userContext.pausePolicy).toBe('object');
  });

  it('preserves stored interactionMode, displayName, storyRole', () => {
    const result = normalizeState({
      userContext: {
        interactionMode: 'sponsor',
        displayName: 'Alice',
        storyRole: 'The Mayor',
      },
    });
    expect(result.userContext.interactionMode).toBe('sponsor');
    expect(result.userContext.displayName).toBe('Alice');
    expect(result.userContext.storyRole).toBe('The Mayor');
  });

  it('deep-merges pausePolicy — custom overrides default fields, rest retained', () => {
    const result = normalizeState({
      userContext: {
        interactionMode: 'collaborator',
        pausePolicy: { maxPausesPerRound: 5 },
      },
    });
    expect(result.userContext.pausePolicy.maxPausesPerRound).toBe(5);
    // allowedReasons should come from defaultState (not lost)
    expect(Array.isArray(result.userContext.pausePolicy.allowedReasons)).toBe(true);
  });

  it('does not break when userContext has unexpected extra fields', () => {
    const result = normalizeState({
      userContext: {
        interactionMode: 'observer',
        unknownField: 'ignored',
      },
    });
    expect(result.userContext.interactionMode).toBe('observer');
    expect(result.userContext.unknownField).toBe('ignored');
  });
});

// ── pendingPauses normalization ───────────────────────────────────────────────
describe('normalizeState — pendingPauses', () => {
  it('initializes pendingPauses as empty array when absent', () => {
    const result = normalizeState({});
    expect(Array.isArray(result.pendingPauses)).toBe(true);
    expect(result.pendingPauses).toHaveLength(0);
  });

  it('preserves existing pendingPauses array', () => {
    const record = { id: 'abc', outcome: 'resolved', userResponse: 'yes' };
    const result = normalizeState({ pendingPauses: [record] });
    expect(result.pendingPauses).toHaveLength(1);
    expect(result.pendingPauses[0].id).toBe('abc');
  });

  it('resets non-array pendingPauses to empty array', () => {
    const result = normalizeState({ pendingPauses: 'corrupt' });
    expect(Array.isArray(result.pendingPauses)).toBe(true);
    expect(result.pendingPauses).toHaveLength(0);
  });
});

// ── pause UI state reset ──────────────────────────────────────────────────────
describe('normalizeState — pause UI state reset', () => {
  it('always resets ui.pauseModal to null (never persisted)', () => {
    const result = normalizeState({ ui: { pauseModal: { pauseRecord: { id: 'x' } } } });
    expect(result.ui.pauseModal).toBeNull();
  });

  it('always resets ui.awaitingUserInput to false (never persisted)', () => {
    const result = normalizeState({ ui: { awaitingUserInput: true } });
    expect(result.ui.awaitingUserInput).toBe(false);
  });
});

// ── scenario.systems deep-merge ───────────────────────────────────────────────
describe('normalizeState — scenario.systems deep-merge', () => {
  it('fills missing systems with defaults', () => {
    const result = normalizeState({ scenario: { mode: 'problem' } });
    expect(result.scenario.systems.stageDirections.enabled).toBe(false);
    expect(result.scenario.systems.alignment.strictness).toBe('moderate');
    expect(result.scenario.systems.dmRole.role).toBe('facilitator');
  });

  it('preserves partial system overrides without clobbering siblings', () => {
    const result = normalizeState({
      scenario: {
        mode: 'problem',
        systems: {
          stageDirections: { enabled: true, intensity: 'immersive' },
        },
      },
    });
    expect(result.scenario.systems.stageDirections.enabled).toBe(true);
    expect(result.scenario.systems.stageDirections.intensity).toBe('immersive');
    // sibling systems untouched
    expect(result.scenario.systems.alignment.strictness).toBe('moderate');
    expect(result.scenario.systems.dmRole.role).toBe('facilitator');
  });

  it('deep-merges alignment subsystem without losing unset fields', () => {
    const result = normalizeState({
      scenario: {
        systems: {
          alignment: { strictness: 'loose' },
        },
      },
    });
    expect(result.scenario.systems.alignment.strictness).toBe('loose');
    expect(result.scenario.systems.alignment.nudgeStyle).toBe('gentle-nudge');
    expect(result.scenario.systems.alignment.anchorInPrompt).toBe(false);
  });
});

// ── document migration ────────────────────────────────────────────────────────
describe('normalizeState — document migration', () => {
  it('migrates old state.document to documents[] as aiEditable entry', () => {
    const result = normalizeState({
      document: { title: 'Meeting Notes', content: 'hello world', enabled: true },
    });
    expect(Array.isArray(result.documents)).toBe(true);
    const doc = result.documents.find(d => d.aiEditable);
    expect(doc).toBeDefined();
    expect(doc.title).toBe('Meeting Notes');
    expect(doc.content).toBe('hello world');
  });

  it('migrates knowledgeBase entries to read-only reference documents', () => {
    const result = normalizeState({
      knowledgeBase: [
        { id: 'kb1', title: 'Ref Doc', content: 'reference content', type: 'document' },
      ],
    });
    const ref = result.documents.find(d => d.id === 'kb1');
    expect(ref).toBeDefined();
    expect(ref.aiEditable).toBe(false);
    expect(ref.content).toBe('reference content');
  });

  it('passes through existing documents[] unchanged', () => {
    const existing = [
      { id: 'doc1', title: 'Existing', content: 'data', type: 'document', aiEditable: true, enabled: true, versions: [], lineAttribution: [] },
    ];
    const result = normalizeState({ documents: existing });
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].id).toBe('doc1');
    expect(result.documents[0].aiEditable).toBe(true);
  });
});
