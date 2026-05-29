import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Field, Toggle } from '../shared/FormControls';
import { useForumState, mutateState, saveState } from '../../hooks/useForumState';
import * as Ic from '../Icons';

/* ────────────────────────────────────────────────────────
   DocRow — compact file-browser-style row per document.
   Collapsed: icon · title · word-count · type badge · open · toggle
   Expanded:  settings (AI-editable, visibility, URL) + delete
   ──────────────────────────────────────────────────────── */
function DocRow({ entry, actors, onUpdate, onDelete }) {
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
      {/* ── Main row ─────────────────────────────────────── */}
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
          {entry.aiEditable && <span className="doc-ai-badge">AI</span>}
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
        />
      </div>

      {/* ── Settings (expanded) ──────────────────────────── */}
      {settingsOpen && (
        <div className="doc-row-settings">
          <div className="doc-row-setting">
            <label>AI can edit</label>
            <Toggle checked={!!entry.aiEditable} onChange={(v) => update({ aiEditable: v })} />
          </div>

          <div className="doc-row-setting">
            <label>Visible to</label>
            <select
              value={entry.target === 'all' ? 'all' : 'specific'}
              onChange={(e) => update({ target: e.target.value === 'all' ? 'all' : [] })}
            >
              <option value="all">All actors</option>
              <option value="specific">Selected actors…</option>
            </select>
          </div>

          {Array.isArray(entry.target) && (
            <div className="doc-row-actors">
              {actors.filter(a => a.enabled).map(a => (
                <label key={a.id}>
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
              className="btn sm"
              onClick={() => mutateState(s => { s.ui.focusedDocId = entry.id; })}
            >
              <Ic.Expand width={12} height={12} /> Open editor
            </button>
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

function ImportPrPanel({ onImported }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const importPr = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const cr = await import('../../modules/codeReview.js');
      const prData = await cr.importGithubPr(url.trim(), token.trim());
      const docs = cr.buildCodeReviewDocuments(prData);
      const setup = cr.buildCodeReviewSetup(prData);
      const mod = await import('../../modules/knowledge.js');
      for (const doc of docs) await mod.putKbEntry(doc);
      mutateState(s => {
        if (!s.documents) s.documents = [];
        s.documents = [...s.documents, ...docs];
        Object.assign(s.scenario, setup.scenario);
        // Prepend review actors only if no director exists yet
        if (!s.actors.some(a => a.canDirect && a.enabled)) {
          s.actors = [...setup.actors, ...s.actors];
        }
      });
      setUrl('');
      setToken('');
      setOpen(false);
      onImported?.();
    } catch (err) {
      setError(err?.message || 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  const importFolder = async (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      const cr = await import('../../modules/codeReview.js');
      const docs = await cr.importLocalFiles(Array.from(files));
      if (!docs.length) { setError('No supported text files found in the selected folder.'); return; }
      const mod = await import('../../modules/knowledge.js');
      for (const doc of docs) await mod.putKbEntry(doc);
      mutateState(s => {
        if (!s.documents) s.documents = [];
        s.documents = [...s.documents, ...docs];
      });
      onImported?.();
    } catch (err) {
      setError(err?.message || 'Folder import failed');
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="card">
      <div className="card-title">
        <h3><Ic.Search /> Import Code</h3>
        <button className="btn sm ghost" onClick={() => { setOpen(v => !v); setError(null); }}>
          {open ? 'Cancel' : 'GitHub PR'}
        </button>
        <button className="btn sm ghost" onClick={() => fileInputRef.current?.click()} disabled={busy} title="Import a local folder">
          {busy ? 'Importing…' : 'Local folder'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          webkitdirectory="true"
          multiple
          onChange={importFolder}
        />
      </div>

      {open && (
        <div className="import-pr-form">
          <Field label="GitHub PR URL">
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo/pull/123"
              onKeyDown={e => e.key === 'Enter' && importPr()}
              disabled={busy}
            />
          </Field>
          <Field label="Token (optional)" hint="For private repos. Never stored.">
            <input
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="ghp_…"
              disabled={busy}
            />
          </Field>
          {error && <div className="field-hint hint-warn" style={{ marginBottom: 6 }}>⚠ {error}</div>}
          <div className="btn-row">
            <button className="btn primary sm" onClick={importPr} disabled={busy || !url.trim()}>
              {busy ? 'Fetching PR…' : 'Import PR'}
            </button>
          </div>
          <div className="field-hint" style={{ marginTop: 6 }}>
            Creates a "PR Overview" working document + diff reference. Sets up a review panel with Security, Architecture, and Test Coverage reviewers.
          </div>
        </div>
      )}
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
      <ImportPrPanel />

      {/* Working Documents */}
      <div className="card">
        <div className="card-title">
          <h3><Ic.Doc /> Working Documents</h3>
          <span className="doc-count-badge">{workingDocs.length}</span>
        </div>
        <div className="doc-file-list">
          {workingDocs.map(entry => (
            <DocRow
              key={entry.id}
              entry={entry}
              actors={actors}
              onUpdate={persistEntry}
              onDelete={deleteEntry}
            />
          ))}
          {!workingDocs.length && <div className="empty">No working documents yet.</div>}
        </div>
        <div className="btn-row" style={{ marginTop: 8, padding: '0 0 4px' }}>
          <button className="btn sm" onClick={() => addEntry('document', true)}><Ic.Plus width={11} height={11} /> Document</button>
          <button className="btn sm" onClick={() => addEntry('link', true)}><Ic.Globe width={11} height={11} /> Link</button>
        </div>
      </div>

      {/* Reference Documents */}
      <div className="card">
        <div className="card-title">
          <h3><Ic.Search /> Reference Documents</h3>
          <span className="doc-count-badge">{refDocs.length}</span>
        </div>
        <div className="doc-file-list">
          {refDocs.map(entry => (
            <DocRow
              key={entry.id}
              entry={entry}
              actors={actors}
              onUpdate={persistEntry}
              onDelete={deleteEntry}
            />
          ))}
          {!refDocs.length && <div className="empty">No reference documents.</div>}
        </div>
        <div className="btn-row" style={{ marginTop: 8, padding: '0 0 4px' }}>
          <button className="btn sm" onClick={() => addEntry('document', false)}><Ic.Plus width={11} height={11} /> Document</button>
          <button className="btn sm" onClick={() => addEntry('link', false)}><Ic.Globe width={11} height={11} /> Link</button>
        </div>
      </div>
    </div>
  );
}
