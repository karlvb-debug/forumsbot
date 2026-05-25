import React, { useState, useRef, useCallback } from 'react';
import * as Ic from './Icons';
import { useForumState, mutateState } from '../hooks/useForumState';
import { useActions, getBusy, getBusyVersion, subscribeBusy } from '../hooks/useActions';
import { useSyncExternalStore } from 'react';

export function Composer({ showThoughts, onToggleThoughts }) {
  const [text, setText] = useState('');
  const taRef = useRef(null);

  const toolsEnabled = useForumState(s => s.settings?.toolsEnabled !== false);
  const autoRunning = useForumState(s => s.autoRunning);
  const contextInfo = useForumState(s => s.contextInfo || {});

  const { nextTurn, runRound, startAuto, stopGeneration, sendMessage } = useActions();

  // Subscribe to busy state
  useSyncExternalStore(subscribeBusy, getBusyVersion);
  const busy = getBusy();

  const autoresize = useCallback((el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(200, el.scrollHeight) + 'px';
  }, []);

  const handleSubmit = useCallback((e) => {
    e?.preventDefault();
    if (!text.trim()) return;
    sendMessage(text.trim());
    setText('');
    if (taRef.current) taRef.current.style.height = 'auto';
  }, [text, sendMessage]);

  const handleToggleTools = useCallback(() => {
    mutateState(s => { s.settings.toolsEnabled = !s.settings.toolsEnabled; });
  }, []);

  // Token meter
  const promptTokens = contextInfo.lastPromptTokens || 0;
  const maxCtx = contextInfo.maxContextLength || 0;
  const tokenPct = maxCtx > 0 ? Math.min(100, (promptTokens / maxCtx) * 100) : 0;
  const formatTokens = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <div className="composer-inner">
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => { setText(e.target.value); autoresize(e.target); }}
          placeholder="Join the forum — your message will trigger the next round…"
          rows={1}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit(e);
          }}
        />
        <div className="composer-row">
          <button
            type="button"
            className={"chip-btn" + (showThoughts ? " active" : "")}
            onClick={onToggleThoughts}
            title="Show actors' private thoughts"
          >
            <Ic.Eye width={12} height={12} /> Thoughts
          </button>
          <button
            type="button"
            className={"chip-btn" + (toolsEnabled ? " active" : "")}
            onClick={handleToggleTools}
            title="Allow actors to search the web"
          >
            <Ic.Globe width={12} height={12} /> Tools
          </button>
          <span className="grow" />
          {maxCtx > 0 && (
            <span className="token-meter" title="Tokens used in last prompt vs context window">
              <span>{formatTokens(promptTokens)} / {formatTokens(maxCtx)}</span>
              <div className="token-bar"><div style={{ width: `${tokenPct}%` }} /></div>
            </span>
          )}
          <button
            type="button"
            className="chip-btn"
            onClick={nextTurn}
            disabled={busy}
            title="Next AI turn"
          >
            <Ic.Step width={12} height={12} /> Next
          </button>
          <button
            type="button"
            className="chip-btn"
            onClick={runRound}
            disabled={busy}
            title="Run a full round"
          >
            <Ic.Round width={12} height={12} /> Round
          </button>
          {autoRunning ? (
            <button
              type="button"
              className="chip-btn active"
              onClick={stopGeneration}
              title="Stop auto"
            >
              <Ic.Stop width={11} height={11} /> Stop
            </button>
          ) : (
            <button
              type="button"
              className="chip-btn"
              onClick={startAuto}
              disabled={busy}
              title="Run continuously"
            >
              <Ic.Play width={11} height={11} /> Auto
            </button>
          )}
          <button type="submit" className="send-btn" title="Send (⌘↵)" disabled={!text.trim()}>
            <Ic.Send width={13} height={13} /> Send
            <span className="kbd">⌘↵</span>
          </button>
        </div>
      </div>
    </form>
  );
}
