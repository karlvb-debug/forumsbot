import React from 'react';
import { Toggle } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';

export function TelemetryPanel() {
  const settings = useForumState(s => s.settings || {});
  const messages = useForumState(s => s.messages || []);
  const diagnostics = useForumState(s => s.diagnostics || {});

  // Health metrics
  const totalTurns = messages.filter(m => m.type !== 'system' && m.type !== 'user').length;
  const skipTurns = messages.filter(m => m.type === 'skip').length;
  const skipRate = totalTurns > 0 ? Math.round((skipTurns / totalTurns) * 100) : 0;
  const extractLog = diagnostics.outcomeExtractionLog || [];
  const extractAttempts = extractLog.length;
  const extractSuccesses = extractLog.filter(e => e.success !== false).length;
  const extractRate = extractAttempts > 0 ? Math.round((extractSuccesses / extractAttempts) * 100) : null;

  return (
    <div>
      <div className="card">
        <div className="card-title"><h3>Session Health</h3></div>
        <div className="metrics-grid">
          <div className="metric-tile">
            <span className="metric-val">{skipRate}%</span>
            <span className="metric-lbl">Skip Rate</span>
          </div>
          <div className="metric-tile">
            <span className="metric-val">{extractRate !== null ? `${extractRate}%` : '—'}</span>
            <span className="metric-lbl">Extract Rate</span>
          </div>
        </div>
      </div>

      <details className="card card-disclosure">
        <summary className="card-title">
          <h3>Optimization</h3>
          <span className="disclosure-sub">sampling · diagnostics</span>
        </summary>
        <div className="disclosure-body">
          <Toggle checked={settings.roundSnapshotEnabled !== false} onChange={(v) => mutateState(s => { s.settings.roundSnapshotEnabled = v; })} label="Round snapshot · KV cache reuse" />
          <Toggle checked={settings.includeTraces !== false} onChange={(v) => mutateState(s => { s.settings.includeTraces = v; })} label="Include prompt traces in diagnostics" />
        </div>
      </details>
    </div>
  );
}
