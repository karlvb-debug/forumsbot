/**
 * Streaming state hook — handles high-frequency text updates from
 * AI generation without going through the full saveState cycle.
 *
 * Replaces the imperative showStreamingBubble/updateStreamingBubble/
 * removeStreamingBubble pattern from render.js.
 */
import { useSyncExternalStore, useCallback } from 'react';

// ── Streaming state (separate from main state for performance) ──────
let _streaming = null; // { speaker, color, type, text }
let _version = 0;
const _listeners = new Set();

function notify() {
  _version++;
  _listeners.forEach(fn => fn());
}

function subscribe(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

// ── Public API (called by turns.js) ─────────────────────────────────

/** Show streaming bubble for a speaker */
export function showStreamingBubble(speaker, color, type) {
  _streaming = { speaker, color, type, text: '' };
  notify();
}

/** Update streaming text (called on every token) */
export function updateStreamingBubble(text) {
  if (_streaming) {
    _streaming = { ..._streaming, text };
    notify();
  }
}

/** Remove streaming bubble (generation complete) */
export function removeStreamingBubble() {
  if (_streaming) {
    _streaming = null;
    notify();
  }
}

/** Force remove (error/abort path) */
export function forceRemoveStreamingBubble() {
  _streaming = null;
  notify();
}

// ── React hook ──────────────────────────────────────────────────────

/**
 * Subscribe to streaming state. Returns null when not streaming,
 * or { speaker, color, type, text } during generation.
 */
export function useStreaming() {
  const getSnapshot = useCallback(() => _streaming, []);
  return useSyncExternalStore(subscribe, getSnapshot);
}
