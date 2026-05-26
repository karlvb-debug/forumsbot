import React from 'react';
import { Toggle, Range, Field } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';

export function TelemetryPanel() {
  const actors = useForumState(s => s.actors);
  const telemetry = useForumState(s => s.telemetry || {});
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
  const memDupLog = diagnostics.warnings || [];
  const memDups = memDupLog.filter(w => w.category === 'memory_dup' || w.msg?.includes('dup')).length;

  // currentAlignmentScore is 0–100; default to 100 (on-track) before first check
  const alignmentPct = telemetry.currentAlignmentScore ?? 100;
  const dialColor = alignmentPct >= 70 ? "var(--violet)" : alignmentPct >= 40 ? "var(--warn)" : "var(--danger)";
  const dashOffset = 251.2 - (251.2 * alignmentPct) / 100;

  const history = telemetry.alignmentHistory || [];
  // History entries are objects { turn, score, mode, timestamp }; older entries may be plain numbers
  const sparkData = history.slice(-10).map(h =>
    typeof h === 'number' ? h : Math.round(h.score ?? 0)
  );

  const enabledActors = actors.filter(a => a.enabled);
  const hasRealInfluence = enabledActors.some(a => typeof a.influence === 'number');

  return (
    <div>
      <div className="card">
        <div className="card-title">
          <h3>Alignment</h3>
          <span className={"badge" + (alignmentPct >= 70 ? " ok" : alignmentPct >= 40 ? " warn" : " err")}>
            {alignmentPct >= 70 ? "on track" : alignmentPct >= 40 ? "drifting" : "off track"}
          </span>
        </div>
        <div className="dial-wrap">
          <div className="dial">
            <svg viewBox="0 0 100 100">
              <circle className="dial-bg" cx="50" cy="50" r="40" />
              <circle className="dial-fg" cx="50" cy="50" r="40"
                style={{ stroke: dialColor, strokeDasharray: 251.2, strokeDashoffset: dashOffset }} />
            </svg>
            <div className="dial-center">
              <span className="num">{alignmentPct}%</span>
              <span className="lbl">aligned</span>
            </div>
          </div>
          <div>
            <div className="card-row" style={{ padding: "4px 0", borderTop: 0 }}>
              <span className="lbl">Drift</span>
              <span className="val" style={{ color: (telemetry.drift ?? 0) < 0 ? "var(--ok)" : "var(--warn)" }}>
                {((telemetry.drift ?? 0) >= 0 ? '+' : '') + (telemetry.drift ?? 0).toFixed(2)}
              </span>
            </div>
            <div className="card-row" style={{ padding: "4px 0" }}>
              <span className="lbl">Method</span>
              <span className="val">{telemetry.alignmentMode || 'none'}</span>
            </div>
            {sparkData.length > 0 && (
              <div className="spark">
                {sparkData.map((v, i) => (
                  <div key={i} className={"bar" + (i === sparkData.length - 1 ? " active" : "")} style={{ height: `${Math.max(2, v)}%` }} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title"><h3>Session Texture</h3><span className="badge">visual</span></div>
        <div className="tension-grid">
          {(sparkData.length > 0 ? sparkData : Array(10).fill(50)).map((v, i) => (
            <div key={i} className="tension-cell" style={{
              background: `oklch(from var(--accent) l c h / ${(v / 100) * 0.6})`,
              transform: `scale(${0.6 + (v / 100) * 0.4})`,
            }} />
          ))}
        </div>
        <div className="field-hint" style={{ marginTop: 6 }}>Visualises recent alignment history.</div>
      </div>

      <div className="card">
        <div className="card-title"><h3>Influence Budget</h3></div>
        {hasRealInfluence ? (
          enabledActors.map(a => (
            <div className="influence-row" key={a.id}>
              <span style={{ minWidth: 50, color: "var(--fg-dim)" }}>{a.name}</span>
              <div className="influence-bar"><div style={{ width: `${a.influence}%`, background: a.color }} /></div>
              <span className="influence-pct">{a.influence}%</span>
            </div>
          ))
        ) : (
          <div className="field-hint">Influence is measured by word-share per round. Run a session to see results.</div>
        )}
      </div>

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
          <div className="metric-tile">
            <span className="metric-val">{memDups}</span>
            <span className="metric-lbl">Mem Dups</span>
          </div>
          <div className="metric-tile">
            <span className="metric-val">{alignmentPct}%</span>
            <span className="metric-lbl">Aligned</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title"><h3>Optimization</h3></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Toggle checked={settings.enablePreflightRouter !== false} onChange={(v) => mutateState(s => { s.settings.enablePreflightRouter = v; })} label="Preflight skip router" />
          <Toggle checked={settings.roundSnapshotEnabled !== false} onChange={(v) => mutateState(s => { s.settings.roundSnapshotEnabled = v; })} label="Round snapshot · KV cache reuse" />
          <Toggle checked={!!settings.enableHypothesisSampling} onChange={(v) => mutateState(s => { s.settings.enableHypothesisSampling = v; })} label="Hypothesis sampling" />
          {settings.enableHypothesisSampling && (
            <div style={{ paddingLeft: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              <Field label={`Candidates: ${settings.hypothesisSampleCount ?? 2}`}>
                <Range value={settings.hypothesisSampleCount ?? 2} min={2} max={5} step={1} onChange={(v) => mutateState(s => { s.settings.hypothesisSampleCount = v; })} />
              </Field>
              <Toggle checked={settings.hypothesisAutoSelect !== false} onChange={(v) => mutateState(s => { s.settings.hypothesisAutoSelect = v; })} label="Auto-select best candidate" />
            </div>
          )}
          <Toggle checked={!!settings.showInfluenceBars} onChange={(v) => mutateState(s => { s.settings.showInfluenceBars = v; })} label="Show influence bars on messages" />
          <Toggle checked={settings.includeTraces !== false} onChange={(v) => mutateState(s => { s.settings.includeTraces = v; })} label="Include prompt traces in diagnostics" />
        </div>
        <div style={{ marginTop: 8 }}>
          <Field label={`Gravity sensitivity: ${settings.gravitySensitivity ?? 50}`}>
            <Range value={settings.gravitySensitivity ?? 50} min={0} max={100} step={5} onChange={(v) => mutateState(s => { s.settings.gravitySensitivity = v; })} />
          </Field>
          <div className="field-hint">Controls how strongly off-topic drift nudges actors back to the objective.</div>
        </div>
      </div>
    </div>
  );
}
