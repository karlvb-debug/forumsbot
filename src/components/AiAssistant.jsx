import React, { useState, useEffect, useRef } from 'react';
import * as Ic from './Icons';
import { useForumState, mutateState } from '../hooks/useForumState';
import { renderMarkdown } from '../modules/markdown.js';

export function AiAssistant() {
  const open = useForumState(s => s.ui?.assistantOpen || false);
  const history = useForumState(s => s.ui?.quickStartHistory || []);
  const draft = useForumState(s => s.ui?.quickStartDraft || null);
  const status = useForumState(s => s.ui?.quickStartStatus || '');
  const prompt = useForumState(s => s.ui?.quickStartPrompt || '');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  const close = () => mutateState(s => { s.ui.assistantOpen = false; });
  const setPrompt = (val) => mutateState(s => { s.ui.quickStartPrompt = val; });

  // Scroll to bottom whenever history changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, open]);

  // Focus textarea when panel opens
  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  const send = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    try {
      const session = await import('../modules/session.js');
      await session.generateQuickStart(prompt);
    } finally {
      setBusy(false);
      textareaRef.current?.focus();
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      const session = await import('../modules/session.js');
      await session.applyQuickStartConfig();
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    const session = await import('../modules/session.js');
    session.discardQuickStartConfig();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="ai-assistant-backdrop" onClick={close} />
      <div className="ai-assistant-panel" role="dialog" aria-label="AI Assistant">
        <div className="ai-assistant-header">
          <div className="ai-assistant-title">
            <Ic.Robot width={15} height={15} />
            <span>AI Assistant</span>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {(history.length > 0) && (
              <button className="btn ghost sm" onClick={discard} disabled={busy} title="Clear conversation">
                Clear
              </button>
            )}
            <button className="icon-btn" onClick={close} title="Close (Esc)">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        <div className="ai-assistant-messages">
          {history.length === 0 && (
            <div className="ai-assistant-empty">
              <Ic.Robot width={28} height={28} style={{ opacity: 0.25, marginBottom: 10 }} />
              <p>Ask me to set up a scenario, add or change actors, adjust settings, or anything else about your session.</p>
              <p className="ai-assistant-examples">
                "Three philosophers debating free will"<br />
                "Add a devil's advocate to the panel"<br />
                "Make the scenario more adversarial"<br />
                "Set temperature to 0.9 and enable streaming"
              </p>
            </div>
          )}

          {history.map((entry, i) => (
            <div key={i} className={`ai-msg ai-msg-${entry.role}`}>
              {entry.role === 'user' ? (
                <div className="ai-bubble ai-bubble-user">{entry.content}</div>
              ) : (
                <div className="ai-bubble ai-bubble-assistant">
                  <div className="ai-bubble-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.message || 'Done.') }} />
                  {entry.type && entry.type !== 'chat' && entry.type !== 'error' && (
                    <div className="ai-bubble-badge">
                      {entry.type === 'patch' ? '✎ Changes ready' : entry.type === 'fullSetup' ? '✦ Full setup ready' : null}
                    </div>
                  )}
                  {entry.type === 'error' && (
                    <div className="ai-bubble-badge err">⚠ {entry.message}</div>
                  )}
                </div>
              )}
            </div>
          ))}

          {busy && (
            <div className="ai-msg ai-msg-assistant">
              <div className="ai-bubble ai-bubble-assistant ai-bubble-thinking">
                <span className="ai-thinking-dot" /><span className="ai-thinking-dot" /><span className="ai-thinking-dot" />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {draft && (
          <div className="ai-assistant-draft-bar">
            <span className="ai-draft-label">Changes ready to apply</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn sm ghost" onClick={discard} disabled={busy}>Discard</button>
              <button className="btn sm primary" onClick={apply} disabled={busy}>Apply</button>
            </div>
          </div>
        )}

        {status && !draft && (
          <div className="ai-assistant-status">{status}</div>
        )}

        <div className="ai-assistant-input-row">
          <textarea
            ref={textareaRef}
            className="ai-assistant-textarea"
            rows={2}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Describe what you want… (Enter to send, Shift+Enter for new line)"
            disabled={busy}
          />
          <button
            className="ai-send-btn"
            onClick={send}
            disabled={busy || !prompt.trim()}
            title="Send (Enter)"
          >
            <Ic.Send width={15} height={15} />
          </button>
        </div>
      </div>
    </>
  );
}
