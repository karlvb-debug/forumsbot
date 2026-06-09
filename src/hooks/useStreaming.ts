/**
 * Streaming hooks — React bindings over the framework-agnostic streaming
 * store in modules/streamingStore.js. The store holds the data and setters;
 * this file only wraps it for components via useSyncExternalStore and
 * re-exports the imperative setters for module-layer callers' convenience.
 */
import { useSyncExternalStore } from 'react';
import {
  subscribeStreaming,
  getStreamingSnapshot,
  getBackgroundActivitiesSnapshot,
} from '../modules/streamingStore.js';
import type { StreamingState, BackgroundActivity } from '../modules/streamingStore.js';

export type { StreamingState, BackgroundActivity } from '../modules/streamingStore.js';
export {
  showStreamingBubble,
  updateStreamingBubble,
  removeStreamingBubble,
  forceRemoveStreamingBubble,
  showBackgroundActivity,
  updateBackgroundActivity,
  hideBackgroundActivity,
  clearBackgroundActivities,
} from '../modules/streamingStore.js';

export function useStreaming(): StreamingState | null {
  return useSyncExternalStore(subscribeStreaming, getStreamingSnapshot);
}

export function useBackgroundActivities(): BackgroundActivity[] {
  return useSyncExternalStore(subscribeStreaming, getBackgroundActivitiesSnapshot);
}
