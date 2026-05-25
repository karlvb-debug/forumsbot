import React from 'react';
import * as Ic from './Icons';
import { useForumState } from '../hooks/useForumState';
import { useActions, getConnectionStatus, getConnectionStatusVersion, subscribeBusy, getBusy, subscribeConnectionStatus } from '../hooks/useActions';
import { useSyncExternalStore } from 'react';

export function Topbar({ onOpenCmd }) {
  const mode = useForumState(s => s.scenario?.mode || 'problem');
  const title = useForumState(s => s.scenario?.title || 'Forum — Mission Control');
  const roundNum = useForumState(s => s.currentRound || 0);
  const turnCount = useForumState(s => (s.messages || []).filter(m => m.type !== 'system').length);
  const autoRunning = useForumState(s => s.autoRunning);

  // Connection status
  useSyncExternalStore(subscribeConnectionStatus, getConnectionStatusVersion);
  const connStatus = getConnectionStatus();
  const connClass = connStatus.tone === 'ok' ? 'live' : connStatus.tone === 'error' ? 'err' : '';

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
        <button onClick={nextTurn} title="Next AI turn (⌘⇧N)">
          <Ic.Step width={13} height={13} />Next
        </button>
        <button onClick={runRound} title="Run a full round (⌘⇧R)">
          <Ic.Round width={13} height={13} />Round
        </button>
        {autoRunning ? (
          <button className="danger" onClick={stopGeneration} title="Stop (Esc)">
            <Ic.Stop width={11} height={11} />Stop
          </button>
        ) : (
          <button className="primary" onClick={startAuto} title="Start auto-run (⌘⇧A)">
            <Ic.Play width={11} height={11} />Auto
          </button>
        )}
      </div>

      <button className="icon-btn" onClick={onOpenCmd} title="Command palette · ⌘K">
        <Ic.Cmd width={16} height={16} />
      </button>
    </header>
  );
}
