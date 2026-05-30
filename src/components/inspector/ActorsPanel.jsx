import React, { useState, useCallback, useMemo } from 'react';
import * as Ic from '../Icons';
import { Field, Toggle, Range } from '../shared/FormControls';
import { useForumState, mutateState, saveState } from '../../hooks/useForumState';
import { putActorMemory } from '../../modules/db.js';
import { navigateToPanel } from '../../hooks/navigation.js';
import { ACTOR_LIBRARY } from '../../modules/blueprints.js';

const PERM_DEFS = [
  { key: 'canDirect',      label: 'Direct',      icon: '🎬', color: 'var(--gold)'   },
  { key: 'canManageCast',  label: 'Manage',      icon: '🔧', color: 'var(--warn)'   },
  { key: 'canInject',      label: 'Inject',      icon: '🎯', color: 'var(--teal)'   },
  { key: 'canResearch',    label: 'Research',    icon: '🔍', color: 'var(--info)'   },
  { key: 'canSeeThoughts', label: 'See Thoughts', icon: '🧠', color: 'var(--purple)' },
];

const DEFAULT_COLORS = ['#2a9d8f', '#7c5cbf', '#4a7fd4', '#c97a40', '#e76f51', '#457b9d', '#c8a830'];

const TRIGGER_DEFS = [
  { key: 'on_every_turn',       label: 'Every turn',   icon: '🔄' },
  { key: 'on_user_message',     label: 'User message', icon: '💬' },
  { key: 'on_round_start',      label: 'Round start',  icon: '▶️'  },
  { key: 'on_round_end',        label: 'Round end',    icon: '⏹️'  },
  { key: 'on_conflict',         label: 'Conflict',     icon: '⚡' },
  { key: 'on_agent_repetition', label: 'Repetition',   icon: '🔁' },
];

const ACTOR_TEMPLATES = ACTOR_LIBRARY;

function RelationshipAdd({ actors, currentId, onAdd }) {
  const [sel, setSel] = useState('');
  const others = actors.filter(a => a.id !== currentId);
  if (!others.length) return null;
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <select style={{ flex: 1, fontSize: 12 }} value={sel} onChange={e => setSel(e.target.value)}>
        <option value="">+ Add relationship…</option>
        {others.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
      </select>
      <button className="btn sm" disabled={!sel} onClick={() => { if (sel) { onAdd(sel); setSel(''); } }}>Add</button>
    </div>
  );
}

