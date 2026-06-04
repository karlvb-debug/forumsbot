import React, { useState } from 'react';
import * as Ic from './Icons';
import { useForumState, mutateState, saveState } from '../hooks/useForumState';
import { useActions, getConnectionStatus, getConnectionStatusVersion, subscribeConnectionStatus } from '../hooks/useActions';
import { useSyncExternalStore } from 'react';
import { navigateToPanel } from '../hooks/navigation.js';

export function Topbar() {
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
  const title = useForumState(s => s.scenario?.title || 'Forum — Mission Control');
  const roundNum = useForumState(s => s.currentRound || 0);
  const turnCount = useForumState(s => (s.messages || []).filter(m => m.type !== 'system').length);
  const autoRunning = useForumState(s => s.autoRunning);
  const continueMode = useForumState(s => s.ui?.continueMode || 'next');

  // Connection status
  useSyncExternalStore(subscribeConnectionStatus, getConnectionStatusVersion);
  const connStatus = getConnectionStatus();
  const connClass = connStatus.tone === 'ok' ? 'live' : connStatus.tone === 'error' ? 'err' : '';

  const turboMode = useForumState(s => s.settings?.turboMode || false);
  const { setContinueMode, stopGeneration, directorBrief } = useActions();

  const isSummarizing = useForumState(s => s.memory?.isSummarizing || false);
  const isExtracting = useForumState(s => s.outcomes?.isExtracting || false);
  const isDistilling = useForumState(s => s.memory?.isDistilling || false);
  const distillingActor = useForumState(s => s.memory?.distillingActor || "");

  let bgTaskText = "";
  if (isSummarizing) {
    bgTaskText = "updating memory...";
  } else if (isExtracting) {
    bgTaskText = "extracting outcomes...";
  } else if (isDistilling) {
    bgTaskText = distillingActor ? `distilling ${distillingActor}...` : "distilling memory...";
  }

  return (
    <header className="topbar">
      <div className="session-title">
        <h1>{title}</h1>
      </div>
      <span className="topbar-spacer" />

      <div className="status-cluster">
        {bgTaskText && (
          <span className="status-pill bg-task" title="Background AI processing">
            <span className="spinner-icon" />
            {bgTaskText}
          </span>
        )}
        {autoRunning && (
          <span className="status-pill live" title="Auto-run is active">
            <span className="dot" />Auto running
          </span>
        )}
        <button
          className={`status-pill status-pill--btn ${connClass}`}
          title="Connection status — click to open the Connection panel"
          onClick={() => navigateToPanel('connection')}
        >
          <span className="dot" /><span className="status-pill-label">{connStatus.message}</span>
        </button>
        <span className="status-pill status-round" title="Round status">R{roundNum} · {turnCount}t</span>
      </div>

      <div className="run-controls" role="group" aria-label="Run controls">
        <button
          onClick={stopGeneration}
          title="Stop (Esc)"
          aria-label="Stop"
        >
          <Ic.Stop width={12} height={12} /><span>Stop</span>
        </button>
        <button
          className={continueMode === 'next' && !autoRunning ? 'active' : ''}
          onClick={() => setContinueMode('next')}
          title="Continue mode: one routed speaker (Alt+N)"
          aria-pressed={continueMode === 'next' && !autoRunning}
          aria-label="Select Next mode"
        >
          <Ic.Step width={13} height={13} /><span>Next</span>
        </button>
        <button
          className={continueMode === 'round' && !autoRunning ? 'active' : ''}
          onClick={() => setContinueMode('round')}
          title="Continue mode: full round (Alt+R)"
          aria-pressed={continueMode === 'round' && !autoRunning}
          aria-label="Select Round mode"
        >
          <Ic.FastForward width={13} height={13} /><span>Round</span>
        </button>
        <button
          className={(continueMode === 'auto' || autoRunning) ? 'active' : ''}
          onClick={() => setContinueMode('auto')}
          title="Continue mode: auto-run until stopped or goal reached (Alt+A)"
          aria-pressed={continueMode === 'auto' || autoRunning}
          aria-label="Select Auto mode"
        >
          <Ic.Play width={12} height={12} /><span>Auto</span>
        </button>
      </div>
      <button
        className="icon-btn"
        onClick={directorBrief}
        title="Director brief — ask the Director for a progress summary"
        aria-label="Director brief"
        style={{ fontSize: 13 }}
      >
        📋
      </button>

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
        <Ic.Robot width={16} height={16} />
      </button>
    </header>
  );
}
