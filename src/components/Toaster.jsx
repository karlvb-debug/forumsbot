import React, { useSyncExternalStore } from 'react';
import { getToasts, getToastsVersion, subscribeToasts, dismissToast } from '../hooks/useActions';

/**
 * Renders the app-wide toast stack. Toasts are ephemeral notifications for
 * events that happen off-panel (errors, auto-stop, scribe suggestions) so the
 * user sees them regardless of which panel is open. Auto-dismiss is handled in
 * useActions.showToast; clicking a toast dismisses it early.
 */
export function Toaster() {
  // Re-render on any toast change; getToasts() is the live snapshot.
  useSyncExternalStore(subscribeToasts, getToastsVersion);
  const toasts = getToasts();
  if (!toasts.length) return null;

  return (
    <div className="toaster" role="status" aria-live="polite" aria-atomic="false">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`toast toast--${t.type}`}
          onClick={() => dismissToast(t.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') dismissToast(t.id); }}
        >
          <span className="toast-msg">{t.message}</span>
          <button
            className="toast-close"
            aria-label="Dismiss notification"
            onClick={(e) => { e.stopPropagation(); dismissToast(t.id); }}
          >×</button>
        </div>
      ))}
    </div>
  );
}
