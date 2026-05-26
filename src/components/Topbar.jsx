import React, { useState } from 'react';
import * as Ic from './Icons';
import { useForumState, mutateState, saveState } from '../hooks/useForumState';
import { useActions, getConnectionStatus, getConnectionStatusVersion, subscribeBusy, getBusy, subscribeConnectionStatus } from '../hooks/useActions';
import { useSyncExternalStore } from 'react';

export function Topbar({ onOpenCmd }) {
  const assistantOpen = useForumState(s => s.ui?.assistantOpen || false);
  const toggleAssistant = () => mutateState(s => { s.ui.assistantOpen = !s.ui.assistantOpen; });
  const [mdCopied, setMdCopied] = useState(false);

  const handleCopyMd = async () => {
    const { copyMarkdownToClipboard } = await import('../modules/session.js');
    const ok = await copyMarkdownToClipboard();
    if (ok) {
      setMdCopied(true);
      setTimeout(() => setMdCopied(false), 2000);
    }
  };
  const mode = useForumState(s => s.scenario?.mode || 'problem');
  const title = useForumState(s => s.scenario?.title || 'Forum — Mission Control');
  const roundNum = useForumState(s => s.currentRound || 0);
  const turnCount = useForumState(s => (s.messages || []).filter(m => m.type !== 'system').length);
  const autoRunning = useForumState(s => s.autoRunning);

  // Connection status
  useSyncExternalStore(subscribeConnectionStatus, getConnectionStatusVersion);
  const connStatus = getConnectionStatus();
  const connClass = connStatus.tone === 'ok' ? 'live' : connStatus.tone === 'error' ? 'err' : '';

  const turboMode = useForumState(s => s.settings?.turboMode || false);
  const { nextTurn, runRound, startAuto, stopGeneration } = useActions();

  return (
    <header className="topbar">
      <div className="session-title">
        <h1>{title}</h1>
        <span className="mode-chip">{mode}</span>
      </div>
      <span className="topbar-spacer" />

      <div className="status-cluster">
        <span className={`status-pill ${connClass}`} title="Connection status">
          <span className="dot" />{connStatus.message}
        </span>
        <span className="status-pill" title="Round status">R{roundNum} · {turnCount} turns</span>
      </div>

      <div className="run-controls" role="group" aria-label="Run">
        <button onClick={nextTurn} title="Next AI turn (Alt+N)">
          <Ic.Step width={13} height={13} />Next
        </button>
        <button onClick={runRound} title="Run a full round (Alt+R)">
          <Ic.Round width={13} height={13} />Round
        </button>
        {autoRunning ? (
          <button className="danger" onClick={stopGeneration} title="Stop (Esc)">
            <Ic.Stop width={11} height={11} />Stop
          </button>
        ) : (
          <button className="primary" onClick={startAuto} title="Start auto-run (Alt+A)">
            <Ic.Play width={11} height={11} />Auto
          </button>
        )}
      </div>

      <button
        className={`icon-btn${turboMode ? ' active warn' : ''}`}
        title={turboMode ? 'Turbo mode ON — memory/alignment/thoughts disabled (click to turn off)' : 'Turbo mode — skip memory cycles, alignment, and thoughts for maximum speed'}
        style={{ fontSize: 11, fontWeight: 600 }}
        onClick={() => { mutateState(s => { s.settings.turboMode = !s.settings.turboMode; }); saveState(); }}
      >
        ⚡
      </button>
      <button
        className="icon-btn"
        onClick={handleCopyMd}
        title="Copy session as Markdown"
        style={{ fontSize: 11, fontWeight: 600 }}
      >
        {mdCopied ? '✓' : '⬇ MD'}
      </button>
      <button
        className={`icon-btn${assistantOpen ? ' active' : ''}`}
        onClick={toggleAssistant}
        title="AI Assistant · Alt+I"
      >
        <Ic.Bolt width={16} height={16} />
      </button>
      <button className="icon-btn" onClick={onOpenCmd} title="Command palette · Ctrl+K">
        <Ic.Cmd width={16} height={16} />
      </button>
    </header>
  );
}
