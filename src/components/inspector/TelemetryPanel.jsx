import React, { useMemo } from 'react';
import { Toggle } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';

// ── SVG primitives ────────────────────────────────────────────────────────────

function Sparkline({ data, width = 280, height = 44, colorFn, markers = [], currentLabel = null }) {
  if (!data || data.length === 0) return null;

  const strokeColor = colorFn(data[data.length - 1]);

  if (data.length === 1) {
    const cx = width;
    const cy = height - (data[0] / 100) * height;
    return (
      <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
        <circle cx={cx} cy={cy} r={3} fill={strokeColor} />
      </svg>
    );
  }

  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (v / 100) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      {markers.map(mi => {
        const x = ((mi / (data.length - 1)) * width).toFixed(1);
        return <line key={mi} x1={x} x2={x} y1={0} y2={height} stroke="var(--fg-faint)" strokeDasharray="2 2" strokeWidth={1} />;
      })}
      <polyline points={pts} fill="none" stroke={strokeColor} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {currentLabel && (
        <text x={width - 2} y={10} textAnchor="end" fontSize={9} fill="var(--fg-faint)" fontFamily="var(--font-mono)">{currentLabel}</text>
      )}
    </svg>
  );
}

function MiniBar({ value, max, color, height = 10, width = 160, bg = 'var(--bg-input)', rx = 3 }) {
  const filled = max > 0 ? Math.min(1, value / max) * width : 0;
  return (
    <svg width={width} height={height} style={{ display: 'block', flexShrink: 0 }}>
      <rect x={0} y={0} width={width} height={height} fill={bg} rx={rx} />
      <rect x={0} y={0} width={filled} height={height} fill={color} rx={rx} />
    </svg>
  );
}

const NEED_STYLES = {
  deepen:     { bg: 'oklch(0.55 0.14 240 / 0.18)', fg: 'var(--info)' },
  challenge:  { bg: 'oklch(0.55 0.17 25  / 0.18)', fg: 'var(--danger)' },
  synthesize: { bg: 'oklch(0.55 0.14 295 / 0.18)', fg: 'var(--violet)' },
  broaden:    { bg: 'oklch(0.55 0.14 155 / 0.18)', fg: 'var(--ok)' },
  redirect:   { bg: 'oklch(0.68 0.14 40  / 0.18)', fg: 'oklch(0.78 0.16 40)' },
  decide:     { bg: 'oklch(0.70 0.13 80  / 0.18)', fg: 'var(--warn)' },
  conclude:   { bg: 'oklch(0.50 0.005 255 / 0.18)', fg: 'var(--fg-mute)' },
};

