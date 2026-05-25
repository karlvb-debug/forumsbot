/**
 * State bridge: connects the mutable global `state` object to React's
 * rendering cycle via useSyncExternalStore.
 *
 * Logic modules continue to mutate `state` directly.
 * After mutation, they call `notifyStateChange()` (or the patched `saveState`)
 * which bumps a version counter and notifies all React subscribers.
 */
import { useSyncExternalStore, useRef, useCallback } from 'react';
import { state, saveState as originalSaveState, registerSaveCallback } from '../modules/state.js';

// ── Subscription system ──────────────────────────────────────────────
let _version = 0;
const _listeners = new Set();

/** Notify React that state has changed. Call after mutating `state`. */
export function notifyStateChange() {
  _version++;
  _listeners.forEach(fn => fn());
}

// Wire: every saveState() call from ANY module now notifies React.
registerSaveCallback(notifyStateChange);

/**
 * Patched saveState: persists to localStorage AND notifies React.
 * Since registerSaveCallback wires notifyStateChange to every saveState() call,
 * this is now just an alias — but kept for import compatibility.
 */
export function saveState() {
  originalSaveState();
}

function subscribe(callback) {
  _listeners.add(callback);
  return () => _listeners.delete(callback);
}

function getVersion() {
  return _version;
}

// ── Hooks ────────────────────────────────────────────────────────────

/**
 * Subscribe to a slice of Forum state. Forces re-render when state version
 * changes, then re-runs the selector.
 *
 * Usage:
 *   const actors = useForumState(s => s.actors);
 *   const theme = useForumState(s => s.settings.theme);
 */
export function useForumState(selector) {
  // Subscribe to version changes — this is a stable primitive (number)
  // so useSyncExternalStore is happy.
  useSyncExternalStore(subscribe, getVersion);
  // Run selector on current state
  return selector(state);
}

/**
 * Get the raw state object for imperative reads (not reactive).
 * Use sparingly — prefer useForumState for reactive subscriptions.
 */
export function getState() {
  return state;
}

/**
 * Mutate state and notify React.
 * Usage: mutateState(s => { s.settings.theme = 'light'; });
 */
export function mutateState(fn) {
  fn(state);
  saveState();
}
