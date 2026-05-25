import React, { useState } from 'react';

export function StopModal({ reason, suggestedGoal, onStop, onContinue }) {
  const [goal, setGoal] = useState(suggestedGoal || '');
  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-title">Goal reached</div>
        <p className="modal-reason">{reason}</p>
        <label className="modal-label">New goal to continue toward</label>
        <input
          className="modal-input"
          value={goal}
          onChange={e => setGoal(e.target.value)}
          placeholder="Describe a new objective…"
          autoFocus
        />
        <div className="btn-row">
          <button className="btn" onClick={onStop}>Stop here</button>
          <button className="btn primary" onClick={() => onContinue(goal)} disabled={!goal.trim()}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
