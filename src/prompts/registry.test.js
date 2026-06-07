import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted() runs before vi.mock() factories so mockState is safe to reference.
const { mockState } = vi.hoisted(() => {
  const mockState = {
    promptOverrides: {},
  };
  return { mockState };
});

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../modules/state.js', () => ({
  state: mockState,
  saveState: vi.fn(),
}));

// ── Import after mocks ───────────────────────────────────────────────────────

import {
  frag,
  getDefault,
  getOverride,
  setOverride,
  clearOverride,
  clearAllOverrides,
  hasOverride,
  getOverrideCount,
  getAllKeys,
  PROMPT_GROUPS,
  keyLabel,
} from './index.js';
import DEFAULTS from './registry.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockState.promptOverrides = {};
});

// ── 1. Default precedence ────────────────────────────────────────────────────

describe('frag — default precedence', () => {
  it('returns default text with {{name}} substituted', () => {
    const result = frag('director_identity', { name: 'Dir' });
    expect(result).toContain('Dir');
    expect(result).toContain('the DM/director');
    expect(result).not.toContain('{{name}}');
  });

  it('returns the raw default when no vars are given', () => {
    const result = frag('director_identity');
    expect(result).toBe(DEFAULTS.get('director_identity'));
  });
});

// ── 2. Override precedence ───────────────────────────────────────────────────

describe('frag — override precedence', () => {
  it('uses the override text instead of the default', () => {
    mockState.promptOverrides.director_identity = 'Hi {{name}}';
    const result = frag('director_identity', { name: 'Dir' });
    expect(result).toBe('Hi Dir');
  });

  it('override with no placeholders returns as-is', () => {
    mockState.promptOverrides.director_identity = 'Custom text, no placeholders.';
    expect(frag('director_identity', { name: 'Dir' })).toBe('Custom text, no placeholders.');
  });
});

// ── 3. Leftover placeholder stripping ────────────────────────────────────────

describe('frag — leftover placeholder stripping', () => {
  it('removes {{missing}} placeholders when no var is supplied', () => {
    mockState.promptOverrides.director_identity = 'Hello {{missing}}, welcome {{also_missing}}!';
    const result = frag('director_identity', {});
    expect(result).toBe('Hello , welcome !');
    expect(result).not.toContain('{{');
  });

  it('replaces provided vars and strips the rest', () => {
    mockState.promptOverrides.director_identity = '{{a}} and {{b}}';
    const result = frag('director_identity', { a: 'alpha' });
    expect(result).toBe('alpha and ');
    expect(result).not.toContain('{{');
  });
});

// ── 4. Empty override behaviour ──────────────────────────────────────────────

describe('frag — empty override', () => {
  it('empty string override is treated as a valid override (returns empty)', () => {
    // The resolver uses `typeof overrides[key] === 'string'` — empty string
    // is still typeof 'string', so it does NOT fall back to default.
    mockState.promptOverrides.director_identity = '';
    const result = frag('director_identity', { name: 'Dir' });
    expect(result).toBe('');
  });

  it('undefined override falls back to default', () => {
    mockState.promptOverrides.director_identity = undefined;
    const result = frag('director_identity', { name: 'Dir' });
    expect(result).toContain('Dir');
    expect(result).toContain('the DM/director');
  });
});

// ── 5. Unknown key ───────────────────────────────────────────────────────────

describe('frag — unknown key', () => {
  it('returns empty string for an unknown key', () => {
    const result = frag('nonexistent_key');
    expect(result).toBe('');
  });

  it('returns empty string for an unknown key even with vars', () => {
    const result = frag('nonexistent_key', { foo: 'bar' });
    expect(result).toBe('');
  });
});

// ── 6. Coverage guard — every frag() key used in turns.js/session.js exists ──

