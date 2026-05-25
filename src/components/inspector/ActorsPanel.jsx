import React, { useState, useCallback } from 'react';
import * as Ic from '../Icons';
import { Field, Toggle, Range } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';

const PERM_DEFS = [
  { key: 'canDirect',      label: 'Direct',    icon: '🎬', color: 'var(--gold)'  },
  { key: 'canManageCast',  label: 'Manage',    icon: '🔧', color: 'var(--warn)'  },
  { key: 'canResearch',    label: 'Research',   icon: '🔍', color: 'var(--info)'  },
  { key: 'canSeeThoughts', label: 'See Thoughts', icon: '🧠', color: 'var(--purple)' },
];

const DEFAULT_COLORS = ['#2a9d8f', '#7c5cbf', '#4a7fd4', '#c97a40', '#e76f51', '#457b9d', '#c8a830'];

export function ActorsPanel() {
  const actors = useForumState(s => s.actors);
  const [expanded, setExpanded] = useState(null);

  const updateActor = useCallback((id, key, val) => {
    mutateState(s => {
      const a = s.actors.find(x => x.id === id);
      if (a) a[key] = val;
    });
  }, []);

  const addActor = useCallback((overrides = {}) => {
    mutateState(s => {
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
        canResearch: false,
        canSeeThoughts: false,
        temperature: overrides.temperature ?? 0.8,
        color: overrides.color || DEFAULT_COLORS[s.actors.length % DEFAULT_COLORS.length],
        ...overrides,
      });
    });
  }, []);

  const removeActor = useCallback((id) => {
    mutateState(s => { s.actors = s.actors.filter(a => a.id !== id); });
  }, []);

  const activePerms = (a) => PERM_DEFS.filter(p => a[p.key]);

  return (
    <div>
      <div className="btn-row" style={{ marginBottom: 12 }}>
        <button className="btn" onClick={() => addActor()}>
          <Ic.Plus /> Add
        </button>
        <button className="btn" onClick={() => addActor({
          name: 'Director', role: 'Discussion facilitator',
          persona: 'Guide the discussion, summarize, and invite quieter actors.',
          goal: 'Converge on clear decisions.', voice: 'Calm, concise, neutral.',
          canDirect: true, canManageCast: true, color: '#c8a830',
        })}>🎬 Director</button>
        <button className="btn" onClick={() => addActor({
          name: 'Researcher', role: 'Research Specialist',
          goal: 'Provide up-to-date objective research.',
          voice: 'Objective, fact-driven.',
          canResearch: true, temperature: 0.4, color: '#457b9d',
        })}><Ic.Globe width={14} height={14} /> Researcher</button>
      </div>

      {actors.map((a) => {
        const isOpen = expanded === a.id;
        const perms = activePerms(a);
        return (
          <div key={a.id} className={"actor-card" + (isOpen ? " expanded" : "") + (a.enabled ? "" : " disabled")}>
            <div className="actor-card-head" onClick={() => setExpanded(isOpen ? null : a.id)}>
              <span className="actor-swatch" style={{ background: a.color }}>{(a.name || '?')[0]}</span>
              <div className="grow">
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span className="actor-name">{a.name}</span>
                  <span className="actor-role-tag">{a.role}</span>
                  {perms.map(p => (
                    <span key={p.key} className="perm-badge" style={{ color: p.color, borderColor: p.color }}>{p.icon}</span>
                  ))}
                </div>
              </div>
              <Toggle checked={a.enabled} onChange={(v) => { updateActor(a.id, 'enabled', v); }} />
              <Ic.Chevron className="expand-caret" width={14} height={14} />
            </div>
            {isOpen ? (
              <div className="actor-card-body">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <Field label="Name"><input value={a.name} onChange={(e) => updateActor(a.id, 'name', e.target.value)} /></Field>
                  <Field label="Role"><input value={a.role} onChange={(e) => updateActor(a.id, 'role', e.target.value)} /></Field>
                </div>
                <Field label="Persona"><textarea rows={3} value={a.persona} onChange={(e) => updateActor(a.id, 'persona', e.target.value)} /></Field>
                <Field label="Goal"><textarea rows={2} value={a.goal} onChange={(e) => updateActor(a.id, 'goal', e.target.value)} /></Field>
                <Field label="Voice"><input value={a.voice || ''} onChange={(e) => updateActor(a.id, 'voice', e.target.value)} /></Field>
                <Field label="Temperature">
                  <Range value={a.temperature ?? 0.8} min={0.1} max={1.5} step={0.05} onChange={(v) => updateActor(a.id, 'temperature', v)} />
                </Field>

                <div className="perm-row">
                  <span className="lbl">Permissions</span>
                  <div className="perm-chips">
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

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
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
