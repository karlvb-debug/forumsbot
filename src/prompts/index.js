/**
 * Prompt Resolver — reads prompt fragments with user-override support.
 *
 * Usage:
 *   import { frag } from '../prompts/index.js';
 *   const text = frag('director_identity', { name: actor.name });
 *
 * The resolver checks `state.promptOverrides[key]` first. If the user has
 * overridden a fragment, it uses that text; otherwise it falls back to the
 * registry default. Placeholders `{{key}}` in either source are resolved
 * against the `vars` object.
 *
 * Overrides are persisted as part of the state (localStorage) — no rebuild
 * or file editing required.
 */

import DEFAULTS from './registry.js';
import { state, saveState } from '../modules/state.js';

// ── Core resolver ──────────────────────────────────────────────────────────

/**
 * Resolve a prompt fragment by key.
 * @param {string} key     - Fragment key (must exist in registry.js)
 * @param {Object} [vars]  - Optional placeholder replacements: { name: 'Alice' }
 * @returns {string}       - Resolved text (override > default, with {{vars}} replaced)
 */
export function frag(key, vars) {
  const overrides = state.promptOverrides || {};
  const raw = (typeof overrides[key] === 'string') ? overrides[key] : DEFAULTS.get(key);
  if (raw == null) {
    console.warn(`[prompts] Unknown fragment key: "${key}"`);
    return '';
  }
  if (!vars) return raw;
  return raw.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const val = vars[k];
    return val != null ? String(val) : '';
  });
}

// ── Override management API (used by PromptsPanel) ─────────────────────────

/** Get the default (registry) text for a key. */
export function getDefault(key) {
  return DEFAULTS.get(key) ?? null;
}

/** Get the user's override for a key, or null if not overridden. */
export function getOverride(key) {
  return state.promptOverrides?.[key] ?? null;
}

/** Set (or update) a user override. */
export function setOverride(key, text) {
  if (!DEFAULTS.has(key)) {
    console.warn(`[prompts] Cannot override unknown key: "${key}"`);
    return;
  }
  if (!state.promptOverrides) state.promptOverrides = {};
  state.promptOverrides[key] = text;
  saveState();
}

/** Clear a single override (revert to default). */
export function clearOverride(key) {
  if (!state.promptOverrides) return;
  delete state.promptOverrides[key];
  saveState();
}

/** Clear ALL overrides (revert everything to defaults). */
export function clearAllOverrides() {
  state.promptOverrides = {};
  saveState();
}

/** List all registered fragment keys. */
export function getAllKeys() {
  return [...DEFAULTS.keys()];
}

/** Number of active user overrides. */
export function getOverrideCount() {
  return Object.keys(state.promptOverrides || {}).length;
}

/** Check if a specific key has a user override. */
export function hasOverride(key) {
  return typeof state.promptOverrides?.[key] === 'string';
}

// ── Fragment metadata for the UI ──────────────────────────────────────────

/** Logical groupings for the PromptsPanel UI. */
export const PROMPT_GROUPS = [
  {
    id: 'intent',
    label: 'Speaker Selection',
    keys: ['intent_system'],
  },
  {
    id: 'director',
    label: 'Director',
    keys: getAllKeys().filter(k => k.startsWith('director_')),
  },
  {
    id: 'manager',
    label: 'Manager',
    keys: getAllKeys().filter(k => k.startsWith('manager_')),
  },
  {
    id: 'researcher',
    label: 'Researcher',
    keys: getAllKeys().filter(k => k.startsWith('researcher_')),
  },
  {
    id: 'participant',
    label: 'Participant',
    keys: getAllKeys().filter(k => k.startsWith('participant_')),
  },
  {
    id: 'system',
    label: 'System',
    keys: ['goal_judge', 'thought_distiller', 'thoughts_disabled', 'thoughts_enabled',
           'thoughts_enabled_participant', 'thoughts_disabled_researcher',
           'security_directive', 'security_transcript', 'background_mode'],
  },
  {
    id: 'setup',
    label: 'Setup Assistant',
    keys: getAllKeys().filter(k => k.startsWith('setup_assistant_')),
  },
];

/** Human-readable label for a fragment key. */
export function keyLabel(key) {
  return key
    .replace(/^(director|manager|researcher|participant|setup_assistant|intent)_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
