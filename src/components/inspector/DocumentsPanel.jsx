import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Toggle } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';
import { showToast } from '../../modules/uiStore.js';
import { renderMarkdown } from '../../modules/markdown.js';
import * as Ic from '../Icons';

const SCRIBE_MODE_LABELS = {
  auto_apply: 'Auto · apply directly',
  auto_review: 'Auto · review-first',
  ask: 'Ask before drafting',
  manual: 'Manual only',
};

const FILTERS = ['all', 'writable', 'reference', 'pending'];
const FILTER_LABELS = { all: 'All', writable: 'Writable', reference: 'Reference', pending: 'Pending' };

function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
  return `${Math.floor(ms / 86400000)}d ago`;
}

const TASK_STATUS_ICON = {
  pending:   <span className="task-dot pending">○</span>,
  running:   <span className="task-dot running"><Ic.Round width={10} height={10} /></span>,
  proposed:  <span className="task-dot proposed">✓</span>,
  failed:    <span className="task-dot failed">✗</span>,
  cancelled: <span className="task-dot cancelled">—</span>,
};

function TaskRow({ task, documents, actors }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const doc = documents.find(d => d.id === task.documentId);
  const actor = actors.find(a => a.id === task.actorId);
  const isActive = task.status === 'pending' || task.status === 'running';

  const cancel = async () => {
    const mod = await import('../../modules/documentWriting.js');
    mod.cancelDocumentTask(task.id);
  };

  const dismiss = async () => {
    const mod = await import('../../modules/documentWriting.js');
    mod.dismissDocumentTask(task.id);
  };

  const retry = async () => {
    setBusy(true);
    setErr('');
    try {
      const mod = await import('../../modules/documentWriting.js');
      await mod.retryDocumentTask(task.id);
    } catch (e) {
      setErr(e?.message || 'Retry failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`task-row task-row-${task.status}`}>
      <div className="task-row-main">
        {TASK_STATUS_ICON[task.status] ?? TASK_STATUS_ICON.pending}
        <div className="task-row-body">
          <span className="task-instruction" title={task.instruction}>
            {(task.instruction || '').length > 52
              ? (task.instruction || '').slice(0, 52) + '…'
              : task.instruction}
          </span>
          {doc && <><span className="task-arrow">›</span><span className="task-doc">{doc.title || 'Untitled'}</span></>}
        </div>
        <div className="task-row-btns">
          {task.status === 'pending' && (
            <button className="mini-icon-btn" onClick={cancel} title="Cancel task">
              <Ic.Close width={10} height={10} />
            </button>
          )}
          {task.status === 'failed' && (
            <button className="btn sm" onClick={retry} disabled={busy}>
              {busy ? '…' : 'Retry'}
            </button>
          )}
          {!isActive && (
            <button className="mini-icon-btn" onClick={dismiss} title="Dismiss">
              <Ic.Close width={10} height={10} />
            </button>
          )}
        </div>
      </div>
      <div className="task-row-meta">
        {actor && <span>{actor.name}</span>}
        <span>{timeAgo(task.updatedAt)}</span>
        {task.status === 'failed' && task.error && (
          <span className="task-error" title={task.error}>
            {task.error.length > 60 ? task.error.slice(0, 60) + '…' : task.error}
          </span>
        )}
        {err && <span className="task-error">{err}</span>}
      </div>
    </div>
  );
}

function WriterQueue({ documents, actors }) {
  const tasks = useForumState(s => s.documentTasks || []);
  if (!tasks.length) return null;

  const sorted = [...tasks].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const active = sorted.filter(t => t.status === 'pending' || t.status === 'running');
  const recent = sorted.filter(t => t.status !== 'pending' && t.status !== 'running').slice(0, 5);

  const clearCompleted = () => {
    mutateState(s => {
      s.documentTasks = (s.documentTasks || []).filter(t => t.status === 'pending' || t.status === 'running');
    });
  };

  const hasCompleted = recent.length > 0;

  return (
    <div className="card">
      <div className="card-title">
        <h3><Ic.Robot /> Writer Queue</h3>
        {active.length > 0 && <span className="task-active-badge">{active.length} active</span>}
        {hasCompleted && (
          <button className="btn sm ghost" onClick={clearCompleted} style={{ marginLeft: 'auto' }}>
            Clear
          </button>
        )}
      </div>
      <div className="task-list">
        {active.map(t => (
          <TaskRow key={t.id} task={t} documents={documents} actors={actors} />
        ))}
        {active.length > 0 && recent.length > 0 && <div className="task-divider" />}
        {recent.map(t => (
          <TaskRow key={t.id} task={t} documents={documents} actors={actors} />
        ))}
      </div>
    </div>
  );
}

function DocRow({
  entry, actors: _actors, writerActors, designatedWriterId, pendingCount,
  bulkMode, isSelected, onToggleSelect,
  isDragOver, isDragging, onDragStart, onDragOver, onDragLeave, onDrop,
  onUpdate, onDelete,
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
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
        title: entry.title && entry.title !== 'New link' ? entry.title : entry.url,
      });
    } catch (err) {
      setFetchError(err?.message || 'Fetch failed');
    } finally {
      setFetchingId(false);
    }
  };

  const wordCount = entry.wordCount || 0;
  const versionCount = entry.versions?.length || 0;
  const hasContent = !!(entry.content || '').trim();

  return (
    <div
      className={[
        'doc-row',
        settingsOpen ? 'open' : '',
        isDragging ? 'dragging' : '',
        isDragOver ? 'drag-over' : '',
      ].filter(Boolean).join(' ')}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(entry.id); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver(entry.id); }}
      onDragLeave={onDragLeave}
      onDrop={(e) => { e.preventDefault(); onDrop(entry.id); }}
    >
      <div className="doc-row-main">
        <span className="doc-grip" title="Drag to reorder">
          <Ic.GripVertical width={8} height={14} />
        </span>

        {bulkMode && (
          <input
            type="checkbox"
            className="doc-row-check"
            checked={isSelected}
            onChange={() => onToggleSelect(entry.id)}
            onClick={(e) => e.stopPropagation()}
          />
        )}

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

        {hasContent && (
          <button
            className={`mini-icon-btn ${previewOpen ? 'active' : ''}`}
            onClick={() => setPreviewOpen(v => !v)}
            title={previewOpen ? 'Hide preview' : 'Preview content'}
          >
            <Ic.Eye width={13} height={13} />
          </button>
        )}

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

      {/* Inline content preview */}
      {previewOpen && hasContent && (
        <div className="doc-row-preview">
          <div
            className="md-body doc-row-preview-body"
            dangerouslySetInnerHTML={{ __html: renderMarkdown((entry.content || '').slice(0, 800)) }}
          />
          {(entry.content || '').length > 800 && (
            <div className="doc-row-preview-more">
              <button className="btn sm ghost" onClick={() => mutateState(s => { s.ui.focusedDocId = entry.id; })}>
                Open full document…
              </button>
            </div>
          )}
        </div>
      )}

      {/* Settings (expanded) */}
      {settingsOpen && (
        <div className="doc-row-settings">
          <div className="doc-row-setting">
            <label title="When enabled, the designated Writer actor can propose edits to this document during the session.">Writable by Writer</label>
            <Toggle checked={!!entry.aiEditable} onChange={(v) => update({ aiEditable: v })} />
          </div>

          {entry.aiEditable && (
            <div className="doc-row-setting">
              <label title="Override which actor handles write tasks for this specific document. Defaults to the session writer.">Document writer</label>
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
            <label title="Describes what this document is for — injected as context when the writer works on it.">Purpose</label>
            <textarea
              rows={2}
              value={entry.purpose || ''}
              onChange={(e) => update({ purpose: e.target.value })}
              placeholder="What this document is for"
            />
          </div>

          <div className="doc-row-setting vertical">
            <label title="Desired output structure, tone, or section headings — the writer uses this as a style guide.">Format</label>
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
  const scribeMode = useForumState(s => s.documentWriting?.scribeMode || 'manual');
  const scribeModeUserSet = useForumState(s => s.documentWriting?.scribeModeUserSet || false);
  const deliverableIntent = useForumState(s => !!(String(s.scenario?.task || '').trim() || String(s.scenario?.doneWhen || '').trim()));
  const pendingDocumentEdits = useForumState(s => s.pendingDocumentEdits || []);
  const writerActors = actors.filter(a => a.enabled && a.canWriteDocuments);
  const [producing, setProducing] = useState(false);

  // Mirror resolveEffectiveScribeMode(): an explicit user choice wins; otherwise
  // a deliverable scenario auto-arms review-first, a blueprint-set non-manual
  // mode is honored, and a bare default stays manual.
  const effectiveScribeMode = scribeModeUserSet
    ? scribeMode
    : (scribeMode !== 'manual' ? scribeMode : (deliverableIntent ? 'auto_review' : 'manual'));
  const scribeAutoArmed = effectiveScribeMode !== scribeMode;
  const activeWriter = actors.find(a => a.id === designatedWriterId && a.enabled && a.canWriteDocuments)
    || writerActors[0] || null;

  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [newDocWritable, setNewDocWritable] = useState(true);
  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [dragOverId, setDragOverId] = useState(null);
  const dragSrcRef = useRef(null);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

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
      s.documentWriting.scribeModeUserSet = true;
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

  // Force a deliverable on demand: self-heals a writer + document, drafts, and
  // applies, then opens the result in the editor. Always available — this is the
  // "write this up" escape hatch that must never fail for lack of a writer/doc.
  const produceDeliverable = useCallback(async () => {
    setProducing(true);
    try {
      const mod = await import('../../modules/documentWriting.js');
      const result = await mod.produceDeliverable();
      const docId = result?.documentId;
      if (docId) {
        mutateState(s => { if (!s.ui) s.ui = {}; s.ui.focusedDocId = docId; });
      } else {
        showToast('The writer had nothing to record yet — add some discussion first.', 'warn');
      }
    } catch (err) {
      showToast(`Could not produce a deliverable: ${err?.message || err}`, 'error');
    } finally {
      setProducing(false);
    }
  }, []);

  // ── Drag reorder ────────────────────────────────────────────────────────
  const handleDragStart = useCallback((id) => { dragSrcRef.current = id; }, []);
  const handleDragOver = useCallback((id) => { setDragOverId(id); }, []);
  const handleDragLeave = useCallback(() => { setDragOverId(null); }, []);

  const handleDrop = useCallback(async (targetId) => {
    const srcId = dragSrcRef.current;
    dragSrcRef.current = null;
    setDragOverId(null);
    if (!srcId || srcId === targetId) return;

    let updated = [];
    mutateState(s => {
      const docs = s.documents || [];
      const srcIdx = docs.findIndex(d => d.id === srcId);
      const tgtIdx = docs.findIndex(d => d.id === targetId);
      if (srcIdx < 0 || tgtIdx < 0) return;
      const [item] = docs.splice(srcIdx, 1);
      docs.splice(tgtIdx, 0, item);
      docs.forEach((d, i) => { d.sortOrder = i; });
      updated = docs.map(d => ({ ...d }));
    });

    const mod = await import('../../modules/knowledge.js');
    for (const d of updated) await mod.putKbEntry(d);
  }, []);

  // ── Bulk select ─────────────────────────────────────────────────────────
  const toggleSelect = useCallback((id) => {
    setSelected(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(documents.map(d => d.id)));
  }, [documents]);

  const clearSel = useCallback(() => setSelected(new Set()), []);

  const bulkSetEnabled = useCallback(async (val) => {
    for (const id of selected) {
      const doc = documents.find(d => d.id === id);
      if (doc) await persistEntry(doc, { enabled: val });
    }
  }, [selected, documents, persistEntry]);

  const bulkDelete = useCallback(async () => {
    if (!window.confirm(`Delete ${selected.size} document${selected.size !== 1 ? 's' : ''}?`)) return;
    const mod = await import('../../modules/knowledge.js');
    for (const id of selected) await mod.deleteKbEntry(id);
    mutateState(s => { s.documents = (s.documents || []).filter(d => !selected.has(d.id)); });
    setSelected(new Set());
  }, [selected]);

  const exitBulk = () => { setBulkMode(false); setSelected(new Set()); };

  // ── Import ───────────────────────────────────────────────────────────────
  const importFiles = useCallback(async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const mod = await import('../../modules/knowledge.js');
    const textFileRegex = /\.(txt|md|markdown|js|jsx|ts|tsx|json|css|html|yaml|yml|sh|py|go|rs|c|cpp|h)$/i;
    for (const file of files) {
      if (!textFileRegex.test(file.name)) {
        continue;
      }
      try {
        const text = await file.text();
        const title = file.webkitRelativePath
          ? file.webkitRelativePath.replace(/\.(txt|md|markdown|js|jsx|ts|tsx|json|css|html|yaml|yml|sh|py|go|rs|c|cpp|h)$/i, '')
          : file.name.replace(/\.(txt|md|markdown|js|jsx|ts|tsx|json|css|html|yaml|yml|sh|py|go|rs|c|cpp|h)$/i, '');
        const entry = mod.newDocument({ title, content: text, aiEditable: newDocWritable });
        await persistEntry(entry, {});
      } catch (err) {
        console.warn('[import] Failed to read file:', file.name, err);
      }
    }
    e.target.value = '';
  }, [newDocWritable, persistEntry]);

  const importClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return;
      const mod = await import('../../modules/knowledge.js');
      const firstLine = text.split('\n').find(l => l.trim())?.replace(/^#+\s*/, '').trim().slice(0, 60) || 'Pasted document';
      const entry = mod.newDocument({ title: firstLine, content: text, aiEditable: newDocWritable });
      await persistEntry(entry, {});
    } catch {
      // clipboard access denied — silently ignore
    }
  }, [newDocWritable, persistEntry]);

  // ── Filtering ────────────────────────────────────────────────────────────
  const filteredDocs = documents.filter(d => {
    if (filter === 'writable') { if (!d.aiEditable) return false; }
    else if (filter === 'reference') { if (d.aiEditable) return false; }
    else if (filter === 'pending') { if (!(pendingByDoc[d.id] > 0)) return false; }
    if (search) {
      const q = search.toLowerCase();
      if (!(d.title || '').toLowerCase().includes(q) && !(d.content || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const emptyMsg = search
    ? 'No documents match your search.'
    : { pending: 'No pending proposals.', writable: 'No writable documents yet.', reference: 'No reference documents yet.', all: 'No documents yet.' }[filter];

  return (
    <div>
      {/* Writer + Scribe configuration */}
      <div className="card">
        <div className="card-title">
          <h3><Ic.Robot /> Document Writer</h3>
          {totalPending > 0 && <span className="doc-pending-header-badge">⚠ {totalPending} pending</span>}
        </div>
        <div className="doc-row-setting">
          <label title="The actor responsible for executing document-writing tasks. Must have the Write Documents ability enabled.">Writer</label>
          <select value={designatedWriterId} onChange={(e) => setDesignatedWriter(e.target.value)}>
            <option value="">No active writer</option>
            {writerActors.map(a => <option key={a.id} value={a.id}>{a.name} — {a.role}</option>)}
          </select>
          <button className="btn sm" onClick={createWriter}><Ic.Plus width={11} height={11} /> New</button>
        </div>
        <div className="doc-row-setting">
          <label title="Controls how the writer handles document edits. Auto-apply makes changes immediately; Auto-review queues them for your approval; Ask always checks with you first; Manual disables autonomous writing.">Scribe mode</label>
          <select value={scribeMode} onChange={(e) => setScribeMode(e.target.value)}>
            <option value="auto_apply">Auto · apply directly</option>
            <option value="auto_review">Auto · review-first</option>
            <option value="ask">Ask before drafting</option>
            <option value="manual">Manual only</option>
          </select>
        </div>
        {scribeAutoArmed && (
          <p className="doc-scribe-note" title="This goal session has a task or completion criteria, so the scribe is armed automatically until you pick a mode yourself.">
            Auto-armed for this goal session: running as <strong>{SCRIBE_MODE_LABELS[effectiveScribeMode]}</strong>.
          </p>
        )}
        <div className="doc-row-setting">
          <button
            className="btn sm"
            onClick={produceDeliverable}
            disabled={producing}
            title="Have the writer synthesize the discussion into the deliverable document now, then open it. Creates a writer and document if none exist."
          >
            {producing
              ? <><Ic.Round width={11} height={11} /> Writing…</>
              : <><Ic.Doc width={11} height={11} /> Produce deliverable</>}
          </button>
          {activeWriter && (
            <span className="doc-scribe-writer-hint">{activeWriter.name} will write it.</span>
          )}
        </div>
      </div>

      {/* Writer task queue */}
      <WriterQueue documents={documents} actors={actors} />

      {/* Unified document list */}
      <div className="card">
        <div className="card-title">
          <h3><Ic.Doc /> Documents</h3>
          <span className="doc-count-badge">{documents.length}</span>
          <button
            className={`btn sm ghost doc-bulk-toggle ${bulkMode ? 'active' : ''}`}
            onClick={() => bulkMode ? exitBulk() : setBulkMode(true)}
            title="Select multiple"
          >
            {bulkMode ? 'Done' : 'Select'}
          </button>
        </div>

        {/* Search */}
        <div className="doc-search-wrap">
          <Ic.Search width={13} height={13} />
          <input
            className="doc-search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents…"
          />
          {search && (
            <button className="doc-search-clear" onClick={() => setSearch('')} title="Clear">×</button>
          )}
        </div>

        {/* Filter chips */}
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

        {/* Bulk actions bar */}
        {bulkMode && selected.size > 0 && (
          <div className="doc-bulk-bar">
            <span className="doc-bulk-count">{selected.size} selected</span>
            <button className="btn sm ghost" onClick={() => bulkSetEnabled(true)}>Enable</button>
            <button className="btn sm ghost" onClick={() => bulkSetEnabled(false)}>Disable</button>
            <button className="btn sm ghost" style={{ color: 'var(--danger)' }} onClick={bulkDelete}>Delete</button>
            <button className="btn sm ghost" onClick={selectAll}>All</button>
            <button className="btn sm ghost" onClick={clearSel}>None</button>
          </div>
        )}

        <div className="doc-file-list">
          {filteredDocs.map(entry => (
            <DocRow
              key={entry.id}
              entry={entry}
              actors={actors}
              writerActors={writerActors}
              designatedWriterId={designatedWriterId}
              pendingCount={pendingByDoc[entry.id] || 0}
              bulkMode={bulkMode}
              isSelected={selected.has(entry.id)}
              onToggleSelect={toggleSelect}
              isDragging={dragSrcRef.current === entry.id}
              isDragOver={dragOverId === entry.id}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
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
          <button className="btn sm ghost" onClick={() => fileInputRef.current?.click()} title="Import from file">
            <Ic.Upload width={11} height={11} /> Import
          </button>
          <button className="btn sm ghost" onClick={() => folderInputRef.current?.click()} title="Import an entire folder">
            <Ic.Upload width={11} height={11} /> Folder
          </button>
          <button className="btn sm ghost" onClick={importClipboard} title="Paste from clipboard">
            Paste
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.markdown"
            multiple
            style={{ display: 'none' }}
            onChange={importFiles}
          />
          <input
            ref={folderInputRef}
            type="file"
            webkitdirectory=""
            directory=""
            multiple
            style={{ display: 'none' }}
            onChange={importFiles}
          />
        </div>
      </div>
    </div>
  );
}
