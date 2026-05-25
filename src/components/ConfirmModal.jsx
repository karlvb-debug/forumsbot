import React from 'react';

export function ConfirmModal({ message, confirmLabel = 'Confirm', onConfirm, onCancel }) {
  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <p className="modal-reason">{message}</p>
        <div className="btn-row">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
