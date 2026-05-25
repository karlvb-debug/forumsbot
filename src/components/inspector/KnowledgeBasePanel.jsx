import React from 'react';
import { Field, Toggle } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';
import * as Ic from '../Icons';

export function KnowledgeBasePanel() {
  const kb = useForumState(s => s.knowledgeBase || []);
  const actors = useForumState(s => s.actors || []);

  return (
    <div>
      <div className="card">
        <div className="card-title"><h3><Ic.Search /> Knowledge Base</h3></div>
        <div className="field-hint" style={{ marginBottom: 10 }}>
          Add documents, links, or text that actors can reference during discussions.
        </div>
        {kb.map((entry, i) => (
          <div className="card" key={entry.id || i} style={{ marginBottom: 8 }}>
            <div className="card-title">
              <h3 style={{ fontSize: 'var(--fs-sm)' }}>{entry.title || 'Untitled'}</h3>
              <Toggle checked={entry.enabled !== false} onChange={(v) => mutateState(s => { (s.knowledgeBase || [])[i].enabled = v; })} />
            </div>
            <div className="card-row"><span className="lbl">Type</span><span className="val">{entry.type || 'text'}</span></div>
            {entry.targetActor && <div className="card-row"><span className="lbl">Target</span><span className="val">{entry.targetActor}</span></div>}
          </div>
        ))}
        {!kb.length && <div className="empty">No knowledge base entries. Add documents or links to ground actor responses.</div>}
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn"><Ic.Plus width={12} height={12} /> Add document</button>
          <button className="btn"><Ic.Globe width={12} height={12} /> Add link</button>
        </div>
      </div>
    </div>
  );
}
