import React, { useEffect } from 'react';

/**
 * Bottom sheet / drawer used on mobile to host Inspector panels (and the
 * "More" navigation list). Slides up from the bottom, full-height minus the
 * top bar, dismissible via the backdrop, the close button, or Escape.
 * Pure CSS animation — no dependency.
 */
export function Sheet({ open, title, sub, onClose, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Panel'}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet-header">
          <div className="sheet-grip" aria-hidden="true" />
          <div className="sheet-titles">
            <h2>{title}</h2>
            {sub && <small>{sub}</small>}
          </div>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
