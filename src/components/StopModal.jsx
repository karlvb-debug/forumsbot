import { useState } from 'react';

export function StopModal({ reason, onStop, onContinue }) {
  const title = reason.startsWith('Task complete')
    ? 'Task Complete'
    : reason.startsWith('Blocked')
    ? 'Discussion Blocked'
    : 'Auto-Stop';

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-title">{title}</div>
        <p className="modal-reason">{reason}</p>
        <div className="btn-row">
          <button onClick={onStop}>Stop here</button>
          <button className="primary" onClick={onContinue}>Continue</button>
        </div>
      </div>
    </div>
  );
}
