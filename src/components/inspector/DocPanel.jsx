import React, { useState } from 'react';
import * as Ic from '../Icons';
import { Field, Toggle, Range } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';
import { renderMarkdown } from '../../modules/markdown.js';

export function DocPanel() {
  const [view, setView] = useState('preview');
  const doc = useForumState(s => s.document || {});
  const actors = useForumState(s => s.actors || []);

  const update = (key, val) => mutateState(s => { s.document[key] = val; });

  return (
    <div>
      <div className="card">
        <div className="card-title">
          <h3><Ic.Doc /> Shared Document</h3>
          <Toggle checked={doc.enabled ?? false} onChange={(v) => update('enabled', v)} />
        </div>
        <Field label="Title"><input value={doc.title || ''} onChange={(e) => update('title', e.target.value)} /></Field>
        <div className="subnav" style={{ marginBottom: 10 }}>
          <button className={view === "preview" ? "active" : ""} onClick={() => setView("preview")}>Preview</button>
          <button className={view === "edit" ? "active" : ""} onClick={() => setView("edit")}>Edit</button>
          <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}>History</button>
        </div>

        {view === "preview" && (
          <div style={{ background: "var(--bg-input)", border: "1px solid var(--border-soft)", borderRadius: 8, padding: 12, fontSize: "var(--fs-sm)", color: "var(--fg-dim)", lineHeight: 1.55, minHeight: 220 }}>
            {doc.content ? <div dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.content) }} /> : <div className="empty">No document content yet. Enable the document and actors will contribute.</div>}
          </div>
        )}

        {view === "edit" && (
          <textarea rows={14} value={doc.content || ''} onChange={(e) => update('content', e.target.value)} />
        )}

        {view === "history" && (
          <div>
            {(doc.versions || []).slice(-8).reverse().map((v, i) => (
              <div className="card-row" key={i}>
                <span className="lbl">v{(doc.versions?.length || 0) - i} · {new Date(v.timestamp || v.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                <span className="val">{v.author || v.speaker || 'System'} · edit</span>
              </div>
            ))}
            {!(doc.versions?.length) && <div className="empty">No version history yet.</div>}
          </div>
        )}
      </div>

      {actors.filter(a => a.enabled).length > 0 && (
        <div className="card">
          <div className="card-title"><h3>Attribution</h3></div>
          {(() => {
            const lines = doc.lineAttribution || [];
            return actors.filter(a => a.enabled).map(a => {
              const actorLines = lines.filter(l => l.author === a.name).length;
              const pct = lines.length ? Math.round((actorLines / lines.length) * 100) : 0;
              return (
                <div className="influence-row" key={a.id}>
                  <span style={{ minWidth: 50, color: "var(--fg-dim)" }}>{a.name}</span>
                  <div className="influence-bar"><div style={{ width: `${pct}%`, background: a.color }} /></div>
                  <span className="influence-pct">{pct}%</span>
                </div>
              );
            });
          })()}
          {!(doc.lineAttribution?.length) && <div className="field-hint" style={{ marginTop: 4 }}>Attribution populates as actors edit the document.</div>}
        </div>
      )}
    </div>
  );
}
