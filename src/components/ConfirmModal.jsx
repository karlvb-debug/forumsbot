import React, { useCallback } from 'react';
import { mutateState } from '../hooks/useForumState';

export function ConfirmModal({ message, confirmLabel = 'Confirm', onConfirm, onCancel }) {
  // Force-clear the modal via state mutation — guarantees dismissal even if resolver is broken
  const dismiss = useCallback(() => {
    mutateState(s => { s.ui.confirmModal = null; });
  }, []);

  const handleCancel = useCallback(() => {
    dismiss();
    try { onCancel?.(); } catch (e) { console.warn('[ConfirmModal] onCancel error:', e); }
  }, [onCancel, dismiss]);

  const handleConfirm = useCallback(() => {
    dismiss();
    try { onConfirm?.(); } catch (e) { console.warn('[ConfirmModal] onConfirm error:', e); }
  }, [onConfirm, dismiss]);

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <p className="modal-reason">{message}</p>
        <div className="btn-row">
          <button className="btn" onClick={handleCancel}>Cancel</button>
          <button className="btn primary" onClick={handleConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
