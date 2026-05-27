import React, { useState } from 'react';

// When rendered inside the transcript, honored pauses show a static indicator.
// The modal overlay (App.jsx) renders the interactive form.
export function PauseCard({ msg, interactive = false }) {
  const record = msg?.pauseRecord;
  if (!record) return null;

  if (record.outcome === 'suppressed') {
    return (
      <div className="pause-card suppressed">
        <span className="pause-icon">⏸</span>
        <span className="pause-note">
          <strong>{record.requesterName}</strong> had a question — suppressed in observer mode
          {record.question ? `: "${record.question}"` : ''}
        </span>
      </div>
    );
  }

  if (record.outcome === 'resolved' || record.outcome === 'skipped') {
    return (
      <div className="pause-card resolved">
        <span className="pause-icon">✓</span>
        <div className="pause-body">
          <div><strong>{record.requesterName}</strong> asked: <em>{record.question || record.context}</em></div>
          <div className="pause-response">You replied: {record.userResponse || record.defaultIfNoResponse || '(no response)'}</div>
        </div>
      </div>
    );
  }

  // honored — transcript shows static indicator; modal shows interactive form
  if (!interactive) {
    return (
      <div className="pause-card honored static">
        <span className="pause-icon">⏸</span>
        <div className="pause-body">
          <div className="pause-header"><strong>{record.requesterName}</strong> is waiting for your response</div>
          {record.question && <div className="pause-question">{record.question}</div>}
          <div className="field-hint" style={{ marginTop: 4 }}>Respond using the prompt above ↑</div>
        </div>
      </div>
    );
  }

  return <PauseForm record={record} />;
}

function PauseForm({ record }) {
  const [freeText, setFreeText] = useState('');

  const submit = (response) => {
    import('../modules/turns.js').then(m => m.resolvePause(response));
  };

  return (
    <div className="pause-card honored">
      <div className="pause-header">
        <span className="pause-icon">⏸</span>
        <strong>{record.requesterName}</strong> is asking for your input
        <span className="pause-reason-badge">{record.reason}</span>
      </div>
      {record.context && <div className="pause-context">{record.context}</div>}
      <div className="pause-question">{record.question}</div>
      {record.options.length > 0 ? (
        <div className="pause-options">
          {record.options.map((opt, i) => (
            <button key={i} className="btn sm primary" onClick={() => submit(opt)}>{opt}</button>
          ))}
          {record.defaultIfNoResponse && (
            <button className="btn sm ghost" onClick={() => submit(record.defaultIfNoResponse)}>
              Skip — {record.defaultIfNoResponse}
            </button>
          )}
        </div>
      ) : (
        <div className="pause-free-text">
          <input
            className="pause-input"
            type="text"
            value={freeText}
            onChange={e => setFreeText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && freeText.trim() && submit(freeText.trim())}
            placeholder={record.defaultIfNoResponse || 'Type your response…'}
            autoFocus
          />
          <button
            className="btn sm primary"
            disabled={!freeText.trim()}
            onClick={() => submit(freeText.trim())}
          >
            Send
          </button>
          {record.defaultIfNoResponse && (
            <button className="btn sm ghost" onClick={() => submit(record.defaultIfNoResponse)}>
              Skip
            </button>
          )}
        </div>
      )}
    </div>
  );
}
