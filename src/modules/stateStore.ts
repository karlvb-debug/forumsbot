/**
 * State store — framework-agnostic subscription + mutation layer over the
 * mutable global `state` object (defined in state.js).
 *
 * Module-layer code mutates `state` directly and calls notifyStateChange()
 * (or mutateState / saveState) afterwards. The React bridge in
 * hooks/useForumState.ts wraps subscribe/getVersion via useSyncExternalStore.
 * No React imports here.
 */
import { state, saveState as originalSaveState, registerSaveCallback } from './state.js';
import type { ForumState } from '../types.js';

// ── Subscription system ──────────────────────────────────────────────
let _version = 0;
const _listeners = new Set<() => void>();

/** Notify subscribers that state has changed. Call after mutating `state`. */
export function notifyStateChange(): void {
  _version++;
  _listeners.forEach(fn => fn());
}

// Wire: every saveState() call from ANY module now notifies subscribers.
registerSaveCallback(notifyStateChange);

/** Persist to localStorage (and, via the registered callback, notify). */
export function saveState(): void {
  originalSaveState();
}

/** Subscribe to state-version changes. Returns an unsubscribe function. */
export function subscribe(callback: () => void): () => void {
  _listeners.add(callback);
  return () => _listeners.delete(callback);
}

/** Monotonic version counter — the snapshot value for useSyncExternalStore. */
export function getVersion(): number {
  return _version;
}

/**
 * Mutate state and notify subscribers immediately. localStorage
 * serialization is debounced 300ms to avoid hammering JSON.stringify
 * on rapid successive mutations.
 */
let _saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
export function mutateState(fn: (s: ForumState) => void): void {
  fn(state as ForumState);
  notifyStateChange();
  if (_saveDebounceTimer) clearTimeout(_saveDebounceTimer);
  _saveDebounceTimer = setTimeout(() => {
    _saveDebounceTimer = null;
    originalSaveState();
  }, 300);
}
