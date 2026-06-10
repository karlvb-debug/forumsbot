import React, { useMemo } from 'react';
import { Toggle } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';

// ── SVG primitives ────────────────────────────────────────────────────────────

// data: values in [0, domain] range — rendered as percent of domain height
function Sparkline({ data, width = 280, height = 44, colorFn, markers = [], currentLabel = null, domain = 100 }) {
  if (!data || data.length === 0) return null;
  const toY = v => height - (Math.min(v, domain) / domain) * height;
  const strokeColor = colorFn(data[data.length - 1]);

  if (data.length === 1) {
    return (
      <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
        <circle cx={width} cy={toY(data[0])} r={3} fill={strokeColor} />
      </svg>
    );
  }

  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    return `${x.toFixed(1)},${toY(v).toFixed(1)}`;
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
        fontSize: 10, padding: '2px 7px', borderRadius: 8,
        background: s.bg, color: s.fg, border: `1px solid ${s.fg}`,
        fontFamily: 'var(--font-mono)', cursor: 'default', userSelect: 'none',
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
function speedColor(tps) {
  if (tps < 4)  return 'var(--danger)';
  if (tps < 8)  return 'var(--warn)';
  return 'var(--ok)';
}
function confidenceColor(pct) {
  if (pct >= 70) return 'var(--ok)';
  if (pct >= 40) return 'var(--warn)';
  return 'var(--danger)';
}

function formatAge(ms) {
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const SYSTEM_PURPOSES = new Set(['intentPass', 'goalCheck', 'planningPrePass', 'tinyRouter']);

// ── Main panel ────────────────────────────────────────────────────────────────

export function TelemetryPanel() {
  const apiCallLogs    = useForumState(s => s.diagnostics?.apiCallLogs   || []);
  const roundCallStats = useForumState(s => s.diagnostics?.roundCallStats || []);
  const parseFailures  = useForumState(s => s.diagnostics?.parseFailures  || []);
  const contextInfo    = useForumState(s => s.contextInfo  || {});
  const messages       = useForumState(s => s.messages     || []);
  const actors         = useForumState(s => s.actors       || []);
  const cycleCount     = useForumState(s => s.memory?.cycleCount ?? 0);
  const pinnedFacts    = useForumState(s => s.memory?.pinnedFacts?.length ?? 0);
  const openQuestions  = useForumState(s => s.memory?.openQuestions?.length ?? 0);
  const settings       = useForumState(s => s.settings     || {});

  // ── Context pressure sparkline ──────────────────────────────────────────────
  const pressureData = useMemo(() => {
    const maxCtx = contextInfo.maxContextLength || 0;
    const chatLogs = apiCallLogs
      .filter(l => l.endpoint?.includes('/v1/chat/completions') && l.promptTokens > 0)
      .slice(-30);
    const { points, markers } = chatLogs.reduce((acc, l) => {
      if (!maxCtx) return acc;
      acc.points.push(Math.round((l.promptTokens / maxCtx) * 100));
      if (l.purpose === null && (l.completionTokens || 0) > 500)
        acc.markers.push(acc.points.length - 1);
      return acc;
    }, { points: [], markers: [] });
    const currentPct = contextInfo.lastPromptTokens && maxCtx
      ? Math.round((contextInfo.lastPromptTokens / maxCtx) * 100) : null;
    return { points, markers, currentPct, maxCtx, hasData: points.length > 0 };
  }, [apiCallLogs, contextInfo]);

  // ── Token speed sparkline ───────────────────────────────────────────────────
  const speedData = useMemo(() => {
    const pts = apiCallLogs
      .filter(l => l.endpoint?.includes('/v1/chat/completions') && l.tokensPerSecondCompletion > 0)
      .slice(-30)
      .map(l => l.tokensPerSecondCompletion);
    const current = pts[pts.length - 1] ?? null;
    return { points: pts, current };
  }, [apiCallLogs]);

  // ── Actor participation + avg tokens ───────────────────────────────────────
  const actorParticipation = useMemo(() => {
    const tokensByActor = {};
    for (const m of messages) {
      if (m.type === 'actor' && m.speaker && m.trace?.completionTokens) {
        tokensByActor[m.speaker] = (tokensByActor[m.speaker] || []);
        tokensByActor[m.speaker].push(m.trace.completionTokens);
      }
    }
    return actors
      .filter(a => a.enabled)
      .map(a => {
        const samples = tokensByActor[a.name] || [];
        const avgTokens = samples.length
          ? Math.round(samples.reduce((s, v) => s + v, 0) / samples.length) : null;
        return { name: a.name, color: a.color || 'var(--accent)', turnCount: a.turnCount || 0, skipCount: a.skipCount || 0, avgTokens };
      })
      .sort((a, b) => b.turnCount - a.turnCount);
  }, [actors, messages]);

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

  // ── Intent flow + confidence trend ─────────────────────────────────────────
  const intentData = useMemo(() => {
    const routed = messages.filter(m => m.routeInfo?.need).slice(-20);
    const needHistory = routed.map(m => ({ need: m.routeInfo.need, speaker: m.speaker }));
    const confidencePoints = routed
      .filter(m => typeof m.routeInfo.confidence === 'number')
      .map(m => Math.round(m.routeInfo.confidence * 100));
    const stuckCount = messages.filter(m => m.routeInfo?.stuck).length;
    return { needHistory, confidencePoints, stuckCount };
  }, [messages]);

  // ── Parse failure summary ───────────────────────────────────────────────────
  const parseFailureSummary = useMemo(() => ({
    total:     parseFailures.length,
    succeeded: parseFailures.filter(f => f.retrySucceeded).length,
    latest:    parseFailures[parseFailures.length - 1] || null,
  }), [parseFailures]);

  // ── Session age ─────────────────────────────────────────────────────────────
  const sessionAge = useMemo(() => {
    const first = messages.find(m => m.createdAt);
    if (!first) return null;
    return formatAge(Date.now() - new Date(first.createdAt).getTime());
  }, [messages]);

  const maxTurns = actorParticipation[0]?.turnCount || 1;
  const pressureBadgeClass = pressureData.currentPct >= 85 ? 'err' : pressureData.currentPct >= 70 ? 'warn' : 'ok';
  const knowledgeMax = Math.max(pinnedFacts, openQuestions, 1);

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
            <Sparkline data={pressureData.points} width={280} height={44} colorFn={pressureColor}
              markers={pressureData.markers}
              currentLabel={pressureData.currentPct !== null ? `${pressureData.currentPct}%` : null} />
            {pressureData.markers.length > 0 && (
              <div style={{ fontSize: 10, color: 'var(--fg-faint)', marginTop: 5 }}>╌ memory summarization cycles</div>
            )}
          </>
        ) : (
          <div className="empty" style={{ padding: '8px 0', fontSize: 12 }}>
            {pressureData.maxCtx === 0 ? 'Context size unknown — connect to a model.' : 'No API calls logged yet.'}
          </div>
        )}
      </div>

      {/* ── Speed ── */}
      {speedData.points.length > 0 && (
        <div className="card">
          <div className="card-title">
            <h3>Generation Speed</h3>
            {speedData.current !== null && (
              <span className={`badge ${speedColor(speedData.current) === 'var(--ok)' ? 'ok' : speedColor(speedData.current) === 'var(--warn)' ? 'warn' : 'err'}`}>
                {speedData.current.toFixed(1)} t/s
              </span>
            )}
          </div>
          <Sparkline data={speedData.points} width={280} height={32} colorFn={speedColor}
            domain={Math.max(30, ...speedData.points)}
            currentLabel={speedData.current !== null ? `${speedData.current.toFixed(1)} t/s` : null} />
        </div>
      )}

      {/* ── Round Cost ── every LLM call behind the last round, including the
            hidden ones (routing, scribe judge, memory summary, goal check). */}
      {roundCallStats.length > 0 && (() => {
        const last = roundCallStats[roundCallStats.length - 1];
        const totalTok = (last.promptTokens || 0) + (last.completionTokens || 0);
        const fmtTok = totalTok >= 1000 ? `${(totalTok / 1000).toFixed(1)}k` : `${totalTok}`;
        return (
          <div className="card">
            <div className="card-title">
              <h3>Round Cost</h3>
              <span className="badge">round {last.round}</span>
            </div>
            <div className="metrics-grid">
              <div className="metric-tile" title="Total LLM calls during the last round — actor turns plus routing, scribe, memory, and goal-check passes">
                <span className="metric-val">{last.calls}</span>
                <span className="metric-lbl">LLM Calls</span>
              </div>
              <div className="metric-tile" title={`${last.promptTokens} prompt + ${last.completionTokens} completion tokens`}>
                <span className="metric-val">{fmtTok}</span>
                <span className="metric-lbl">Tokens</span>
              </div>
              <div className="metric-tile" title="Web and MCP tool executions during the last round">
                <span className="metric-val">{last.toolCalls || 0}</span>
                <span className="metric-lbl">Tool Calls</span>
              </div>
              <div className="metric-tile" title="Calls that returned an error during the last round">
                <span className="metric-val" style={{ color: last.errors > 0 ? 'var(--danger)' : 'var(--ok)' }}>
                  {last.errors}
                </span>
                <span className="metric-lbl">Errors</span>
              </div>
            </div>
            {roundCallStats.length > 1 && (
              <Sparkline
                data={roundCallStats.map(r => r.calls)}
                width={280} height={28}
                colorFn={() => 'var(--accent)'}
                currentLabel={`${last.calls} calls`}
              />
            )}
          </div>
        );
      })()}

      {/* ── Session Health ── */}
      <div className="card">
        <div className="card-title">
          <h3>Session Health</h3>
          {sessionAge && <span className="badge">{sessionAge}</span>}
        </div>
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
          <div className="metric-tile">
            <span className="metric-val" style={{ color: intentData.stuckCount > 2 ? 'var(--warn)' : 'inherit' }}>
              {intentData.stuckCount}
            </span>
            <span className="metric-lbl">Stuck</span>
          </div>
        </div>
        {/* Knowledge health */}
        {(pinnedFacts > 0 || openQuestions > 0) && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 72, fontSize: 11, color: 'var(--fg-mute)', flexShrink: 0 }}>Facts</span>
              <MiniBar value={pinnedFacts} max={knowledgeMax} color="var(--ok)" height={8} width={140} />
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-faint)', minWidth: 16 }}>{pinnedFacts}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 72, fontSize: 11, color: 'var(--fg-mute)', flexShrink: 0 }}>Open Qs</span>
              <MiniBar value={openQuestions} max={knowledgeMax} color="var(--warn)" height={8} width={140} />
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-faint)', minWidth: 16 }}>{openQuestions}</span>
            </div>
          </div>
        )}
        {parseFailureSummary.total > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ fontSize: 11, color: 'var(--danger)', cursor: 'pointer', userSelect: 'none' }}>
              {parseFailureSummary.succeeded}/{parseFailureSummary.total} parse failures recovered
            </summary>
            {parseFailureSummary.latest && (
              <div style={{ marginTop: 6, fontSize: 11 }}>
                <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--warn)' }}>{parseFailureSummary.latest.expectedSchema}</div>
                <div style={{ color: 'var(--danger)', marginTop: 2 }}>{parseFailureSummary.latest.parseError}</div>
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
                    <MiniBar value={a.turnCount} max={maxTurns} color={a.color} height={10} width={110} />
                    {a.skipCount > 0 && (
                      <div style={{ position: 'absolute', top: 0, left: 0, opacity: 0.45 }}>
                        <MiniBar value={a.skipCount} max={maxTurns} color="var(--fg-faint)" height={10} width={110} bg="transparent" />
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--fg-mute)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                    {a.turnCount}t {a.skipCount}s
                    {a.avgTokens !== null && <span style={{ color: 'var(--fg-faint)', marginLeft: 4 }}>{a.avgTokens}tk</span>}
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
      {intentData.needHistory.length > 0 && (
        <div className="card">
          <div className="card-title">
            <h3>Intent Flow</h3>
            <span className="badge">last {intentData.needHistory.length}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {intentData.needHistory.map((entry, i) => (
              <NeedChip key={`${entry.speaker}-${entry.need}-${i}`} need={entry.need} speaker={entry.speaker} />
            ))}
          </div>
          {intentData.confidencePoints.length > 1 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, color: 'var(--fg-faint)', marginBottom: 4 }}>Routing confidence</div>
              <Sparkline data={intentData.confidencePoints} width={280} height={28} colorFn={confidenceColor}
                domain={100}
                currentLabel={`${intentData.confidencePoints[intentData.confidencePoints.length - 1]}%`} />
            </div>
          )}
        </div>
      )}

      {/* ── Settings ── */}
      <details className="card card-disclosure">
        <summary className="card-title">
          <h3>Settings</h3>
        </summary>
        <div className="disclosure-body">
          <Toggle
            checked={settings.includeTraces !== false}
            onChange={v => mutateState(s => { s.settings.includeTraces = v; })}
            label="Include prompt traces in diagnostics"
            title="When enabled, the full assembled prompt is stored with each API call log and is viewable in Prompts → Last Prompt. Disable to reduce memory usage."
          />
        </div>
      </details>

    </div>
  );
}
