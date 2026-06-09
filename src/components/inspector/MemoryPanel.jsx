import React, { useState } from 'react';
import * as Ic from '../Icons';
import { Field } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';

export function MemoryPanel() {
  const [section, setSection] = useState('facts');
  const [actionBusy, setActionBusy] = useState('');
  const pinnedFacts    = useForumState(s => s.memory?.pinnedFacts || []);
  const openQuestions  = useForumState(s => s.memory?.openQuestions || []);
  const sharedSummary  = useForumState(s => s.memory?.sharedSummary || '');
  const dmState        = useForumState(s => s.memory?.dmState || '');
  const anchors        = useForumState(s => s.anchors || []);
  const pendingAnchors = useForumState(s => s.memory?.pendingAnchors || []);
  const outcomes       = useForumState(s => s.outcomes || {});
  const cycleCount     = useForumState(s => s.memory?.cycleCount || 0);
  const archivedCount  = useForumState(s => s.memory?.archivedCount || 0);
  const memoryStatus   = useForumState(s => s.memory?.status || '');
  const outcomeStatus  = useForumState(s => s.outcomes?.status || '');
  const injections     = useForumState(s => s.pendingInjections || []);
  const privateMessages = useForumState(s => s.pendingPrivateMessages || []);
  const actors         = useForumState(s => s.actors || []);

  const removeFact     = i => mutateState(s => { s.memory.pinnedFacts.splice(i, 1); });
  const removeQuestion = i => mutateState(s => { s.memory.openQuestions.splice(i, 1); });
  const removeAnchor   = i => mutateState(s => { s.anchors.splice(i, 1); });

  const runMemoryAction = async (label, fn) => {
    setActionBusy(label);
    try { await fn(); } finally { setActionBusy(''); }
  };

  return (
    <div>
      {/* ── Actions ── */}
      <div className="btn-row" style={{ marginBottom: 8 }}>
        <button className="btn sm" disabled={!!actionBusy} onClick={() => runMemoryAction('summarize', async () => {
          const m = await import('../../modules/memory.js');
          await m.summarizeMemory('manual');
        })}>Summarize Now</button>
        <button className="btn sm" disabled={!!actionBusy} onClick={() => runMemoryAction('extract', async () => {
          const m = await import('../../modules/memory.js');
          await m.extractOutcomes();
          setSection('outcomes');
        })}>Extract Outcomes</button>
      </div>

      <div className="btn-row" style={{ marginBottom: 12 }}>
        <button className="btn sm" disabled={!!actionBusy} title="Discard the current summary and rebuild it from the full transcript" onClick={() => runMemoryAction('rebuild', async () => {
          const m = await import('../../modules/memory.js');
          await m.summarizeMemory('rebuild', null, { reset: true });
        })}>Rebuild Summary</button>
        <button className="btn sm" disabled={!!actionBusy} title="Merge and deduplicate pinned facts to save context space" onClick={() => runMemoryAction('compact', async () => {
          const m = await import('../../modules/memory.js');
          await m.compactPinnedFacts();
        })}>Compact Facts</button>
        <button className="btn sm ghost" disabled={!!actionBusy} title="Permanently delete archived (summarized-away) memory chunks" onClick={() => runMemoryAction('clear', async () => {
          const m = await import('../../modules/memory.js');
          await m.clearArchivedMemory();
        })}>Clear Archive</button>
      </div>

      {(memoryStatus || outcomeStatus || actionBusy) && (
        <div className="field-hint" style={{ marginBottom: 10 }}>
          {actionBusy ? `Working: ${actionBusy}…` : memoryStatus || outcomeStatus}
        </div>
      )}

      {/* ── Nav ── */}
      <div className="subnav">
        <button className={section === 'facts'    ? 'active' : ''} onClick={() => setSection('facts')}>
          Facts {pinnedFacts.length > 0 && <span className="badge sm">{pinnedFacts.length}</span>}
        </button>
        <button className={section === 'summary'  ? 'active' : ''} onClick={() => setSection('summary')}>Summary</button>
        <button className={section === 'anchors'  ? 'active' : ''} onClick={() => setSection('anchors')}>
          Anchors {anchors.length > 0 && <span className="badge sm">{anchors.length}</span>}
        </button>
        <button className={section === 'actors'   ? 'active' : ''} onClick={() => setSection('actors')}>Actors</button>
        <button className={section === 'outcomes' ? 'active' : ''} onClick={() => setSection('outcomes')}>Outcomes</button>
      </div>

      {/* ── Facts ── */}
      {section === 'facts' && (
        <div>
          <div className="card">
            <div className="card-title"><h3>Pinned Facts</h3></div>
            <div className="fact-list">
              {pinnedFacts.map((f, i) => (
                <div className="fact-item" key={i}>
                  <span className="pin">◆</span>
                  <span>{f}</span>
                  <span className="x" onClick={() => removeFact(i)}>×</span>
                </div>
              ))}
              {!pinnedFacts.length && <div className="empty">No pinned facts yet.</div>}
            </div>
          </div>

          <div className="card">
            <div className="card-title"><h3>Open Questions</h3></div>
            <div className="fact-list">
              {(Array.isArray(openQuestions) ? openQuestions : []).map((q, i) => (
                <div className="fact-item" key={i}>
                  <span className="pin" style={{ color: 'var(--warn)' }}>?</span>
                  <span>{q}</span>
                  <span className="x" onClick={() => removeQuestion(i)}>×</span>
                </div>
              ))}
              {!openQuestions.length && <div className="empty">No open questions yet.</div>}
            </div>
          </div>

          {(cycleCount > 0 || archivedCount > 0) && (
            <div className="card">
              <div className="card-title"><h3>Archive</h3></div>
              <div className="card-row">
                <span className="lbl">Memory cycles</span><span className="val">{cycleCount}</span>
              </div>
              <div className="card-row">
                <span className="lbl">Archived chunks</span><span className="val">{archivedCount}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Summary ── */}
      {section === 'summary' && (
        <div>
          <div className="card">
            <div className="card-title">
              <h3>Shared Summary</h3>
              <span className="badge" title="Word count of the shared memory">{sharedSummary.split(/\s+/).filter(Boolean).length} words</span>
            </div>
            <div className="field-hint" style={{ marginBottom: 6 }}>
              Injected at the top of every actor's context. Summarized automatically by memory cycles; you can also edit it directly.
            </div>
            <textarea rows={14} value={sharedSummary}
              onChange={e => mutateState(s => { s.memory.sharedSummary = e.target.value; })} />
          </div>
          {dmState && (
            <div className="card">
              <div className="card-title"><h3>DM State</h3></div>
              <textarea rows={5} value={dmState}
                onChange={e => mutateState(s => { s.memory.dmState = e.target.value; })} />
            </div>
          )}
          {!dmState && (
            <div className="card">
              <div className="card-title"><h3>DM State</h3></div>
              <div className="field-hint" style={{ marginBottom: 6 }}>
                Separate world/scene state maintained by the Director in roleplay sessions. Injected into the Director's context.
              </div>
              <textarea rows={3} placeholder="Scenario / world state (roleplay sessions)." value={dmState}
                onChange={e => mutateState(s => { s.memory.dmState = e.target.value; })} />
            </div>
          )}
        </div>
      )}

      {/* ── Anchors ── */}
      {section === 'anchors' && (
        <div>
          {pendingAnchors.length > 0 && (
            <div className="card" style={{ marginBottom: 8 }}>
              <div className="card-title">
                <h3><Ic.Anchor /> Pending</h3>
                <span className="badge warn">{pendingAnchors.length}</span>
              </div>
              {pendingAnchors.map((a, i) => (
                <div className="anchor-item" key={a.id || i} style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div className="src">{a.speaker} · {a.suggestedAt ? new Date(a.suggestedAt).toLocaleTimeString() : ''}</div>
                    <div>{a.text}</div>
                  </div>
                  <button className="btn sm primary" style={{ marginLeft: 6, flexShrink: 0 }} onClick={() => mutateState(s => {
                    const idx = s.memory.pendingAnchors.findIndex(p => p === a || (a.id && p.id === a.id));
                    if (idx >= 0) { s.anchors.push(s.memory.pendingAnchors[idx]); s.memory.pendingAnchors.splice(idx, 1); }
                  })}>⚓ Approve</button>
                  <button className="btn sm ghost" style={{ marginLeft: 4, flexShrink: 0 }} onClick={() => mutateState(s => {
                    const idx = s.memory.pendingAnchors.findIndex(p => p === a || (a.id && p.id === a.id));
                    if (idx >= 0) s.memory.pendingAnchors.splice(idx, 1);
                  })}>Dismiss</button>
                </div>
              ))}
            </div>
          )}
          <div className="card">
            <div className="card-title">
              <h3><Ic.Anchor /> Anchored</h3>
              <span className="badge">{anchors.length}</span>
            </div>
            {anchors.map((a, i) => (
              <div className="anchor-item" key={a.id || i}>
                <div className="src">{a.source || a.speaker} · {a.time || new Date(a.createdAt).toLocaleTimeString()}</div>
                <div>{a.text}</div>
                <span className="x" onClick={() => removeAnchor(i)} style={{ cursor: 'pointer' }}>×</span>
              </div>
            ))}
            {!anchors.length && <div className="empty">Click ⚓ on any message to anchor a claim.</div>}
          </div>
        </div>
      )}

      {/* ── Actors ── */}
      {section === 'actors' && (
        <div>
          {actors.filter(a => a.enabled !== false).length === 0 && (
            <div className="card"><div className="empty">No active actors.</div></div>
          )}
          {actors.filter(a => a.enabled !== false).map(actor => {
            const rels = actor.relationships && typeof actor.relationships === 'object'
              ? Object.entries(actor.relationships).filter(([, v]) => v)
              : [];
            return (
              <div className="card" key={actor.id} style={{ marginBottom: 10 }}>
                <div className="card-title">
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: actor.color || 'var(--fg-faint)', display: 'inline-block', flexShrink: 0 }} />
                    {actor.name}
                  </h3>
                  <span className="badge">{actor.role}</span>
                </div>
                <textarea
                  rows={4}
                  value={actor.thoughts || ''}
                  placeholder="No memory accumulated yet."
                  onChange={e => mutateState(s => {
                    const a = s.actors.find(x => x.id === actor.id);
                    if (a) a.thoughts = e.target.value;
                  })}
                />
                {rels.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-mute)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Relationships</div>
                    {rels.map(([name, opinion]) => (
                      <div key={name} className="card-row" style={{ alignItems: 'flex-start', gap: 6 }}>
                        <span className="lbl" style={{ minWidth: 80, flexShrink: 0 }}>{name}</span>
                        <span className="val" style={{ whiteSpace: 'pre-wrap', textAlign: 'left' }}>{opinion}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Outcomes ── */}
      {section === 'outcomes' && (
        <div className="card">
          <div className="card-title"><h3>Outcomes</h3></div>
          <Field label="Final recommendation" info="AI-extracted summary of what the group concluded. Run 'Extract Outcomes' to populate automatically, or edit directly.">
            <textarea rows={3} value={outcomes.finalRecommendation || ''}
              onChange={e => mutateState(s => { s.outcomes.finalRecommendation = e.target.value; })} />
          </Field>
          <Field label="Decisions" info="Choices the group committed to. One per line. Auto-extracted from the transcript.">
            <textarea rows={2} value={Array.isArray(outcomes.decisions) ? outcomes.decisions.join('\n') : (outcomes.decisions || '')}
              onChange={e => mutateState(s => { s.outcomes.decisions = e.target.value.split('\n'); })} />
          </Field>
          <Field label="Action items" info="Tasks assigned to people or roles. One per line. Auto-extracted from the transcript.">
            <textarea rows={2} value={Array.isArray(outcomes.actionItems) ? outcomes.actionItems.join('\n') : (outcomes.actionItems || '')}
              onChange={e => mutateState(s => { s.outcomes.actionItems = e.target.value.split('\n'); })} />
          </Field>
          <Field label="Risks" info="Concerns, blockers, or open uncertainties identified during the session.">
            <textarea rows={2} value={Array.isArray(outcomes.risks) ? outcomes.risks.join('\n') : (outcomes.risks || '')}
              onChange={e => mutateState(s => { s.outcomes.risks = e.target.value.split('\n'); })} />
          </Field>
        </div>
      )}

      {/* ── Active Steering ── */}
      {(injections.length > 0 || privateMessages.filter(m => !m.consumed).length > 0) && (
        <details className="card">
          <summary>Active Steering ({injections.length + privateMessages.filter(m => !m.consumed).length})</summary>
          <div className="steering-list">
            {injections.map(inj => (
              <div key={inj.id} className="steering-item">
                <span className="badge sm">{inj.scope}</span>
                <span className="steering-target">→ {actors.find(a => a.id === inj.targetId)?.name || 'unknown'}</span>
                <span className="steering-content">{inj.content}</span>
                <button className="btn-icon sm" onClick={() => mutateState(s => {
                  s.pendingInjections = s.pendingInjections.filter(i => i.id !== inj.id);
                })}>×</button>
              </div>
            ))}
            {privateMessages.filter(m => !m.consumed).map(pm => (
              <div key={pm.id} className="steering-item">
                <span className="badge sm">PM</span>
                <span className="steering-target">{pm.fromName} → {pm.toName}</span>
                <span className="steering-content">{pm.content}</span>
                <button className="btn-icon sm" onClick={() => mutateState(s => {
                  s.pendingPrivateMessages = s.pendingPrivateMessages.filter(m => m.id !== pm.id);
                })}>×</button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
