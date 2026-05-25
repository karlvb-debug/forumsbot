import React, { useMemo } from 'react';
import * as Ic from '../Icons';
import { Field, Toggle, Range } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';

export function TelemetryPanel() {
  const actors = useForumState(s => s.actors);
  const telemetry = useForumState(s => s.telemetry || {});
  const settings = useForumState(s => s.settings || {});

  const alignment = telemetry.currentAlignment ?? 0;
  const alignmentPct = Math.round(alignment * 100);
  const dialColor = alignmentPct >= 70 ? "var(--violet)" : alignmentPct >= 40 ? "var(--warn)" : "var(--danger)";
  const dashOffset = 251.2 - (251.2 * alignmentPct) / 100;
  const history = telemetry.alignmentHistory || [];
  const sparkData = history.slice(-10).map(h => Math.round((h.alignment ?? h) * 100));

  const tension = useMemo(() => {
    const cells = [];
    for (let i = 0; i < 60; i++) cells.push(Math.random());
    return cells;
  }, []);

  return (
    <div>
      <div className="card">
        <div className="card-title"><h3>Alignment</h3>
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
              <span className="lbl">Method</span><span className="val">cosine · embed</span>
            </div>
            {sparkData.length > 0 && (
              <div className="spark">
                {sparkData.map((v, i) => (
                  <div key={i} className={"bar" + (i === sparkData.length - 1 ? " active" : "")} style={{ height: `${v}%` }} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title"><h3>Tension Field</h3><span className="badge">live</span></div>
        <div className="tension-grid">
          {tension.map((n, i) => (
            <div key={i} className="tension-cell" style={{
              background: `oklch(from var(--accent) l c h / ${n * 0.6})`,
              transform: `scale(${0.6 + n * 0.4})`,
            }} />
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-title"><h3>Influence Budget</h3></div>
        {actors.filter(a => a.enabled).map(a => {
          const inf = a.influence ?? Math.floor(100 / Math.max(1, actors.filter(x => x.enabled).length));
          return (
            <div className="influence-row" key={a.id}>
              <span style={{ minWidth: 50, color: "var(--fg-dim)" }}>{a.name}</span>
              <div className="influence-bar"><div style={{ width: `${inf}%`, background: a.color }} /></div>
              <span className="influence-pct">{inf}%</span>
            </div>
          );
        })}
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
