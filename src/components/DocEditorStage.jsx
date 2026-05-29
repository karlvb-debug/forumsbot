import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useForumState, mutateState, saveState } from '../hooks/useForumState';
import { renderMarkdown } from '../modules/markdown.js';
import { Toggle } from './shared/FormControls';
import * as Ic from './Icons';

/**
 * Full-width document editor that takes over the stage area.
 * Shows a split: [document editor 65%] | [transcript 35%]
 */
export function DocEditorStage({ transcript, composer }) {
  const focusedDocId = useForumState(s => s.ui.focusedDocId);
  const documents = useForumState(s => s.documents || []);
  const actors = useForumState(s => s.actors || []);
  const doc = documents.find(d => d.id === focusedDocId);

  const [view, setView] = useState('edit');
  const [historyIdx, setHistoryIdx] = useState(null);
  const editorRef = useRef(null);

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const el = editorRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  }, []);

  useEffect(() => { autoResize(); }, [doc?.content, view, autoResize]);

  const close = useCallback(() => {
    mutateState(s => { s.ui.focusedDocId = null; });
  }, []);

  const updateDoc = useCallback(async (patch) => {
    const mod = await import('../modules/knowledge.js');
    const entry = documents.find(d => d.id === focusedDocId);
    if (!entry) return;
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
  }, [focusedDocId, documents]);

  const restoreVersion = useCallback((version) => {
    if (!version?.content) return;
    updateDoc({ content: version.content });
    setView('edit');
    setHistoryIdx(null);
  }, [updateDoc]);

  if (!doc) {
    // Doc was deleted while we had it open
    close();
    return null;
  }

  const enabledActors = actors.filter(a => a.enabled);
  const attrLines = doc.lineAttribution || [];
  const versions = doc.versions || [];
  const wordCount = doc.wordCount || 0;

  return (
    <div className="doc-editor-stage">
      {/* ── Left: Document Editor ─────────────────────────────── */}
      <div className="doc-editor-pane">
        <div className="doc-editor-toolbar">
          <div className="doc-editor-title-area">
            <input
              className="doc-editor-title"
              value={doc.title || ''}
              placeholder="Document title…"
              onChange={(e) => updateDoc({ title: e.target.value })}
            />
            <div className="doc-editor-meta">
              <span className={`doc-type-badge ${doc.type === 'link' ? 'link' : ''}`}>
                {doc.type || 'doc'}
              </span>
              {doc.aiEditable && <span className="doc-ai-badge">AI editable</span>}
              <span className="doc-word-count">{wordCount} words</span>
            </div>
          </div>
          <div className="doc-editor-actions">
            <label style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-mute)', display: 'flex', alignItems: 'center', gap: 6 }}>
              AI editable
              <Toggle checked={!!doc.aiEditable} onChange={(v) => updateDoc({ aiEditable: v })} />
            </label>
            <button className="btn sm ghost" onClick={close} title="Close editor">
              <Ic.Close width={14} height={14} /> Close
            </button>
          </div>
        </div>

        <div className="doc-editor-tabs">
          <button className={view === 'edit' ? 'active' : ''} onClick={() => setView('edit')}>
            <Ic.Doc width={13} height={13} /> Edit
          </button>
          <button className={view === 'preview' ? 'active' : ''} onClick={() => setView('preview')}>
            <Ic.Eye width={13} height={13} /> Preview
          </button>
          {doc.aiEditable && (
            <button className={view === 'history' ? 'active' : ''} onClick={() => { setView('history'); setHistoryIdx(null); }}>
              <Ic.Clock width={13} height={13} /> History {versions.length ? `(${versions.length})` : ''}
            </button>
          )}
        </div>

        <div className="doc-editor-content">
          {view === 'edit' && (
            <textarea
              ref={editorRef}
              className="doc-editor-textarea"
              value={doc.content || ''}
              onChange={(e) => updateDoc({ content: e.target.value })}
              placeholder="Start writing…"
              spellCheck
            />
          )}

          {view === 'preview' && (
            <div className="doc-editor-preview">
              {doc.content
                ? <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.content) }} />
                : <div className="empty">No content yet. Switch to Edit to start writing.</div>
              }
            </div>
          )}

          {view === 'history' && (
            <div className="doc-editor-history">
              {versions.length === 0 && (
                <div className="empty" style={{ padding: 24 }}>No version history yet. Edits by AI actors will appear here.</div>
              )}
              <div className="history-list">
                {versions.slice().reverse().map((v, i) => {
                  const vIdx = versions.length - 1 - i;
                  const isSelected = historyIdx === vIdx;
                  return (
                    <div key={i} className={`history-item ${isSelected ? 'selected' : ''}`} onClick={() => setHistoryIdx(vIdx)}>
                      <div className="history-item-meta">
                        <strong>v{versions.length - i}</strong>
                        <span>{v.author || 'System'}</span>
                        <span className="history-time">
                          {new Date(v.timestamp || v.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </span>
                      </div>
                      {isSelected && (
                        <div className="history-item-actions">
                          <button className="btn sm" onClick={(e) => { e.stopPropagation(); restoreVersion(v); }}>
                            Restore this version
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {historyIdx !== null && versions[historyIdx] && (
                <div className="history-preview">
                  <div className="history-preview-label">Version {historyIdx + 1} preview</div>
                  <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(versions[historyIdx].content || '') }} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Attribution bars */}
        {doc.aiEditable && enabledActors.length > 0 && attrLines.length > 0 && (
          <div className="doc-editor-attribution">
            {enabledActors.map(a => {
              const pct = Math.round((attrLines.filter(l => l.author === a.name).length / attrLines.length) * 100);
              if (!pct) return null;
              return (
                <div className="influence-row" key={a.id}>
                  <span style={{ minWidth: 60, color: 'var(--fg-dim)', fontSize: 'var(--fs-sm)' }}>{a.name}</span>
                  <div className="influence-bar"><div style={{ width: `${pct}%`, background: a.color }} /></div>
                  <span className="influence-pct">{pct}%</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Right: Transcript + Composer ──────────────────────── */}
      <div className="doc-transcript-pane">
        <div className="doc-transcript-header">
          <Ic.MessageSquare width={14} height={14} />
          <span>Conversation</span>
        </div>
        <div className="doc-transcript-scroll">
          {transcript}
        </div>
        <div className="doc-transcript-composer">
          {composer}
        </div>
      </div>
    </div>
  );
}
