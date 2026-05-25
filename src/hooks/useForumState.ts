/**
 * State bridge: connects the mutable global `state` object to React's
 * rendering cycle via useSyncExternalStore.
 *
 * Logic modules continue to mutate `state` directly.
 * After mutation, they call `notifyStateChange()` (or the patched `saveState`)
 * which bumps a version counter and notifies all React subscribers.
 */
import { useSyncExternalStore } from 'react';
import { state, saveState as originalSaveState, registerSaveCallback } from '../modules/state.js';
import type { ForumState } from '../types.js';

// ── Subscription system ──────────────────────────────────────────────
let _version = 0;
const _listeners = new Set<() => void>();

/** Notify React that state has changed. Call after mutating `state`. */
export function notifyStateChange(): void {
  _version++;
  _listeners.forEach(fn => fn());
}

// Wire: every saveState() call from ANY module now notifies React.
registerSaveCallback(notifyStateChange);

/**
 * Patched saveState: persists to localStorage AND notifies React.
 */
export function saveState(): void {
  originalSaveState();
}

function subscribe(callback: () => void): () => void {
  _listeners.add(callback);
  return () => _listeners.delete(callback);
}

function getVersion(): number {
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
export function useForumState<T>(selector: (s: ForumState) => T): T {
  useSyncExternalStore(subscribe, getVersion);
  return selector(state as ForumState);
}

/**
 * Get the raw state object for imperative reads (not reactive).
 * Use sparingly — prefer useForumState for reactive subscriptions.
 */
export function getState(): ForumState {
  return state as ForumState;
}

/**
 * Mutate state and notify React.
 * Usage: mutateState(s => { s.settings.theme = 'light'; });
 */
export function mutateState(fn: (s: ForumState) => void): void {
  fn(state as ForumState);
  saveState();
}
