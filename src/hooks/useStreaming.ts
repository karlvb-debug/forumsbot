/**
 * Streaming state hook — handles high-frequency text updates from
 * AI generation without going through the full saveState cycle.
 */
import { useSyncExternalStore, useCallback } from 'react';
import type { MessageType } from '../types.js';

export interface StreamingState {
  speaker: string;
  color: string;
  type: MessageType;
  text: string;
}

let _streaming: StreamingState | null = null;
let _version = 0;
const _listeners = new Set<() => void>();

function notify(): void {
  _version++;
  _listeners.forEach(fn => fn());
}

function subscribe(cb: () => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

export function showStreamingBubble(speaker: string, color: string, type: MessageType): void {
  _streaming = { speaker, color, type, text: '' };
  notify();
}

export function updateStreamingBubble(text: string): void {
  if (_streaming) {
    _streaming = { ..._streaming, text };
    notify();
  }
}

export function removeStreamingBubble(): void {
  if (_streaming) {
    _streaming = null;
    notify();
  }
}

export function forceRemoveStreamingBubble(): void {
  _streaming = null;
  notify();
}

export function useStreaming(): StreamingState | null {
  const getSnapshot = useCallback(() => _streaming, []);
  return useSyncExternalStore(subscribe, getSnapshot);
}