export function ActorsPanel() {
  const actors = useForumState(s => s.actors);
  const messages = useForumState(s => s.messages || []);
  const [expanded, setExpanded] = useState(null);
  const [aiDesc, setAiDesc] = useState('');
  const [aiDescGenerating, setAiDescGenerating] = useState(false);
  const [aiDescError, setAiDescError] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);
  const [dropIdx, setDropIdx] = useState(null);

  const moveActor = useCallback((from, to) => {
    if (from === to || from < 0 || to < 0) return;
    mutateState(s => {
      const [moved] = s.actors.splice(from, 1);
      s.actors.splice(to, 0, moved);
    });
  }, []);

  // Per-actor stats: turns taken and words spoken
  const actorStats = useMemo(() => {
    const stats = {};
    messages.forEach(m => {
      if (m.type === 'skip' || m.type === 'system' || m.type === 'user') return;
      const key = m.actorId || m.speaker;
      if (!key) return;
      if (!stats[key]) stats[key] = { turns: 0, words: 0 };
      stats[key].turns++;
      stats[key].words += (m.content || m.text || '').trim().split(/\s+/).filter(Boolean).length;
    });
    return stats;
  }, [messages]);

  const updateActor = useCallback((id, key, val) => {
    mutateState(s => {
      const a = s.actors.find(x => x.id === id);
      if (a) a[key] = val;
    });
  }, []);

  const addActor = useCallback((overrides = {}) => {
    mutateState(s => {
      // Enforce at most one director — demote any existing director if a new one is added
      if (overrides.canDirect) {
        s.actors.forEach(a => { a.canDirect = false; a.canManageCast = false; });
      }
      s.actors.push({
        id: crypto.randomUUID(),
        name: overrides.name || `Actor ${s.actors.length + 1}`,
        role: overrides.role || 'Participant',
        persona: overrides.persona || '',
        goal: overrides.goal || '',
        voice: overrides.voice || '',
        thoughts: '', relationships: {},
        enabled: true, expanded: false,
        canDirect: false,
        canManageCast: false,
        canInject: false,
        canResearch: false,
        canSeeThoughts: false,
        authority: 50,
        turnSchedule: 'normal',
        actorMode: 'participant',
        triggerOn: [],
        temperature: overrides.temperature ?? 0.8,
        color: overrides.color || DEFAULT_COLORS[s.actors.length % DEFAULT_COLORS.length],
        ...overrides,
      });
    });
  }, []);

  const removeActor = useCallback((id) => {
    mutateState(s => {
      s.actors = s.actors.filter(a => a.id !== id);
      s.turnQueue = (s.turnQueue || []).filter(qid => qid !== id);
    });
  }, []);

  const generateFromDescription = useCallback(async () => {
    const desc = aiDesc.trim();
    if (!desc) return;
    setAiDescGenerating(true);
    setAiDescError(null);
    try {
      const { chatCompletion } = await import('../../modules/api.js');
      const text = String(await chatCompletion(
        `You create forum actor definitions from one-line descriptions. Output ONLY valid JSON with keys: name, role, persona, goal, voice. No explanation.`,
        `Description: "${desc}"\n\nOutput JSON:`,
        { temperature: 0.7, maxTokens: 400 }
      ) || '').trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response.');
      const actor = JSON.parse(jsonMatch[0]);
      addActor({
        name: actor.name || 'AI Actor',
        role: actor.role || 'Participant',
        persona: actor.persona || '',
        goal: actor.goal || '',
        voice: actor.voice || '',
      });
      setAiDesc('');
    } catch (err) {
      setAiDescError(err?.message || 'Generation failed.');
    } finally {
      setAiDescGenerating(false);
    }
  }, [aiDesc, addActor]);

  const activePerms = (a) => PERM_DEFS.filter(p => a[p.key]);

  return (
    <div>
      <div className="btn-row" style={{ marginBottom: 12 }}>
        <button className="btn" onClick={() => addActor()} style={{ padding: '4px 10px', fontSize: 12, height: 28 }}>
          <Ic.Plus /> Add Blank
        </button>
        <select
          className="btn"
          style={{
            flex: 1,
            fontSize: '12px',
            padding: '4px 8px',
            height: 28,
            cursor: 'pointer',
            background: 'var(--bg-card)',
            color: 'var(--fg)',
            border: '1px solid var(--border)',
            borderRadius: '6px'
          }}
          value=""
          onChange={(e) => {
            const tpl = ACTOR_TEMPLATES.find(t => t.key === e.target.value);
            if (tpl) {
              addActor({
                name: tpl.name,
                role: tpl.role,
                persona: tpl.persona,
                goal: tpl.goal,
                voice: tpl.voice,
                temperature: tpl.temperature,
                color: tpl.color,
                canDirect: !!tpl.canDirect,
                canManageCast: !!tpl.canManageCast,
                canInject: !!tpl.canInject,
                canResearch: !!tpl.canResearch,
                canSeeThoughts: !!tpl.canSeeThoughts,
                authority: tpl.authority ?? 50,
                turnSchedule: tpl.turnSchedule || 'normal',
                actorMode: tpl.actorMode || 'participant',
                triggerOn: Array.isArray(tpl.triggerOn) ? [...tpl.triggerOn] : [],
                ...(tpl.maxTokens != null ? { maxTokens: tpl.maxTokens } : {}),
              });
            }
            e.target.value = "";
          }}
        >
          <option value="" disabled>+ Add from library…</option>
          {[...new Set(ACTOR_TEMPLATES.map(t => t.group || 'Other'))].map(group => (
            <optgroup key={group} label={group}>
              {ACTOR_TEMPLATES.filter(t => (t.group || 'Other') === group).map(tpl => (
                <option key={tpl.key} value={tpl.key}>{tpl.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: 'var(--fg-mute)', marginBottom: 4 }}>AI from description</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            style={{ flex: 1, fontSize: 12 }}
            placeholder="e.g. a skeptical economist who challenges growth…"
            value={aiDesc}
            onChange={e => { setAiDesc(e.target.value); setAiDescError(null); }}
            onKeyDown={e => { if (e.key === 'Enter') generateFromDescription(); }}
            disabled={aiDescGenerating}
          />
          <button className="btn sm primary" onClick={generateFromDescription} disabled={aiDescGenerating || !aiDesc.trim()}>
            {aiDescGenerating ? '…' : '+ AI'}
          </button>
        </div>
        {aiDescError && <div className="field-hint" style={{ color: 'var(--danger)', marginTop: 2 }}>{aiDescError}</div>}
      </div>

      {actors.map((a, idx) => {
        const isOpen = expanded === a.id;
        const perms = activePerms(a);
        const stats = actorStats[a.id] || actorStats[a.name] || null;
        return (
          <div
            key={a.id}
            className={"actor-card" + (isOpen ? " expanded" : "") + (a.enabled ? "" : " disabled") + (dragIdx === idx ? " dragging" : "") + (dropIdx === idx ? " drop-above" : "")}
            draggable
            onDragStart={(e) => { setDragIdx(idx); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)); }}
            onDragEnd={() => { setDragIdx(null); setDropIdx(null); }}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragIdx !== null && dragIdx !== idx) setDropIdx(idx); }}
            onDragLeave={() => { if (dropIdx === idx) setDropIdx(null); }}
            onDrop={(e) => { e.preventDefault(); const from = dragIdx ?? parseInt(e.dataTransfer.getData('text/plain'), 10); moveActor(from, idx); setDragIdx(null); setDropIdx(null); }}
          >
            <div className="actor-card-head" onClick={() => { const opening = !isOpen; setExpanded(opening ? a.id : null); }}>
              <div className="actor-reorder">
                <button className="reorder-btn" title="Move up" disabled={idx === 0} onClick={(e) => { e.stopPropagation(); moveActor(idx, idx - 1); }}>▲</button>
                <button className="reorder-btn" title="Move down" disabled={idx === actors.length - 1} onClick={(e) => { e.stopPropagation(); moveActor(idx, idx + 1); }}>▼</button>
              </div>
              <span className="actor-swatch" style={{ background: a.color }}>{(a.name || '?')[0]}</span>
              <div className="grow" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span className="actor-name">{a.name}</span>
                  <span className="actor-role-tag">{a.role}</span>
                </div>
                {(perms.length > 0 || stats) && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {perms.map(p => (
                      <span key={p.key} className="perm-badge" style={{ color: p.color, borderColor: p.color }}>{p.icon}</span>
                    ))}
                    {stats && (
                      <span className="actor-stats-badge" title={`${stats.turns} turns · ${stats.words} words spoken`}>
                        {stats.turns}t · {stats.words}w
                      </span>
                    )}
                  </div>
                )}
              </div>
              <Toggle checked={a.enabled} onChange={(v) => { updateActor(a.id, 'enabled', v); }} />
              <Ic.Chevron className="expand-caret" width={14} height={14} />
            </div>
            {isOpen ? (
              <div className="actor-card-body">
                {/* ── Identity (always visible) ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <Field label="Name"><input value={a.name} onChange={(e) => updateActor(a.id, 'name', e.target.value)} /></Field>
                    <Field label="Role"><input value={a.role} onChange={(e) => updateActor(a.id, 'role', e.target.value)} /></Field>
                  </div>
                  <Field label="Persona"><textarea rows={3} value={a.persona} onChange={(e) => updateActor(a.id, 'persona', e.target.value)} /></Field>
                  <Field label="Goal"><textarea rows={2} value={a.goal} onChange={(e) => updateActor(a.id, 'goal', e.target.value)} /></Field>
                  <Field label="Voice"><input value={a.voice || ''} onChange={(e) => updateActor(a.id, 'voice', e.target.value)} /></Field>
                </div>

                {/* ── Behavior (always visible) ── */}
                <div className="actor-section-divider" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Field label={`Authority — ${a.authority ?? 50}`} info="How much weight other actors give this actor's claims. Does NOT change speaking order.">
                    <Range value={a.authority ?? 50} min={0} max={100} step={5} onChange={(v) => updateActor(a.id, 'authority', v)} />
                  </Field>
                  <div className="field-hint" style={{ marginTop: -4 }}>
                    0 = background voice &nbsp;·&nbsp; 50 = peer &nbsp;·&nbsp; 100 = domain authority
                  </div>
                  <Field label={`Temperature — ${(a.temperature ?? 0.8).toFixed(2)}`} info="Per-actor creativity. Overrides the global default set in Connection → Generation.">
                    <Range value={a.temperature ?? 0.8} min={0.1} max={1.5} step={0.05} onChange={(v) => updateActor(a.id, 'temperature', v)} />
                  </Field>
                  <div className="field-hint" style={{ marginTop: -4 }}>
                    Low = focused &nbsp;·&nbsp; High = creative / unpredictable &nbsp;·&nbsp;
                    <button type="button" className="link-btn" onClick={() => navigateToPanel('connection')}>
                      Global default →
                    </button>
                  </div>
                  <div>
                    <div className="actor-section-label">Permissions</div>
                    <div className="perm-chips" style={{ marginTop: 6 }}>
                      {PERM_DEFS.map(p => (
                        <button
                          key={p.key}
                          className={"perm-chip" + (a[p.key] ? " active" : "")}
                          style={a[p.key] ? { '--perm-color': p.color } : {}}
                          onClick={() => updateActor(a.id, p.key, !a[p.key])}
                          title={p.label}
                        >
                          {p.icon} {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* ── Advanced (collapsed by default) ── */}
                <details className="actor-advanced card-disclosure">
                  <summary>
                    <span className="actor-section-label" style={{ textTransform: 'none', fontSize: 12, letterSpacing: 0 }}>Advanced</span>
                    <span className="disclosure-sub">scheduling · triggers · relationships · tokens</span>
                  </summary>
                  <div className="disclosure-body">
                    <Field label="Max tokens" info="Cap on this actor's response length. Leave blank to use the global default.">
                      <input
                        type="number"
                        placeholder="default"
                        min={100}
                        max={8000}
                        step={100}
                        value={a.maxTokens ?? ''}
                        onChange={(e) => {
                          const val = e.target.value === '' ? undefined : Math.min(8000, Math.max(100, Number(e.target.value)));
                          updateActor(a.id, 'maxTokens', val);
                        }}
                        style={{ width: 100 }}
                      />
                    </Field>

                    <div>
                      <div className="actor-section-label">Scheduling</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
                        <Field label="Turn schedule" info="When this actor is eligible to speak: every round, every single turn, alternating rounds, or only when called on.">
                          <select value={a.turnSchedule || 'normal'} onChange={e => updateActor(a.id, 'turnSchedule', e.target.value)}>
                            <option value="normal">Normal — once per round</option>
                            <option value="every-turn">Every turn</option>
                            <option value="alternate">Alternate rounds</option>
                            <option value="on-call">On-call only</option>
                          </select>
                        </Field>
                        <Field label="Visibility">
                          <select value={a.actorMode || 'participant'} onChange={e => updateActor(a.id, 'actorMode', e.target.value)}>
                            <option value="participant">Participant</option>
                            <option value="background">Background</option>
                          </select>
                        </Field>
                      </div>
                      {(a.turnSchedule === 'every-turn' || a.actorMode === 'background') && (
                        <div className="field-hint" style={{ marginTop: 4 }}>
                          {a.turnSchedule === 'every-turn' && 'Runs silently between each actor turn. '}
                          {a.actorMode === 'background' && 'No transcript entry — injections/routing/cast changes only.'}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="actor-section-label">Event triggers</div>
                      <div className="perm-chips" style={{ marginTop: 6 }}>
                        {TRIGGER_DEFS.map(t => {
                          const active = Array.isArray(a.triggerOn) && a.triggerOn.includes(t.key);
                          return (
                            <button
                              key={t.key}
                              className={"perm-chip" + (active ? " active" : "")}
                              style={active ? { '--perm-color': 'var(--teal)' } : {}}
                              onClick={() => {
                                const current = Array.isArray(a.triggerOn) ? a.triggerOn : [];
                                updateActor(a.id, 'triggerOn', active
                                  ? current.filter(e => e !== t.key)
                                  : [...current, t.key]);
                              }}
                              title={t.key}
                            >
                              {t.icon} {t.label}
                            </button>
                          );
                        })}
                      </div>
                      <div className="field-hint" style={{ marginTop: 6 }}>
                        Actor fires when any checked event occurs, regardless of turn schedule.
                      </div>
                    </div>

                    <div>
                      <div className="actor-section-label">Relationships</div>
                      <div className="field-hint" style={{ marginTop: 4, marginBottom: 6 }}>How this actor relates to others. Injected into their prompt context.</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {Object.entries(a.relationships || {}).map(([name, rel]) => (
                          <div key={name} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <span style={{ minWidth: 70, fontSize: 12, color: 'var(--fg-dim)' }}>{name}</span>
                            <input
                              style={{ flex: 1, fontSize: 12 }}
                              value={rel}
                              placeholder="e.g. trusts but challenges"
                              onChange={e => updateActor(a.id, 'relationships', { ...a.relationships, [name]: e.target.value })}
                            />
                            <button className="mini-icon-btn" title="Remove" onClick={() => {
                              const r = { ...(a.relationships || {}) };
                              delete r[name];
                              updateActor(a.id, 'relationships', r);
                            }}><Ic.Trash width={10} height={10} /></button>
                          </div>
                        ))}
                        <RelationshipAdd actors={actors} currentId={a.id} onAdd={(name) => {
                          updateActor(a.id, 'relationships', { ...a.relationships, [name]: '' });
                        }} />
                      </div>
                    </div>
                  </div>
                </details>

                {/* ── Always-visible action strip ── */}
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border-soft)' }}>
                  <button
                    className="btn ghost sm"
                    title="Clear this actor's private memory"
                    onClick={async () => {
                      await putActorMemory(a.id, '');
                      mutateState(s => {
                        const actor = s.actors.find(x => x.id === a.id);
                        if (actor) actor.thoughts = '';
                      });
                    }}
                  >
                    🧹 Reset memory
                  </button>
                  <button className="btn ghost sm" style={{ color: "var(--danger)" }} onClick={() => removeActor(a.id)}>
                    <Ic.Trash width={12} height={12} /> Remove
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
