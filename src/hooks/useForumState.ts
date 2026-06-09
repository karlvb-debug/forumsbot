/**
 * State bridge: connects the mutable global `state` object to React's
 * rendering cycle via useSyncExternalStore.
 *
 * The framework-agnostic store (subscription registry, mutateState,
 * saveState, notifyStateChange) lives in modules/stateStore.js. This file
 * holds only the React hook and re-exports the store actions components use.
 */
import { useSyncExternalStore } from 'react';
import { state } from '../modules/state.js';
import { subscribe, getVersion } from '../modules/stateStore.js';
import type { ForumState } from '../types.js';

export { mutateState, notifyStateChange, saveState } from '../modules/stateStore.js';

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