function NeedChip({ need, speaker }) {
  const s = NEED_STYLES[need] || { bg: 'var(--bg-input)', fg: 'var(--fg-faint)' };
  return (
    <span
      title={`${need} · ${speaker}`}
      style={{
        fontSize: 10,
        padding: '2px 7px',
        borderRadius: 8,
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.fg}`,
        fontFamily: 'var(--font-mono)',
        cursor: 'default',
        userSelect: 'none',
      }}
    >
      {need}
    </span>
  );
}

function pressureColor(pct) {
  if (pct >= 85) return 'var(--danger)';
  if (pct >= 70) return 'var(--warn)';
  return 'var(--ok)';
}

const SYSTEM_PURPOSES = new Set(['intentPass', 'goalCheck', 'planningPrePass', 'tinyRouter']);

// ── Main panel ────────────────────────────────────────────────────────────────

export function TelemetryPanel() {
  const apiCallLogs   = useForumState(s => s.diagnostics?.apiCallLogs   || []);
  const parseFailures = useForumState(s => s.diagnostics?.parseFailures  || []);
  const contextInfo   = useForumState(s => s.contextInfo  || {});
  const messages      = useForumState(s => s.messages     || []);
  const actors        = useForumState(s => s.actors       || []);
  const cycleCount    = useForumState(s => s.memory?.cycleCount ?? 0);
  const settings      = useForumState(s => s.settings     || {});

  // ── Context pressure sparkline ──────────────────────────────────────────────
  const pressureData = useMemo(() => {
    const maxCtx = contextInfo.maxContextLength || 0;
    const chatLogs = apiCallLogs
      .filter(l => l.endpoint?.includes('/v1/chat/completions') && l.promptTokens > 0)
      .slice(-30);

    const { points, markers } = chatLogs.reduce((acc, l) => {
      if (!maxCtx) return acc;
      acc.points.push(Math.round((l.promptTokens / maxCtx) * 100));
      if (l.purpose === null && (l.completionTokens || 0) > 500) {
        acc.markers.push(acc.points.length - 1);
      }
      return acc;
    }, { points: [], markers: [] });

    const currentPct = contextInfo.lastPromptTokens && maxCtx
      ? Math.round((contextInfo.lastPromptTokens / maxCtx) * 100)
      : null;

    return { points, markers, currentPct, maxCtx, hasData: points.length > 0 };
  }, [apiCallLogs, contextInfo]);

  // ── Actor participation ─────────────────────────────────────────────────────
  const actorParticipation = useMemo(() =>
    actors
      .filter(a => a.enabled)
      .map(a => ({
        name: a.name,
        color: a.color || 'var(--accent)',
        turnCount: a.turnCount || 0,
        skipCount: a.skipCount || 0,
      }))
      .sort((a, b) => b.turnCount - a.turnCount),
  [actors]);

  // ── Token budget breakdown ──────────────────────────────────────────────────
  const tokenBudget = useMemo(() => {
    const buckets = { actors: 0, memory: 0, director: 0, system: 0 };
    for (const l of apiCallLogs) {
      const tokens = (l.promptTokens || 0) + (l.completionTokens || 0);
      if (!tokens) continue;
      if (l.purpose === null && (l.completionTokens || 0) > 500) buckets.memory   += tokens;
      else if (l.purpose === 'Director')                          buckets.director += tokens;
      else if (SYSTEM_PURPOSES.has(l.purpose))                   buckets.system   += tokens;
      else if (l.purpose !== null)                                buckets.actors   += tokens;
    }
    const total = buckets.actors + buckets.memory + buckets.director + buckets.system;
    return { buckets, total };
  }, [apiCallLogs]);

  // ── Intent flow history ─────────────────────────────────────────────────────
  const needHistory = useMemo(() =>
    messages
      .filter(m => m.routeInfo?.need)
      .slice(-20)
      .map(m => ({ need: m.routeInfo.need, speaker: m.speaker })),
  [messages]);

  // ── Parse failure summary ───────────────────────────────────────────────────
  const parseFailureSummary = useMemo(() => ({
    total:     parseFailures.length,
    succeeded: parseFailures.filter(f => f.retrySucceeded).length,
    latest:    parseFailures[parseFailures.length - 1] || null,
  }), [parseFailures]);

  const maxTurns = actorParticipation[0]?.turnCount || 1;
  const pressureBadgeClass = pressureData.currentPct >= 85 ? 'err' : pressureData.currentPct >= 70 ? 'warn' : 'ok';

  return (
    <div>

      {/* ── Context Pressure ── */}
      <div className="card">
        <div className="card-title">
          <h3>Context Pressure</h3>
          {pressureData.currentPct !== null && (
            <span className={`badge ${pressureBadgeClass}`}>{pressureData.currentPct}%</span>
          )}
        </div>
        {pressureData.hasData ? (
          <>
            <Sparkline
              data={pressureData.points}
              width={280}
              height={44}
              colorFn={pressureColor}
              markers={pressureData.markers}
              currentLabel={pressureData.currentPct !== null ? `${pressureData.currentPct}%` : null}
            />
            {pressureData.markers.length > 0 && (
              <div style={{ fontSize: 10, color: 'var(--fg-faint)', marginTop: 5 }}>
                ╌ memory summarization cycles
              </div>
            )}
          </>
        ) : (
          <div className="empty" style={{ padding: '8px 0', fontSize: 12 }}>
            {pressureData.maxCtx === 0
              ? 'Context size unknown — connect to a model.'
              : 'No API calls logged yet.'}
          </div>
        )}
      </div>

      {/* ── Session Health ── */}
      <div className="card">
        <div className="card-title"><h3>Session Health</h3></div>
        <div className="metrics-grid">
          <div className="metric-tile">
            <span className="metric-val">{cycleCount}</span>
            <span className="metric-lbl">Mem Cycles</span>
          </div>
          <div className="metric-tile">
            <span className="metric-val" style={{ color: parseFailureSummary.total > 0 ? 'var(--danger)' : 'var(--ok)' }}>
              {parseFailureSummary.total}
            </span>
            <span className="metric-lbl">Parse Fails</span>
          </div>
        </div>
        {parseFailureSummary.total > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ fontSize: 11, color: 'var(--danger)', cursor: 'pointer', userSelect: 'none' }}>
              {parseFailureSummary.succeeded}/{parseFailureSummary.total} recovered via fallback
            </summary>
            {parseFailureSummary.latest && (
              <div style={{ marginTop: 6, fontSize: 11 }}>
                <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--warn)' }}>
                  {parseFailureSummary.latest.expectedSchema}
                </div>
                <div style={{ color: 'var(--danger)', marginTop: 2 }}>
                  {parseFailureSummary.latest.parseError}
                </div>
              </div>
            )}
          </details>
        )}
      </div>

      {/* ── Actor Participation ── */}
      {actorParticipation.length > 0 && (
        <div className="card">
          <div className="card-title"><h3>Actor Participation</h3></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {actorParticipation.map(a => {
              const isSilent = a.skipCount > 3 * a.turnCount && a.skipCount > 2;
              return (
                <div key={a.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 72, fontSize: 11, color: 'var(--fg-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {a.name}
                  </span>
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <MiniBar value={a.turnCount} max={maxTurns} color={a.color} height={10} width={120} />
                    {a.skipCount > 0 && (
                      <div style={{ position: 'absolute', top: 0, left: 0, opacity: 0.45 }}>
                        <MiniBar value={a.skipCount} max={maxTurns} color="var(--fg-faint)" height={10} width={120} bg="transparent" />
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--fg-mute)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                    {a.turnCount}t {a.skipCount}s
                    {isSilent && <span style={{ color: 'var(--warn)', marginLeft: 4 }}>silent</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Token Budget ── */}
      {tokenBudget.total > 0 && (
        <div className="card">
          <div className="card-title">
            <h3>Token Budget</h3>
            <span className="badge">{apiCallLogs.length} calls</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[['actors', 'Actors'], ['memory', 'Memory'], ['director', 'Director'], ['system', 'System']].map(([key, label]) => {
              const v = tokenBudget.buckets[key];
              const pct = Math.round(v / tokenBudget.total * 100);
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 52, fontSize: 11, color: 'var(--fg-mute)', flexShrink: 0 }}>{label}</span>
                  <MiniBar value={v} max={tokenBudget.total} color="var(--accent)" height={8} width={140} />
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-faint)', minWidth: 28 }}>{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Intent Flow ── */}
      {needHistory.length > 0 && (
        <div className="card">
          <div className="card-title">
            <h3>Intent Flow</h3>
            <span className="badge">last {needHistory.length}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {needHistory.map((entry, i) => (
              <NeedChip key={i} need={entry.need} speaker={entry.speaker} />
            ))}
          </div>
        </div>
      )}

      {/* ── Settings ── */}
      <details className="card card-disclosure">
        <summary className="card-title">
          <h3>Settings</h3>
          <span className="disclosure-sub">diagnostics · tracing</span>
        </summary>
        <div className="disclosure-body">
          <Toggle
            checked={settings.includeTraces !== false}
            onChange={v => mutateState(s => { s.settings.includeTraces = v; })}
            label="Include prompt traces in diagnostics"
          />
        </div>
      </details>

    </div>
  );
}
