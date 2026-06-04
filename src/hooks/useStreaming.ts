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
  thought: string;
  message: string;
}

export interface BackgroundActivity {
  id: string;
  label: string;
  detail: string;
  color: string;
}

let _streaming: StreamingState | null = null;
let _backgroundActivities: BackgroundActivity[] = [];
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
  _streaming = { speaker, color, type, thought: '', message: '' };
  notify();
}

export function updateStreamingBubble(data: { thought: string; message: string }): void {
  if (_streaming) {
    _streaming = { ..._streaming, thought: data.thought, message: data.message };
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

export function showBackgroundActivity(label: string, detail = '', color = 'var(--accent)'): string {
  const id = globalThis.crypto?.randomUUID?.() || `bg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  _backgroundActivities = [
    ..._backgroundActivities,
    { id, label, detail, color }
  ];
  notify();
  return id;
}

export function updateBackgroundActivity(id: string, updates: Partial<Omit<BackgroundActivity, 'id'>>): void {
  let changed = false;
  _backgroundActivities = _backgroundActivities.map(activity => {
    if (activity.id !== id) return activity;
    changed = true;
    return { ...activity, ...updates };
  });
  if (changed) notify();
}

export function hideBackgroundActivity(id: string): void {
  const next = _backgroundActivities.filter(activity => activity.id !== id);
  if (next.length !== _backgroundActivities.length) {
    _backgroundActivities = next;
    notify();
  }
}

export function clearBackgroundActivities(): void {
  if (_backgroundActivities.length) {
    _backgroundActivities = [];
    notify();
  }
}

export function useStreaming(): StreamingState | null {
  const getSnapshot = useCallback(() => _streaming, []);
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useBackgroundActivities(): BackgroundActivity[] {
  const getSnapshot = useCallback(() => _backgroundActivities, []);
  return useSyncExternalStore(subscribe, getSnapshot);
}
