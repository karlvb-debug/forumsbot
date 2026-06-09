import { beforeEach, describe, expect, it, vi } from 'vitest';

// useActions pulls in state + the React-notify wiring on import; stub both so the
// toast store can be tested in isolation.
vi.mock('../modules/state.js', () => ({ state: {} }));
vi.mock('../modules/stateStore.js', () => ({ saveState: vi.fn(), notifyStateChange: vi.fn() }));

import {
  showToast,
  dismissToast,
  getToasts,
  getToastsVersion,
  subscribeToasts,
} from './useActions.js';

describe('toast notification store', () => {
  beforeEach(() => {
    // Clear any toasts left by a previous test.
    getToasts().slice().forEach(t => dismissToast(t.id));
    vi.useRealTimers();
  });

  it('showToast adds a toast, bumps the version, and notifies subscribers', () => {
    const before = getToastsVersion();
    const listener = vi.fn();
    const unsub = subscribeToasts(listener);

    const id = showToast('Something happened', 'error', 0);

    expect(getToasts().some(t => t.id === id && t.message === 'Something happened' && t.type === 'error')).toBe(true);
    expect(getToastsVersion()).toBeGreaterThan(before);
    expect(listener).toHaveBeenCalled();
    unsub();
  });

  it('defaults the type to info', () => {
    const id = showToast('Plain note', undefined, 0);
    expect(getToasts().find(t => t.id === id).type).toBe('info');
  });

  it('dismissToast removes a toast and is a no-op for unknown ids', () => {
    const id = showToast('Dismiss me', 'info', 0);
    const versionAfterAdd = getToastsVersion();

    expect(dismissToast(999999)).toBeUndefined();
    expect(getToastsVersion()).toBe(versionAfterAdd); // unknown id: no bump

    dismissToast(id);
    expect(getToasts().some(t => t.id === id)).toBe(false);
    expect(getToastsVersion()).toBeGreaterThan(versionAfterAdd);
  });

  it('auto-dismisses after the given duration', () => {
    vi.useFakeTimers();
    const id = showToast('Temporary', 'warn', 5000);
    expect(getToasts().some(t => t.id === id)).toBe(true);

    vi.advanceTimersByTime(5000);
    expect(getToasts().some(t => t.id === id)).toBe(false);
  });
});
