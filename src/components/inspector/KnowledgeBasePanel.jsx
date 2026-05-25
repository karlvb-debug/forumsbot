import React, { useEffect } from 'react';
import { Field, Toggle } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';
import * as Ic from '../Icons';

export function KnowledgeBasePanel() {
  const kb = useForumState(s => s.knowledgeBase || []);

  useEffect(() => {
    let cancelled = false;
    import('../../modules/knowledge.js').then(async (mod) => {
      const entries = await mod.getAllKbEntries();
      if (!cancelled) mutateState(s => { s.knowledgeBase = entries; });
    });
    return () => { cancelled = true; };
  }, []);

  const persistEntry = async (entry) => {
    const mod = await import('../../modules/knowledge.js');
    const updated = { ...entry, wordCount: mod.countWords(entry.content || '') };
    await mod.putKbEntry(updated);
    mutateState(s => {
      const current = s.knowledgeBase || [];
      s.knowledgeBase = current.some(e => e.id === updated.id)
        ? current.map(e => e.id === updated.id ? updated : e)
        : [...current, updated];
    });
  };

  const addEntry = async (type) => {
    const mod = await import('../../modules/knowledge.js');
    const entry = mod.newKbEntry({
      type,
      title: type === 'link' ? 'New link' : 'New document',
      content: '',
      url: ''
    });
    await persistEntry(entry);
  };

  const updateEntry = (entry, patch) => {
    persistEntry({ ...entry, ...patch });
  };

  const deleteEntry = async (id) => {
    const mod = await import('../../modules/knowledge.js');
    await mod.deleteKbEntry(id);
    mutateState(s => { s.knowledgeBase = (s.knowledgeBase || []).filter(e => e.id !== id); });
  };

  const fetchLink = async (entry) => {
    if (!entry.url) return;
    const mod = await import('../../modules/knowledge.js');
    const content = await mod.fetchUrlContent(entry.url);
    await persistEntry({
      ...entry,
      content,
      title: entry.title && entry.title !== 'New link' ? entry.title : entry.url
    });
  };

  return (
    <div>
      <div className="card">
        <div className="card-title"><h3><Ic.Search /> Knowledge Base</h3></div>
        <div className="field-hint" style={{ marginBottom: 10 }}>
          Add documents, links, or text that actors can reference during discussions.
        </div>
        {kb.map((entry, i) => (
          <div className="kb-entry" key={entry.id || i}>
            <div className="card-title">
              <h3 style={{ fontSize: 'var(--fs-sm)' }}>{entry.title || 'Untitled'}</h3>
              <Toggle checked={entry.enabled !== false} onChange={(v) => updateEntry(entry, { enabled: v })} />
            </div>
            <div className="card-row"><span className="lbl">Type</span><span className="val">{entry.type || 'text'}</span></div>
            <Field label="Title">
              <input value={entry.title || ''} onChange={(e) => updateEntry(entry, { title: e.target.value })} />
            </Field>
            {entry.type === 'link' && (
              <Field label="URL">
                <input value={entry.url || ''} onChange={(e) => updateEntry(entry, { url: e.target.value })} />
              </Field>
            )}
            <Field label="Content" hint={`${entry.wordCount || 0} words`}>
              <textarea rows={5} value={entry.content || ''} onChange={(e) => updateEntry(entry, { content: e.target.value })} />
            </Field>
            <div className="btn-row">
              {entry.type === 'link' ? <button className="btn sm" onClick={() => fetchLink(entry)}>Fetch</button> : null}
              <button className="btn ghost sm" style={{ color: "var(--danger)" }} onClick={() => deleteEntry(entry.id)}>
                <Ic.Trash width={12} height={12} /> Delete
              </button>
            </div>
          </div>
        ))}
        {!kb.length && <div className="empty">No knowledge base entries. Add documents or links to ground actor responses.</div>}
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => addEntry('document')}><Ic.Plus width={12} height={12} /> Add document</button>
          <button className="btn" onClick={() => addEntry('link')}><Ic.Globe width={12} height={12} /> Add link</button>
        </div>
      </div>
    </div>
  );
}
