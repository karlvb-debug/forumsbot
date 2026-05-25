import React, { useEffect, useState, useCallback } from 'react';
import { Field, Toggle } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';
import { renderMarkdown } from '../../modules/markdown.js';
import * as Ic from '../Icons';

function DocEntry({ entry, actors, onUpdate, onDelete }) {
  const [view, setView] = useState('preview');
  const [fetchingId, setFetchingId] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  const update = (patch) => onUpdate(entry, patch);

  const fetchLink = async () => {
    if (!entry.url) return;
    setFetchingId(true);
    setFetchError(null);
    try {
      const mod = await import('../../modules/knowledge.js');
      const content = await mod.fetchUrlContent(entry.url);
      await onUpdate(entry, {
        content,
        title: entry.title && entry.title !== 'New link' ? entry.title : entry.url
      });
    } catch (err) {
      setFetchError(err?.message || 'Fetch failed');
    } finally {
      setFetchingId(false);
    }
  };

  const attrLines = entry.lineAttribution || [];
  const enabledActors = actors.filter(a => a.enabled);

  return (
    <div className="doc-entry">
      <div className="card-title">
        <input
          className="doc-entry-title-input"
          value={entry.title || ''}
          placeholder="Title"
          onChange={(e) => update({ title: e.target.value })}
        />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className={`doc-type-badge ${entry.type === 'link' ? 'link' : ''}`}>{entry.type || 'doc'}</span>
          {entry.aiEditable && <span className="doc-ai-badge">AI editable</span>}
          <Toggle checked={entry.enabled !== false} onChange={(v) => update({ enabled: v })} />
        </div>
      </div>

      <div className="card-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-mute)' }}>AI can edit</label>
        <Toggle checked={!!entry.aiEditable} onChange={(v) => update({ aiEditable: v })} />
        <label style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-mute)', marginLeft: 12 }}>Visible to</label>
        <select
          style={{ fontSize: 'var(--fs-xs)', padding: '2px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', color: 'var(--fg)' }}
          value={entry.target === 'all' ? 'all' : 'specific'}
          onChange={(e) => update({ target: e.target.value === 'all' ? 'all' : [] })}
        >
          <option value="all">All actors</option>
          <option value="specific">Selected actors…</option>
        </select>
        {Array.isArray(entry.target) && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {actors.filter(a => a.enabled).map(a => (
              <label key={a.id} style={{ fontSize: 'var(--fs-xs)', display: 'flex', alignItems: 'center', gap: 3, color: 'var(--fg-dim)' }}>
                <input
                  type="checkbox"
                  checked={entry.target.includes(a.id)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...entry.target, a.id]
                      : entry.target.filter(id => id !== a.id);
                    update({ target: next });
                  }}
                />
                {a.name}
              </label>
            ))}
          </div>
        )}
      </div>

      {entry.type === 'link' && (
        <Field label="URL">
          <input value={entry.url || ''} onChange={(e) => update({ url: e.target.value })} placeholder="https://…" />
        </Field>
      )}

      <div className="subnav" style={{ marginBottom: 8 }}>
        <button className={view === 'preview' ? 'active' : ''} onClick={() => setView('preview')}>Preview</button>
        <button className={view === 'edit' ? 'active' : ''} onClick={() => setView('edit')}>Edit</button>
        {entry.aiEditable && (
          <button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}>
            History {entry.versions?.length ? `(${entry.versions.length})` : ''}
          </button>
        )}
      </div>

      {view === 'preview' && (
        <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 8, padding: 12, fontSize: 'var(--fs-sm)', color: 'var(--fg-dim)', lineHeight: 1.55, minHeight: 120 }}>
          {entry.content
            ? <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.content) }} />
            : <div className="empty">No content yet.</div>}
        </div>
      )}

      {view === 'edit' && (
        <Field label="Content" hint={`${entry.wordCount || 0} words`}>
          <textarea rows={10} value={entry.content || ''} onChange={(e) => update({ content: e.target.value })} />
        </Field>
      )}

      {view === 'history' && (
        <div>
          {(entry.versions || []).slice().reverse().map((v, i) => (
            <div className="card-row" key={i}>
              <span className="lbl">v{(entry.versions.length) - i} · {new Date(v.timestamp || v.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
              <span className="val">{v.author || 'System'}</span>
            </div>
          ))}
          {!(entry.versions?.length) && <div className="empty">No version history yet.</div>}
        </div>
      )}

      {entry.aiEditable && enabledActors.length > 0 && attrLines.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {enabledActors.map(a => {
            const pct = Math.round((attrLines.filter(l => l.author === a.name).length / attrLines.length) * 100);
            return (
              <div className="influence-row" key={a.id}>
                <span style={{ minWidth: 50, color: 'var(--fg-dim)', fontSize: 'var(--fs-xs)' }}>{a.name}</span>
                <div className="influence-bar"><div style={{ width: `${pct}%`, background: a.color }} /></div>
                <span className="influence-pct">{pct}%</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="btn-row" style={{ marginTop: 8 }}>
        {entry.type === 'link' && (
          <button className="btn sm" onClick={fetchLink} disabled={fetchingId || !entry.url} title={!entry.url ? 'Enter a URL first' : 'Fetch page content'}>
            {fetchingId ? 'Fetching…' : 'Fetch'}
          </button>
        )}
        <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => onDelete(entry.id)}>
          <Ic.Trash width={12} height={12} /> Delete
        </button>
      </div>
      {fetchError && <div className="field-hint hint-warn" style={{ marginTop: 4 }}>⚠ {fetchError}</div>}
    </div>
  );
}

export function DocumentsPanel() {
  const documents = useForumState(s => s.documents || []);
  const actors = useForumState(s => s.actors || []);

  // On mount: sync any IDB entries not already in state.documents
  useEffect(() => {
    let cancelled = false;
    import('../../modules/knowledge.js').then(async (mod) => {
      await mod.syncIdbToDocuments?.();
      if (!cancelled) {
        const entries = await mod.getAllKbEntries();
        mutateState(s => { s.documents = entries; });
      }
    });
    return () => { cancelled = true; };
  }, []);

  const persistEntry = useCallback(async (entry, patch) => {
    const mod = await import('../../modules/knowledge.js');
    const updated = {
      ...entry,
      ...patch,
      wordCount: mod.countWords((patch.content ?? entry.content) || ''),
      updatedAt: new Date().toISOString(),
    };
    await mod.putKbEntry(updated);
    mutateState(s => {
      if (!s.documents) s.documents = [];
      const idx = s.documents.findIndex(e => e.id === updated.id);
      if (idx >= 0) s.documents[idx] = updated;
      else s.documents.push(updated);
    });
  }, []);

  const addEntry = async (type, aiEditable = false) => {
    const mod = await import('../../modules/knowledge.js');
    const entry = mod.newDocument({
      type,
      title: type === 'link' ? 'New link' : aiEditable ? 'New working document' : 'New reference document',
      aiEditable,
    });
    await persistEntry(entry, {});
  };

  const deleteEntry = async (id) => {
    const mod = await import('../../modules/knowledge.js');
    await mod.deleteKbEntry(id);
    mutateState(s => { s.documents = (s.documents || []).filter(e => e.id !== id); });
  };

  const workingDocs = documents.filter(d => d.aiEditable);
  const refDocs = documents.filter(d => !d.aiEditable);

  return (
    <div>
      {/* Working Documents */}
      <div className="card">
        <div className="card-title">
          <h3><Ic.Doc /> Working Documents</h3>
        </div>
        <div className="field-hint" style={{ marginBottom: 10 }}>
          AI actors can propose edits to these documents. Each edit is versioned with author attribution.
        </div>
        {workingDocs.map(entry => (
          <DocEntry
            key={entry.id}
            entry={entry}
            actors={actors}
            onUpdate={persistEntry}
            onDelete={deleteEntry}
          />
        ))}
        {!workingDocs.length && <div className="empty">No working documents. Add one below.</div>}
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => addEntry('document', true)}><Ic.Plus width={12} height={12} /> Add working document</button>
          <button className="btn" onClick={() => addEntry('link', true)}><Ic.Globe width={12} height={12} /> Add working link</button>
        </div>
      </div>

      {/* Reference Documents */}
      <div className="card">
        <div className="card-title">
          <h3><Ic.Search /> Reference Documents</h3>
        </div>
        <div className="field-hint" style={{ marginBottom: 10 }}>
          Read-only context injected into actor prompts. Actors can reference but not edit these.
        </div>
        {refDocs.map(entry => (
          <DocEntry
            key={entry.id}
            entry={entry}
            actors={actors}
            onUpdate={persistEntry}
            onDelete={deleteEntry}
          />
        ))}
        {!refDocs.length && <div className="empty">No reference documents. Add documents or links to ground actor responses.</div>}
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => addEntry('document', false)}><Ic.Plus width={12} height={12} /> Add reference document</button>
          <button className="btn" onClick={() => addEntry('link', false)}><Ic.Globe width={12} height={12} /> Add reference link</button>
        </div>
      </div>
    </div>
  );
}
