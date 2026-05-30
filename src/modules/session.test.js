import { describe, it, expect, vi } from 'vitest';

if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = { randomUUID: () => 'test-uuid' };
}

vi.stubGlobal('localStorage', {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
});

import { state } from './state.js';
import { applyAssistantPatch } from './session.js';

describe('applyAssistantPatch', () => {
  it('correctly adds a new actor with custom permissions and authority', () => {
    state.actors = [];

    applyAssistantPatch({
      addActors: [
        {
          name: 'Manager Bob',
          role: 'Coordinator',
          persona: 'Organized',
          goal: 'Manage cast',
          canManageCast: true,
          canDirect: true,
          canResearch: true,
          canSeeThoughts: true,
          authority: 85,
        }
      ]
    });

    expect(state.actors).toHaveLength(1);
    const actor = state.actors[0];
    expect(actor.name).toBe('Manager Bob');
    expect(actor.canManageCast).toBe(true);
    expect(actor.canDirect).toBe(true);
    expect(actor.canResearch).toBe(true);
    expect(actor.canSeeThoughts).toBe(true);
    expect(actor.authority).toBe(85);
  });

  it('correctly modifies an existing actor and maps legacy permission fields', () => {
    state.actors = [
      {
        id: 'actor-1',
        name: 'Architect',
        role: 'Designer',
        canDirect: false,
        canManageCast: false,
        canResearch: false,
        canSeeThoughts: false,
        authority: 50,
      }
    ];

    applyAssistantPatch({
      modifyActors: [
        {
          find: 'Architect',
          authority: 90,
          isManager: true, // legacy map to canManageCast
          isResearcher: true, // legacy map to canResearch
          isDirector: true, // legacy map to canDirect
        }
      ]
    });

    const actor = state.actors[0];
    expect(actor.authority).toBe(90);
    expect(actor.canManageCast).toBe(true);
    expect(actor.canResearch).toBe(true);
    expect(actor.canDirect).toBe(true);
  });
  it('correctly deep merges scenario systems nested objects', () => {
    state.scenario = {
      mode: 'problem',
      title: 'Initial Title',
      systems: {
        stageDirections: { enabled: false, intensity: 'moderate' },
        alignment: { strictness: 'moderate' }
      }
    };

    applyAssistantPatch({
      scenario: {
        systems: {
          stageDirections: { enabled: true }
        }
      }
    });

    expect(state.scenario.systems.stageDirections.enabled).toBe(true);
    expect(state.scenario.systems.stageDirections.intensity).toBe('moderate');
    expect(state.scenario.systems.alignment.strictness).toBe('moderate');
  });

  it('correctly creates a director when none exists', () => {
    state.actors = [];
    applyAssistantPatch({
      dm: {
        enabled: true,
        name: 'The Overlord',
        persona: 'All-seeing'
      }
    });

    expect(state.actors).toHaveLength(1);
    expect(state.actors[0].canDirect).toBe(true);
    expect(state.actors[0].name).toBe('The Overlord');
    expect(state.actors[0].persona).toBe('All-seeing');
  });

  it('correctly merges userContext and nested pausePolicy', () => {
    state.userContext = {
      displayName: 'Alice',
      interactionMode: 'collaborator',
      pausePolicy: {
        maxPausesPerRound: 2,
        honoredWindow: 0
      }
    };

    applyAssistantPatch({
      userContext: {
        displayName: 'Bob',
        pausePolicy: {
          maxPausesPerRound: 5
        }
      }
    });

    expect(state.userContext.displayName).toBe('Bob');
    expect(state.userContext.interactionMode).toBe('collaborator');
    expect(state.userContext.pausePolicy.maxPausesPerRound).toBe(5);
    expect(state.userContext.pausePolicy.honoredWindow).toBe(0);
  });
});

describe('blueprints', () => {
  it('exposes applyBlueprint and the blueprint data/builders', async () => {
    const session = await import('./session.js');
    const blueprints = await import('./blueprints.js');
    // Guards against the class of bug where the UI references functions that
    // were never actually defined/exported (silent white-screen at runtime).
    expect(typeof session.applyBlueprint).toBe('function');
    expect(Array.isArray(blueprints.BLUEPRINTS)).toBe(true);
    expect(blueprints.BLUEPRINTS.length).toBeGreaterThan(0);
    expect(Array.isArray(blueprints.ACTOR_LIBRARY)).toBe(true);
  });

  it('every blueprint cast key resolves to a real library actor', async () => {
    const { BLUEPRINTS, ACTOR_LIBRARY, blueprintCast } = await import('./blueprints.js');
    const keys = new Set(ACTOR_LIBRARY.map(a => a.key));
    for (const bp of BLUEPRINTS) {
      for (const k of bp.cast) {
        expect(keys.has(k), `blueprint "${bp.id}" references missing actor "${k}"`).toBe(true);
      }
      // blueprintCast must produce one buildable member per cast key
      expect(blueprintCast(bp.id)).toHaveLength(bp.cast.length);
    }
  });

  it('applyBlueprint installs the cast and preserves orchestration fields', async () => {
    const { applyBlueprint } = await import('./session.js');
    state.messages = [];
    await applyBlueprint('code-review');
    expect(state.actors.length).toBe(4);
    // The review lead is a background director — scheduling fields must survive
    // (normalizeQuickStartActor would have dropped these; the blueprint builder must not).
    const lead = state.actors.find(a => a.canDirect);
    expect(lead).toBeTruthy();
    expect(lead.turnSchedule).toBe('every-turn');
    expect(state.scenario.title).toBe('Code Review');
    expect(state.autoStop.roundsRun).toBe(0);
  });
});

describe('configurations', () => {
  it('round-trips a saved configuration through localStorage', async () => {
    // Stateful localStorage so save → list actually persists within the test.
    const store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    });
    const session = await import('./session.js');

    state.scenario = { ...state.scenario, title: 'My Setup' };
    state.actors = [{ id: 'a1', name: 'A', enabled: true }];

    const saved = session.saveConfiguration('Saved One');
    expect(saved.name).toBe('Saved One');

    const list = session.listConfigurations();
    expect(list.some(c => c.id === saved.id)).toBe(true);

    session.deleteConfiguration(saved.id);
    expect(session.listConfigurations().some(c => c.id === saved.id)).toBe(false);
  });
});

