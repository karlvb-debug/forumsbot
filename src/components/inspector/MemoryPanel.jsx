import React, { useState } from 'react';
import * as Ic from '../Icons';
import { Field } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';

export function MemoryPanel() {
  const [section, setSection] = useState('facts');
  const [actionBusy, setActionBusy] = useState('');
  const pinnedFacts = useForumState(s => s.memory?.pinnedFacts || []);
  const pendingFacts = useForumState(s => s.memory?.pendingPinnedFacts || []);
  const openQuestions = useForumState(s => s.memory?.openQuestions || []);
  const sharedSummary = useForumState(s => s.memory?.sharedSummary || '');
  const dmState = useForumState(s => s.memory?.dmState || '');
  const anchors = useForumState(s => s.anchors || []);
  const outcomes = useForumState(s => s.outcomes || {});
  const cycleCount = useForumState(s => s.memory?.cycleCount || 0);
  const archivedCount = useForumState(s => s.memory?.archivedCount || 0);
  const memoryStatus = useForumState(s => s.memory?.status || '');
  const outcomeStatus = useForumState(s => s.outcomes?.status || '');

  const removeFact = (index) => mutateState(s => { s.memory.pinnedFacts.splice(index, 1); });
  const removeQuestion = (index) => mutateState(s => { s.memory.openQuestions.splice(index, 1); });
  const removeAnchor = (index) => mutateState(s => { s.anchors.splice(index, 1); });
  const runMemoryAction = async (label, fn) => {
    setActionBusy(label);
    try {
      await fn();
    } finally {
      setActionBusy('');
    }
  };

  return (
    <div>
      <div className="btn-row" style={{ marginBottom: 12 }}>
        <button className="btn sm" disabled={!!actionBusy} onClick={() => runMemoryAction('summarize', async () => {
          const memory = await import('../../modules/memory.js');
          await memory.summarizeMemory('manual');
        })}>Summarize Now</button>
        <button className="btn sm" disabled={!!actionBusy} onClick={() => runMemoryAction('rebuild', async () => {
          const memory = await import('../../modules/memory.js');
          await memory.summarizeMemory('rebuild', null, { reset: true });
        })}>Rebuild Summary</button>
        <button className="btn sm" disabled={!!actionBusy} onClick={() => runMemoryAction('extract', async () => {
          const memory = await import('../../modules/memory.js');
          await memory.extractOutcomes();
          setSection('outcomes');
        })}>Extract Outcomes</button>
        <button className="btn sm" disabled={!!actionBusy} onClick={() => runMemoryAction('compact', async () => {
          const memory = await import('../../modules/memory.js');
          await memory.compactPinnedFacts();
        })}>Compact Facts</button>
        <button className="btn sm ghost" disabled={!!actionBusy} onClick={() => runMemoryAction('clear', async () => {
          const memory = await import('../../modules/memory.js');
          await memory.clearArchivedMemory();
        })}>Clear Archive</button>
      </div>
      {(memoryStatus || outcomeStatus || actionBusy) && (
        <div className="field-hint" style={{ marginBottom: 10 }}>
          {actionBusy ? `Working: ${actionBusy}...` : memoryStatus || outcomeStatus}
        </div>
      )}
      <div className="subnav">
        <button className={section === "facts" ? "active" : ""} onClick={() => setSection("facts")}>Facts</button>
        <button className={section === "summary" ? "active" : ""} onClick={() => setSection("summary")}>Summary</button>
        <button className={section === "anchors" ? "active" : ""} onClick={() => setSection("anchors")}>Anchors</button>
        <button className={section === "outcomes" ? "active" : ""} onClick={() => setSection("outcomes")}>Outcomes</button>
      </div>

      {section === "facts" && (
        <div>
          <div className="card">
            <div className="card-title"><h3>Pinned Facts</h3><span className="badge">{pinnedFacts.length}</span></div>
            <div className="field-hint" style={{ marginBottom: 10 }}>Injected into every actor prompt. Semantic dedup prevents near-duplicates.</div>
            <div className="fact-list">
              {pinnedFacts.map((f, i) => (
                <div className="fact-item" key={i}>
                  <span className="pin">◆</span>
                  <span>{f}</span>
                  <span className="x" onClick={() => removeFact(i)}>×</span>
                </div>
              ))}
              {!pinnedFacts.length && <div className="empty">No pinned facts yet. Run memory to generate.</div>}
            </div>
            {pendingFacts.length > 0 && (
              <div className="btn-row" style={{ marginTop: 10 }}>
                <button className="btn sm" onClick={() => {
                  mutateState(s => {
                    s.memory.pinnedFacts = [...s.memory.pinnedFacts, ...s.memory.pendingPinnedFacts];
                    s.memory.pendingPinnedFacts = [];
                  });
                }}>Save pending ({pendingFacts.length})</button>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-title"><h3>Open Questions</h3></div>
            <div className="fact-list">
              {(Array.isArray(openQuestions) ? openQuestions : []).map((q, i) => (
                <div className="fact-item" key={i}>
                  <span className="pin" style={{ color: "var(--warn)" }}>?</span>
                  <span>{q}</span>
                  <span className="x" onClick={() => removeQuestion(i)}>×</span>
                </div>
              ))}
              {(!openQuestions.length) && <div className="empty">No open questions yet.</div>}
            </div>
          </div>

          <div className="card">
            <div className="card-title"><h3>Archive</h3><span className="badge">{archivedCount} chunks</span></div>
            <div className="card-row"><span className="lbl">Memory cycles</span><span className="val">{cycleCount}</span></div>
            <div className="card-row"><span className="lbl">Archived chunks</span><span className="val">{archivedCount}</span></div>
          </div>
        </div>
      )}

      {section === "summary" && (
        <div>
          <div className="card">
            <div className="card-title"><h3>Shared Summary</h3><span className="badge">{sharedSummary.split(/\s+/).filter(Boolean).length} words</span></div>
            <textarea rows={14} value={sharedSummary} onChange={(e) => mutateState(s => { s.memory.sharedSummary = e.target.value; })} />
          </div>
          <div className="card">
            <div className="card-title"><h3>DM State</h3></div>
            <textarea rows={5} value={dmState} onChange={(e) => mutateState(s => { s.memory.dmState = e.target.value; })} />
          </div>
        </div>
      )}

      {section === "anchors" && (
        <div className="card">
          <div className="card-title"><h3><Ic.Anchor /> Anchored Agreements</h3><span className="badge">{anchors.length}</span></div>
          <div className="field-hint" style={{ marginBottom: 10 }}>Settled claims injected into every subsequent prompt. Click ⚓ on any message to anchor it.</div>
          {anchors.map((a, i) => (
            <div className="anchor-item" key={a.id || i}>
              <div className="src">{a.source || a.speaker} · {a.time || new Date(a.createdAt).toLocaleTimeString()}</div>
              <div>{a.text}</div>
              <span className="x" onClick={() => removeAnchor(i)} style={{ cursor: 'pointer' }}>×</span>
            </div>
          ))}
          {!anchors.length && <div className="empty">Click ⚓ on a message to anchor a new claim.</div>}
        </div>
      )}

      {section === "outcomes" && (
        <div>
          <div className="card">
            <div className="card-title"><h3>Outcomes</h3></div>
            <Field label="Final recommendation"><textarea rows={3} value={outcomes.finalRecommendation || ''} onChange={(e) => mutateState(s => { s.outcomes.finalRecommendation = e.target.value; })} /></Field>
            <Field label="Decisions"><textarea rows={2} value={Array.isArray(outcomes.decisions) ? outcomes.decisions.join('\n') : (outcomes.decisions || '')} onChange={(e) => mutateState(s => { s.outcomes.decisions = e.target.value.split('\n'); })} /></Field>
            <Field label="Action items"><textarea rows={2} value={Array.isArray(outcomes.actionItems) ? outcomes.actionItems.join('\n') : (outcomes.actionItems || '')} onChange={(e) => mutateState(s => { s.outcomes.actionItems = e.target.value.split('\n'); })} /></Field>
            <Field label="Risks"><textarea rows={2} value={Array.isArray(outcomes.risks) ? outcomes.risks.join('\n') : (outcomes.risks || '')} onChange={(e) => mutateState(s => { s.outcomes.risks = e.target.value.split('\n'); })} /></Field>
            <div className="field-hint">Run after the discussion finishes to mine structured findings.</div>
          </div>
        </div>
      )}
    </div>
  );
}
