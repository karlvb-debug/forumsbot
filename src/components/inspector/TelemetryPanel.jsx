import React from 'react';
import { Toggle } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';

export function TelemetryPanel() {
  const actors = useForumState(s => s.actors);
  const telemetry = useForumState(s => s.telemetry || {});
  const settings = useForumState(s => s.settings || {});

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
        <div className="card-title"><h3>Optimization</h3></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Toggle checked={settings.enablePreflightRouter !== false} onChange={(v) => mutateState(s => { s.settings.enablePreflightRouter = v; })} label="Preflight skip router" />
          <Toggle checked={settings.roundSnapshotEnabled !== false} onChange={(v) => mutateState(s => { s.settings.roundSnapshotEnabled = v; })} label="Round snapshot · KV cache reuse" />
          <Toggle checked={!!settings.enableHypothesisSampling} onChange={(v) => mutateState(s => { s.settings.enableHypothesisSampling = v; })} label="Hypothesis sampling" />
        </div>
      </div>
    </div>
  );
}
