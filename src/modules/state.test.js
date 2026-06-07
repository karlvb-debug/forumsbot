import { describe, it, expect, vi, beforeEach } from 'vitest';

// state.js uses crypto.randomUUID — ensure it's available in jsdom
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) };
}

vi.mock('./constants.js', async () => {
  const { defaultState: ds } = await import('./constants.js');
  return {
    STORAGE_KEY: 'forum-state-v1',
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

describe('normalizeState — settings defaults', () => {
  it('defaults missing toolsEnabled to false', () => {
    const result = normalizeState({ settings: {} });
    expect(result.settings.toolsEnabled).toBe(false);
  });

  it('preserves explicit toolsEnabled true', () => {
    const result = normalizeState({ settings: { toolsEnabled: true } });
    expect(result.settings.toolsEnabled).toBe(true);
  });

  it('defaults missing globalStyleEnabled to true', () => {
    const result = normalizeState({ settings: {} });
    expect(result.settings.globalStyleEnabled).toBe(true);
    expect(result.settings.globalStylePrompt).toContain('Use plain everyday language');
  });

  it('preserves explicit globalStyleEnabled false', () => {
    const result = normalizeState({ settings: { globalStyleEnabled: false } });
    expect(result.settings.globalStyleEnabled).toBe(false);
  });

  it('migrates legacy plainLanguageDefault false to globalStyleEnabled false', () => {
    const result = normalizeState({ settings: { plainLanguageDefault: false } });
    expect(result.settings.globalStyleEnabled).toBe(false);
    expect(result.settings.plainLanguageDefault).toBeUndefined();
  });
});

// ── pendingPauses normalization ───────────────────────────────────────────────
describe('normalizeState — cadence migration & loop guard', () => {
  it('migrates legacy every-turn director to a per-round cadence (loop guard)', () => {
    const result = normalizeState({
      actors: [{ name: 'Director', canDirect: true, actorMode: 'background', turnSchedule: 'every-turn' }],
    });
    expect(result.actors[0].cadence).toEqual({ unit: 'round', n: 1 });
    expect(result.actors[0].actorMode).toBe('background');
  });

  it('demotes a background actor saved with per-turn cadence to per-round', () => {
    const result = normalizeState({
      actors: [{ name: 'Mgr', canManageCast: true, actorMode: 'background', cadence: { unit: 'turn', n: 1 } }],
    });
    expect(result.actors[0].cadence).toEqual({ unit: 'round', n: 1 });
    expect(result.actors[0].actorMode).toBe('background');
  });

  it('leaves a visible participant on a per-turn cadence alone', () => {
    const result = normalizeState({
      actors: [{ name: 'Chatty', actorMode: 'participant', cadence: { unit: 'turn', n: 1 } }],
    });
    expect(result.actors[0].cadence).toEqual({ unit: 'turn', n: 1 });
  });

  it('keeps an explicit every-N-turns background cadence (n>1) as-is', () => {
    const result = normalizeState({
      actors: [{ name: 'Periodic', actorMode: 'background', cadence: { unit: 'turn', n: 3 } }],
    });
    expect(result.actors[0].cadence).toEqual({ unit: 'turn', n: 3 });
  });

  it('drops on_every_turn from triggerOn (folded into cadence)', () => {
    const result = normalizeState({
      actors: [{ name: 'D', canDirect: true, actorMode: 'background', triggerOn: ['on_every_turn', 'on_conflict'] }],
    });
    expect(result.actors[0].triggerOn).toEqual(['on_conflict']);
    expect(result.actors[0].cadence).toEqual({ unit: 'round', n: 1 });
    expect(result.actors[0].actorMode).toBe('background');
  });
});

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
    const result = normalizeState({ scenario: {} });
    expect(result.scenario.systems.stageDirections.enabled).toBe(false);
    expect(result.scenario.systems.alignment.strictness).toBe('moderate');
    expect(result.scenario.systems.dmRole.role).toBe('facilitator');
    expect(result.scenario.mode).toBeUndefined();
  });

  it('preserves partial system overrides without clobbering siblings', () => {
    const result = normalizeState({
      scenario: {
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

  it('deep-merges systems without losing unset fields', () => {
    const result = normalizeState({
      scenario: {
        systems: {
          stageDirections: { enabled: true },
        },
      },
    });
    expect(result.scenario.systems.stageDirections.enabled).toBe(true);
    expect(result.scenario.systems.stageDirections.intensity).toBe('moderate');
    expect(result.scenario.systems.stageDirections.maxTokenShare).toBe(0.2);
  });

  it('migrates legacy routing strategies to speaking-order values', () => {
    const result = normalizeState({
      scenario: {
        systems: { turnRouting: { strategy: 'dm-directed' } },
      },
    });
    expect(result.scenario.systems.turnRouting.strategy).toBe('agentic');
  });

  it('migrates legacy story mode into explicit systems and strips mode', () => {
    const result = normalizeState({
      scenario: { mode: 'story' },
      actors: [{ name: 'Director', canDirect: true }],
    });
    expect(result.scenario.mode).toBeUndefined();
    expect(result.scenario.systems.stageDirections.enabled).toBe(true);
    expect(result.scenario.systems.alignment.strictness).toBe('loose');
    expect(result.scenario.systems.turnRouting.strategy).toBe('agentic');
    expect(result.scenario.systems.dmRole.role).toBe('narrator');
    expect(result.scenario.systems.document).toBeUndefined();
    expect(result.actors[0].directorMode).toBe('narrator');
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

describe('normalizeState — document writer migration', () => {
  it('keeps an active designated writer when valid', () => {
    const result = normalizeState({
      documentWriting: { designatedWriterId: 'w1' },
      actors: [{ id: 'w1', name: 'Writer', enabled: true, canWriteDocuments: true }],
    });
    expect(result.actors[0].canWriteDocuments).toBe(true);
    expect(result.documentWriting.designatedWriterId).toBe('w1');
  });

  it('falls back to the first active writer when the saved writer is invalid', () => {
    const result = normalizeState({
      documentWriting: { designatedWriterId: 'missing' },
      actors: [{ id: 'w1', name: 'Writer', enabled: true, canWriteDocuments: true }],
    });
    expect(result.documentWriting.designatedWriterId).toBe('w1');
  });

  it('defaults scribeMode to manual when missing', () => {
    const result = normalizeState({ documentWriting: { designatedWriterId: '' } });
    expect(result.documentWriting.scribeMode).toBe('manual');
  });

  it('preserves a valid scribeMode', () => {
    const result = normalizeState({ documentWriting: { scribeMode: 'ask' } });
    expect(result.documentWriting.scribeMode).toBe('ask');
  });

  it('coerces an unknown scribeMode back to manual', () => {
    const result = normalizeState({ documentWriting: { scribeMode: 'nonsense' } });
    expect(result.documentWriting.scribeMode).toBe('manual');
  });
});

describe('normalizeState — actor permissions', () => {
  it('maps legacy canDirect to true for the new permission fields by default', () => {
    const result = normalizeState({
      actors: [
        { name: 'Legacy Director', canDirect: true }
      ]
    });
    expect(result.actors[0].canDirect).toBe(true);
    expect(result.actors[0].canPause).toBe(true);
    expect(result.actors[0].canAnchor).toBe(true);
    expect(result.actors[0].canPinFacts).toBe(true);
    expect(result.actors[0].canSuggestSpeaker).toBe(true);
    expect(result.actors[0].canUpdateStyle).toBe(true);
  });

  it('restricts new permissions for legacy manager and researcher roles', () => {
    const result = normalizeState({
      actors: [
        { name: 'Legacy Manager', canManageCast: true },
        { name: 'Legacy Researcher', canResearch: true }
      ]
    });
    expect(result.actors[0].canPause).toBe(false);
    expect(result.actors[0].canAnchor).toBe(false);
    expect(result.actors[1].canPause).toBe(false);
    expect(result.actors[1].canAnchor).toBe(false);
  });

  it('keeps standard participant permissions for clean non-manager/non-researcher actors', () => {
    const result = normalizeState({
      actors: [
        { name: 'Normal Participant' }
      ]
    });
    expect(result.actors[0].canPause).toBe(true);
    expect(result.actors[0].canAnchor).toBe(true);
    expect(result.actors[0].canSuggestSpeaker).toBe(true);
  });

  it('respects explicitly set boolean values for the new permissions', () => {
    const result = normalizeState({
      actors: [
        {
          name: 'Custom Actor',
          canPause: false,
          canAnchor: true,
          canPinFacts: false,
          canSuggestSpeaker: true,
          canUpdateStyle: false
        }
      ]
    });
    expect(result.actors[0].canPause).toBe(false);
    expect(result.actors[0].canAnchor).toBe(true);
    expect(result.actors[0].canPinFacts).toBe(false);
    expect(result.actors[0].canSuggestSpeaker).toBe(true);
    expect(result.actors[0].canUpdateStyle).toBe(false);
  });
});