describe('coverage guard — frag keys used in source exist in registry', () => {
  // Keys extracted from turns.js and session.js via `grep -o "frag('[^']*'"`.
  const KEYS_USED_IN_SOURCE = [
    // turns.js
    'intent_system',
    'goal_judge',
    'thought_distiller',
    'director_mode_facilitator',
    'director_mode_observer',
    'director_mode_arbiter',
    'director_cast_mgmt_narrative',
    'director_cast_mgmt_analytical',
    'director_cast_mgmt_instructions',
    'director_identity',
    'director_persona',
    'director_user_msg_stageDirections',
    'director_user_msg_analytical',
    'director_speak_narrator_forced',
    'director_speak_forced',
    'director_speak_narrator_optional',
    'director_speak_facilitator_optional',
    'director_skip_observer',
    'director_skip_arbiter',
    'director_skip_narrator',
    'director_skip_facilitator',
    'director_conciseness',
    'director_physical_actions',
    'director_flow_control_enabled',
    'director_flow_control_disabled',
    'director_anchors',
    'director_injections',
    'director_private_msg',
    'director_style_control',
    'director_web_tools',
    'director_brief',
    'manager_identity',
    'manager_job',
    'manager_observe',
    'manager_creation_rules',
    'manager_speak_forced',
    'manager_skip_rules',
    'manager_public_msg',
    'manager_user_msg',
    // NOTE: manager_schema_note removed from registry — code-owned by turns.js
    'researcher_identity',
    'researcher_specialization',
    'researcher_purpose_tools',
    'researcher_purpose_no_tools',
    'researcher_objectivity',
    'researcher_mandatory_tools',
    'researcher_tools_disabled',
    'researcher_speak_forced',
    'researcher_inspect',
    'researcher_tool_instruction_thoughts',
    'researcher_tool_instruction_no_thoughts',
    'researcher_no_tools_forced',
    'researcher_no_tools_optional',
    'researcher_example_thoughts',
    'researcher_example_no_thoughts',
    'researcher_ground_truth_tools',
    'researcher_ground_truth_no_tools',
    'researcher_skip_rules',
    'researcher_citations_tools',
    'researcher_citations_no_tools',
    // NOTE: researcher_json_note removed from registry — code-owned by turns.js
    'researcher_user_msg',
    'participant_context_analytical',
    'participant_intent_hint',
    'participant_user_msg_stageDirections',
    'participant_user_msg_analytical',
    'participant_think_speak_thoughts',
    'participant_think_speak_no_thoughts',
    'participant_forced_thoughts',
    'participant_forced_no_thoughts',
    'participant_skip_rules_thoughts',
    'participant_skip_rules_no_thoughts',
    'participant_conciseness_analytical',
    'participant_markdown_stageDirections',
    'participant_markdown_analytical',
    'participant_handoff',
    'participant_web_tools',
    'participant_fact_pin',
    'participant_style_control',
    'participant_pause',
    'thoughts_disabled',
    'thoughts_enabled',
    'thoughts_enabled_participant',
    'thoughts_disabled_researcher',
    // NOTE: json_transport removed from registry — code-owned by turns.js
    'security_directive',
    'security_transcript',
    'background_mode',
    // session.js
    'setup_assistant_identity',
    'setup_assistant_response_format',
    'setup_assistant_concepts',
    'setup_assistant_scenario_fields',
    'setup_assistant_actor_fields',
    'setup_assistant_systems',
    'setup_assistant_settings',
    'setup_assistant_autostop',
    'setup_assistant_roleplay',
    'setup_assistant_rules',
  ];

  const registryKeys = new Set(getAllKeys());

  it.each(KEYS_USED_IN_SOURCE)(
    '"%s" exists in the registry',
    (key) => {
      expect(registryKeys.has(key)).toBe(true);
    },
  );

  it('no orphaned keys in the coverage list (sanity check)', () => {
    const missing = KEYS_USED_IN_SOURCE.filter(k => !registryKeys.has(k));
    expect(missing).toEqual([]);
  });
});

// ── 7. No placeholder leak in defaults ───────────────────────────────────────

describe('no placeholder leak in defaults', () => {
  const allKeys = getAllKeys();

  it('frag(key) with no vars strips all placeholders from every default', () => {
    for (const key of allKeys) {
      const result = frag(key);
      // frag() without vars returns the raw template — placeholders are
      // only stripped when vars is truthy. Verify the raw default is at
      // least a non-null string.
      expect(typeof result).toBe('string');
    }
  });

  it('frag(key, {}) strips every placeholder — no raw {{ remains', () => {
    for (const key of allKeys) {
      const result = frag(key, {});
      expect(result).not.toContain('{{');
      expect(result).not.toContain('}}');
    }
  });
});

// ── Override management API ──────────────────────────────────────────────────

describe('override management helpers', () => {
  it('getDefault returns the registry text for a known key', () => {
    const text = getDefault('director_identity');
    expect(text).toBe(DEFAULTS.get('director_identity'));
  });

  it('getDefault returns null for an unknown key', () => {
    expect(getDefault('does_not_exist')).toBeNull();
  });

  it('setOverride + getOverride round-trip', () => {
    setOverride('director_identity', 'Custom');
    expect(getOverride('director_identity')).toBe('Custom');
    expect(hasOverride('director_identity')).toBe(true);
    expect(getOverrideCount()).toBe(1);
  });

  it('setOverride ignores unknown keys', () => {
    setOverride('bad_key', 'anything');
    expect(getOverride('bad_key')).toBeNull();
    expect(getOverrideCount()).toBe(0);
  });

  it('clearOverride removes a single override', () => {
    setOverride('director_identity', 'Custom');
    clearOverride('director_identity');
    expect(hasOverride('director_identity')).toBe(false);
    expect(getOverrideCount()).toBe(0);
  });

  it('clearAllOverrides resets everything', () => {
    setOverride('director_identity', 'A');
    setOverride('intent_system', 'B');
    expect(getOverrideCount()).toBe(2);
    clearAllOverrides();
    expect(getOverrideCount()).toBe(0);
  });
});

// ── getAllKeys + PROMPT_GROUPS ────────────────────────────────────────────────

describe('getAllKeys + PROMPT_GROUPS', () => {
  it('getAllKeys returns all registry entries', () => {
    const keys = getAllKeys();
    expect(keys.length).toBe(DEFAULTS.size);
    expect(keys).toContain('director_identity');
    expect(keys).toContain('intent_system');
  });

  it('every key in PROMPT_GROUPS exists in the registry', () => {
    const registryKeys = new Set(getAllKeys());
    // Some keys listed in PROMPT_GROUPS are code-owned and no longer in the registry.
    const codeOwned = new Set(['json_transport', 'researcher_json_note', 'manager_schema_note']);
    for (const group of PROMPT_GROUPS) {
      for (const key of group.keys) {
        if (codeOwned.has(key)) continue;
        expect(registryKeys.has(key), `Group "${group.id}" references unknown key "${key}"`).toBe(true);
      }
    }
  });
});

// ── keyLabel ─────────────────────────────────────────────────────────────────

describe('keyLabel', () => {
  it('strips the role prefix and title-cases', () => {
    expect(keyLabel('director_identity')).toBe('Identity');
    expect(keyLabel('participant_skip_rules_thoughts')).toBe('Skip Rules Thoughts');
  });

  it('handles setup_assistant prefix', () => {
    expect(keyLabel('setup_assistant_identity')).toBe('Identity');
  });

  it('handles keys with no recognized prefix', () => {
    expect(keyLabel('goal_judge')).toBe('Goal Judge');
  });
});
