import React, { useEffect } from 'react';
import { Field } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';

const USER_CONTEXT_KEY = 'forum_user_context';

const MODE_DESCRIPTIONS = {
  sponsor:      'Actors pause only for major decisions or conflicts. The discussion runs independently otherwise.',
  collaborator: 'Actors pause freely to ask your opinion, request decisions, or check their understanding.',
  observer:     'Actors never pause. The discussion runs to completion without interruption.',
};

const PAUSE_REASON_LABELS = {
  decision:      'Decisions',
  conflict:      'Conflicts',
  question:      'Open questions',
  clarification: 'Clarifications',
  information:   'Information requests',
};

export function ParticipationPanel() {
  const userContext = useForumState(s => s.userContext || {});
  const pendingPauses = useForumState(s => s.pendingPauses || []);

  // Load cross-session context on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(USER_CONTEXT_KEY);
      if (stored) {
        const ctx = JSON.parse(stored);
        mutateState(s => { s.userContext = { ...s.userContext, ...ctx, pausePolicy: { ...s.userContext.pausePolicy, ...(ctx.pausePolicy || {}) } }; });
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  const updateCtx = (key, val) => {
    mutateState(s => { s.userContext[key] = val; });
    try {
      const stored = JSON.parse(localStorage.getItem(USER_CONTEXT_KEY) || '{}');
      localStorage.setItem(USER_CONTEXT_KEY, JSON.stringify({ ...stored, [key]: val }));
    } catch { /* ignore */ }
  };

  const updatePolicy = (key, val) => {
    mutateState(s => {
      if (!s.userContext.pausePolicy) s.userContext.pausePolicy = {};
      s.userContext.pausePolicy[key] = val;
    });
    try {
      const stored = JSON.parse(localStorage.getItem(USER_CONTEXT_KEY) || '{}');
      const policy = { ...(stored.pausePolicy || {}), [key]: val };
      localStorage.setItem(USER_CONTEXT_KEY, JSON.stringify({ ...stored, pausePolicy: policy }));
    } catch { /* ignore */ }
  };

  const mode = userContext.interactionMode || 'collaborator';
  const resolved = pendingPauses.filter(p => p.outcome === 'resolved' || p.outcome === 'suppressed');

  return (
    <div>
      <div className="card">
        <div className="card-title"><h3>Your Participation</h3></div>
        <Field label="Display name">
          <input
            value={userContext.displayName || ''}
            onChange={e => updateCtx('displayName', e.target.value)}
            placeholder="Leave blank to stay anonymous"
          />
        </Field>
        <Field label="Participation mode">
          <select
            value={mode}
            onChange={e => updateCtx('interactionMode', e.target.value)}
          >
            <option value="sponsor">Sponsor — pause for decisions only</option>
            <option value="collaborator">Collaborator — pause freely for questions</option>
            <option value="observer">Observer — never pause, let discussion run</option>
          </select>
        </Field>
        <div className="field-hint" style={{ marginTop: -4, marginBottom: 8 }}>
          {MODE_DESCRIPTIONS[mode]}
        </div>

        {mode !== 'observer' && (
          <Field label="Max pauses per round">
            <input
              type="number"
              min={1}
              max={10}
              value={userContext.pausePolicy?.maxPausesPerRound ?? (mode === 'sponsor' ? 1 : 2)}
              onChange={e => updatePolicy('maxPausesPerRound', Math.max(1, Math.min(10, Number(e.target.value))))}
              style={{ width: 80 }}
            />
          </Field>
        )}

        <Field label="Story role (optional)">
          <input
            value={userContext.storyRole || ''}
            onChange={e => updateCtx('storyRole', e.target.value)}
            placeholder="e.g. The client, The mayor, Yourself"
          />
        </Field>
        <div className="field-hint" style={{ marginTop: -4 }}>
          In story sessions, actors can address you by this role name.
        </div>
      </div>

      {mode !== 'observer' && (
        <div className="card">
          <div className="card-title"><h3>Allowed Pause Reasons</h3></div>
          <div className="field-hint" style={{ marginBottom: 8 }}>
            Actors can only pause for the reasons checked below.
          </div>
          {Object.entries(PAUSE_REASON_LABELS).map(([key, label]) => {
            const allowed = userContext.pausePolicy?.allowedReasons
              ? userContext.pausePolicy.allowedReasons.includes(key)
              : (mode === 'sponsor' ? ['decision', 'conflict'].includes(key) : true);
            return (
              <label key={key} className="card-row" style={{ cursor: 'pointer', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={allowed}
                  onChange={e => {
                    const current = userContext.pausePolicy?.allowedReasons
                      || (mode === 'sponsor' ? ['decision', 'conflict'] : Object.keys(PAUSE_REASON_LABELS));
                    const next = e.target.checked
                      ? [...current.filter(r => r !== key), key]
                      : current.filter(r => r !== key);
                    updatePolicy('allowedReasons', next);
                  }}
                />
                <span>{label}</span>
              </label>
            );
          })}
        </div>
      )}

      {resolved.length > 0 && (
        <div className="card">
          <div className="card-title">
            <h3>Pause History</h3>
            <span className="badge">{resolved.length}</span>
          </div>
          {resolved.map(p => (
            <div className="card-row" key={p.id} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
              <span className="lbl">{p.requesterName} · {p.reason}</span>
              <span className="val" style={{ fontSize: 11 }}>{p.question || p.context}</span>
              {p.outcome === 'resolved' && (
                <span className="field-hint" style={{ marginTop: 2 }}>You: {p.userResponse}</span>
              )}
              {p.outcome === 'suppressed' && (
                <span className="field-hint" style={{ marginTop: 2, color: 'var(--muted)' }}>Suppressed</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
