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

  if (record.outcome === 'assumed') {
    const wasUserResponse = record.userResponse && record.userResponse !== record.defaultIfNoResponse;
    return (
      <div className="pause-card assumed">
        <span className="pause-icon">✓</span>
        <div className="pause-body">
          <div><strong>{record.requesterName}</strong> asked: <em>{record.question || record.context}</em></div>
          <div className="pause-response">
            {wasUserResponse
              ? <>Your answer was used: {record.userResponse}</>
              : <>Agents assumed: {record.userResponse || record.defaultIfNoResponse || '(proceeding without answer)'}</>
            }
          </div>
        </div>
      </div>
    );
  }

  if (record.outcome === 'deferred') {
    return <DeferredCard record={record} />;
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

function DeferredCard({ record }) {
  const [answer, setAnswer] = useState(record.userResponse || '');
  const [sent, setSent] = useState(!!record.userResponse);

  const send = (value) => {
    const v = String(value || '').trim();
    if (!v) return;
    setSent(true);
    setAnswer(v);
    import('../modules/turns.js').then(m => m.resolveDeferredQuestion(record.id, v));
  };

  return (
    <div className="pause-card deferred">
      <div className="pause-header">
        <span className="pause-icon">💬</span>
        <strong>{record.requesterName}</strong> has a question
        <span className="pause-reason-badge">{record.reason}</span>
        <span className="pause-deferred-badge">non-blocking</span>
      </div>
      {record.context && <div className="pause-context">{record.context}</div>}
      <div className="pause-question">{record.question}</div>
      {sent ? (
        <div className="pause-response">Your answer queued: {answer}</div>
      ) : (
        <div className="pause-free-text">
          <input
            className="pause-input"
            type="text"
            value={answer}
            onChange={e => setAnswer(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && answer.trim() && send(answer)}
            placeholder={record.defaultIfNoResponse ? `Leave blank — agents will assume: ${record.defaultIfNoResponse}` : 'Answer (optional)…'}
          />
          <button className="btn sm primary" disabled={!answer.trim()} onClick={() => send(answer)}>
            Send
          </button>
        </div>
      )}
      {!sent && record.defaultIfNoResponse && (
        <div className="pause-note" style={{ marginTop: 2 }}>
          Agents will assume "{record.defaultIfNoResponse}" if you don't respond before round end.
        </div>
      )}
    </div>
  );
}

function PauseForm({ record }) {
  const [freeText, setFreeText] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const submit = (response) => {
    if (submitted) return;
    setSubmitted(true);
    import('../modules/turns.js').then(m => m.resolvePause(response));
  };

  if (submitted) {
    return (
      <div className="pause-card honored">
        <div className="pause-header">
          <span className="pause-icon">✓</span>
          <span>Response sent — resuming…</span>
        </div>
      </div>
    );
  }

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
