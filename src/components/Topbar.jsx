import React, { useState, useRef, useEffect } from 'react';
import * as Ic from './Icons';
import { useForumState, mutateState, saveState } from '../hooks/useForumState';
import { useActions, getConnectionStatus, getConnectionStatusVersion, subscribeConnectionStatus } from '../hooks/useActions';
import { useSyncExternalStore } from 'react';
import { navigateToPanel } from '../hooks/navigation.js';
import { RunControl } from './RunControl';

export function Topbar() {
  const assistantOpen = useForumState(s => s.ui?.assistantOpen || false);
  const toggleAssistant = () => mutateState(s => { s.ui.assistantOpen = !s.ui.assistantOpen; });
  const [mdCopied, setMdCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

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

  // Connection status
  useSyncExternalStore(subscribeConnectionStatus, getConnectionStatusVersion);
  const connStatus = getConnectionStatus();
  const connClass = connStatus.tone === 'ok' ? 'live' : connStatus.tone === 'error' ? 'err' : '';

  const turboMode = useForumState(s => s.settings?.turboMode || false);
  const { directorBrief } = useActions();

  const isSummarizing = useForumState(s => s.memory?.isSummarizing || false);
  const isExtracting = useForumState(s => s.outcomes?.isExtracting || false);
  const isDistilling = useForumState(s => s.memory?.isDistilling || false);
  const distillingActor = useForumState(s => s.memory?.distillingActor || "");

  // Close the overflow menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

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

      <RunControl />

      <button
        className={`icon-btn${assistantOpen ? ' active' : ''}`}
        onClick={toggleAssistant}
        title="AI Assistant · Alt+I"
        aria-label="AI Assistant"
      >
        <Ic.Robot width={16} height={16} />
      </button>

      <div className="topbar-overflow" ref={menuRef}>
        <button
          className={`icon-btn${menuOpen ? ' active' : ''}${turboMode ? ' warn' : ''}`}
          onClick={() => setMenuOpen(v => !v)}
          title="More actions"
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <Ic.MoreHorizontal width={16} height={16} />
        </button>
        {menuOpen && (
          <div className="topbar-menu" role="menu">
            <button role="menuitem" onClick={() => { directorBrief(); setMenuOpen(false); }}>
              <Ic.Clipboard width={15} height={15} /><span>Director brief</span>
            </button>
            <button
              role="menuitemcheckbox"
              aria-checked={turboMode}
              className={turboMode ? 'checked' : ''}
              onClick={() => { mutateState(s => { s.settings.turboMode = !s.settings.turboMode; }); saveState(); }}
              title="Skip memory cycles, alignment, and thoughts for maximum speed"
            >
              <Ic.Bolt width={15} height={15} /><span>Turbo mode</span>
              {turboMode && <Ic.Check width={14} height={14} style={{ marginLeft: 'auto' }} />}
            </button>
            <button role="menuitem" onClick={() => { handleCopyMd(); setMenuOpen(false); }}>
              <Ic.Download width={15} height={15} /><span>{mdCopied ? 'Copied!' : 'Copy as Markdown'}</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
