import React, { useEffect, useState, useCallback } from 'react';
import { Toggle } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';
import * as Ic from '../Icons';

const FILTERS = ['all', 'writable', 'reference', 'pending'];
const FILTER_LABELS = { all: 'All', writable: 'Writable', reference: 'Reference', pending: 'Pending' };

function DocRow({ entry, actors, writerActors, designatedWriterId, pendingCount, onUpdate, onDelete }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  const wordCount = entry.wordCount || 0;
  const versionCount = entry.versions?.length || 0;

  return (
    <div className={`doc-row ${settingsOpen ? 'open' : ''}`}>
      <div className="doc-row-main">
        <button
          className="doc-row-chevron"
          onClick={() => setSettingsOpen(v => !v)}
          title={settingsOpen ? 'Hide settings' : 'Show settings'}
        >
          <Ic.ChevronDown width={12} height={12} style={{ transform: settingsOpen ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform .15s' }} />
        </button>

        <span className={`doc-type-badge ${entry.type === 'link' ? 'link' : ''}`}>
          {entry.type === 'link' ? '🔗' : '📄'}
        </span>

        <input
          className="doc-row-title"
          value={entry.title || ''}
          placeholder="Untitled"
          onChange={(e) => update({ title: e.target.value })}
          onClick={(e) => e.stopPropagation()}
        />

        <span className="doc-row-meta">
          {wordCount > 0 && <span className="doc-row-words">{wordCount}w</span>}
          {versionCount > 0 && <span className="doc-row-versions">v{versionCount}</span>}
          {entry.aiEditable && <span className="doc-ai-badge">W</span>}
          {pendingCount > 0 && <span className="doc-pending-dot">·{pendingCount}</span>}
        </span>

        <button
          className="mini-icon-btn"
          onClick={() => mutateState(s => { s.ui.focusedDocId = entry.id; })}
          title="Open in editor"
        >
          <Ic.Expand width={13} height={13} />
        </button>

        <Toggle
          checked={entry.enabled !== false}
          onChange={(v) => update({ enabled: v })}
          title="Include in AI-readable context"
        />
      </div>

      {settingsOpen && (
        <div className="doc-row-settings">
          <div className="doc-row-setting">
            <label>Writable by Writer</label>
            <Toggle checked={!!entry.aiEditable} onChange={(v) => update({ aiEditable: v })} />
          </div>

          {entry.aiEditable && (
            <div className="doc-row-setting">
              <label>Document writer</label>
              <select
                value={entry.writerId || ''}
                onChange={(e) => update({ writerId: e.target.value })}
              >
                <option value="">Session writer</option>
                {writerActors.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name}{a.id === designatedWriterId ? ' (session)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="doc-row-setting vertical">
            <label>Purpose</label>
            <textarea
              rows={2}
              value={entry.purpose || ''}
              onChange={(e) => update({ purpose: e.target.value })}
              placeholder="What this document is for"
            />
          </div>

          <div className="doc-row-setting vertical">
            <label>Format</label>
            <textarea
              rows={2}
              value={entry.format || ''}
              onChange={(e) => update({ format: e.target.value })}
              placeholder="Desired structure, tone, or sections"
            />
          </div>

          {entry.type === 'link' && (
            <div className="doc-row-setting">
              <label>URL</label>
              <input
                value={entry.url || ''}
                onChange={(e) => update({ url: e.target.value })}
                placeholder="https://…"
                style={{ flex: 1 }}
              />
              <button className="btn sm" onClick={fetchLink} disabled={fetchingId || !entry.url}>
                {fetchingId ? '…' : 'Fetch'}
              </button>
            </div>
          )}

          {fetchError && <div className="field-hint hint-warn">⚠ {fetchError}</div>}

          <div className="doc-row-actions">
            <button
              className="btn ghost sm"
              style={{ color: 'var(--danger)' }}
              onClick={() => onDelete(entry.id)}
            >
              <Ic.Trash width={12} height={12} /> Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DocumentsPanel() {
  const documents = useForumState(s => s.documents || []);
  const actors = useForumState(s => s.actors || []);
  const designatedWriterId = useForumState(s => s.documentWriting?.designatedWriterId || '');
  const scribeMode = useForumState(s => s.documentWriting?.scribeMode || 'auto_apply');
  const pendingDocumentEdits = useForumState(s => s.pendingDocumentEdits || []);
  const writerActors = actors.filter(a => a.enabled && a.canWriteDocuments);

  const [filter, setFilter] = useState('all');
  const [newDocWritable, setNewDocWritable] = useState(true);

  const pendingByDoc = {};
  for (const e of pendingDocumentEdits) {
    if (['pending', 'conflicted'].includes(e.status)) {
      pendingByDoc[e.documentId] = (pendingByDoc[e.documentId] || 0) + 1;
    }
  }
  const totalPending = Object.values(pendingByDoc).reduce((s, n) => s + n, 0);

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

  const addEntry = async (type) => {
    const mod = await import('../../modules/knowledge.js');
    const entry = mod.newDocument({
      type,
      title: type === 'link' ? 'New link' : newDocWritable ? 'New working document' : 'New reference document',
      aiEditable: newDocWritable,
    });
    await persistEntry(entry, {});
  };

  const deleteEntry = async (id) => {
    const mod = await import('../../modules/knowledge.js');
    await mod.deleteKbEntry(id);
    mutateState(s => { s.documents = (s.documents || []).filter(e => e.id !== id); });
  };

  const setDesignatedWriter = useCallback((id) => {
    mutateState(s => {
      if (!s.documentWriting) s.documentWriting = {};
      s.documentWriting.designatedWriterId = id;
      const writer = (s.actors || []).find(a => a.id === id);
      if (writer) writer.canWriteDocuments = true;
    });
  }, []);

  const setScribeMode = useCallback((mode) => {
    mutateState(s => {
      if (!s.documentWriting) s.documentWriting = {};
      s.documentWriting.scribeMode = mode;
    });
  }, []);

  const createWriter = useCallback(async () => {
    const mod = await import('../../modules/documentWriting.js');
    const writer = mod.ensureWriterForDocuments();
    mutateState(s => {
      if (!s.documentWriting) s.documentWriting = {};
      s.documentWriting.designatedWriterId = writer.id;
    });
  }, []);

  const filteredDocs = documents.filter(d => {
    if (filter === 'writable') return d.aiEditable;
    if (filter === 'reference') return !d.aiEditable;
    if (filter === 'pending') return (pendingByDoc[d.id] || 0) > 0;
    return true;
  });

  const emptyMsg = {
    pending: 'No pending proposals.',
    writable: 'No writable documents yet.',
    reference: 'No reference documents yet.',
    all: 'No documents yet.',
  }[filter];

  return (
    <div>
      {/* Writer + Scribe configuration */}
      <div className="card">
        <div className="card-title">
          <h3><Ic.Robot /> Document Writer</h3>
          {totalPending > 0 && <span className="doc-pending-header-badge">⚠ {totalPending} pending</span>}
        </div>
        <div className="doc-row-setting">
          <label>Writer</label>
          <select value={designatedWriterId} onChange={(e) => setDesignatedWriter(e.target.value)}>
            <option value="">No active writer</option>
            {writerActors.map(a => <option key={a.id} value={a.id}>{a.name} — {a.role}</option>)}
          </select>
          <button className="btn sm" onClick={createWriter}><Ic.Plus width={11} height={11} /> New</button>
        </div>
        <div className="doc-row-setting">
          <label>Scribe mode</label>
          <select value={scribeMode} onChange={(e) => setScribeMode(e.target.value)}>
            <option value="auto_apply">Auto · apply directly</option>
            <option value="auto_review">Auto · review-first</option>
            <option value="ask">Ask before drafting</option>
            <option value="manual">Manual only</option>
          </select>
        </div>
        <div className="field-hint">
          Only the designated writer receives document-writing tasks.
        </div>
      </div>

      {/* Unified document list */}
      <div className="card">
        <div className="card-title">
          <h3><Ic.Doc /> Documents</h3>
          <span className="doc-count-badge">{documents.length}</span>
        </div>

        <div className="doc-filter-chips">
          {FILTERS.map(f => (
            <button
              key={f}
              className={`doc-filter-chip ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {FILTER_LABELS[f]}
              {f === 'pending' && totalPending > 0 && <span className="doc-chip-count">{totalPending}</span>}
            </button>
          ))}
        </div>

        <div className="doc-file-list">
          {filteredDocs.map(entry => (
            <DocRow
              key={entry.id}
              entry={entry}
              actors={actors}
              writerActors={writerActors}
              designatedWriterId={designatedWriterId}
              pendingCount={pendingByDoc[entry.id] || 0}
              onUpdate={persistEntry}
              onDelete={deleteEntry}
            />
          ))}
          {!filteredDocs.length && <div className="empty">{emptyMsg}</div>}
        </div>

        <div className="btn-row doc-add-row">
          <label className="doc-writable-toggle" title="New documents will be writable by the AI writer">
            <Toggle checked={newDocWritable} onChange={setNewDocWritable} />
            <span>Writable</span>
          </label>
          <button className="btn sm" onClick={() => addEntry('document')}><Ic.Plus width={11} height={11} /> Document</button>
          <button className="btn sm" onClick={() => addEntry('link')}><Ic.Globe width={11} height={11} /> Link</button>
        </div>
      </div>
    </div>
  );
}
