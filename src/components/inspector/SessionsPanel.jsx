import React, { useState, useEffect, useRef } from 'react';
import * as Ic from '../Icons';
import { Field } from '../shared/FormControls';

export function SessionsPanel() {
  const [sessions, setSessions] = useState([]);
  const [exportMode, setExportMode] = useState('debug');
  const presetInputRef = useRef(null);

  const refreshSessions = async () => {
    const db = await import('../../modules/db.js');
    setSessions(await db.getAllSessions() || []);
  };

  useEffect(() => { refreshSessions(); }, []);

  const saveSession = async () => {
    const { saveCurrentSession } = await import('../../modules/session.js');
    await saveCurrentSession();
    await refreshSessions();
  };

  const handleLoadSession = async (session) => {
    const mod = await import('../../modules/session.js');
    await mod.loadSession(session);
  };

  const deleteSession = async (id) => {
    const db = await import('../../modules/db.js');
    await db.deleteSession(id);
    await refreshSessions();
  };

  const handleExport = async () => {
    const { exportSession } = await import('../../modules/session.js');
    await exportSession(exportMode);
  };

  const handlePresetFile = async (event) => {
    const [file] = event.target.files || [];
    if (!file) return;
    const { loadPresetFile } = await import('../../modules/session.js');
    loadPresetFile(file);
    event.target.value = '';
  };

  const resetAllAppState = async () => {
    const session = await import('../../modules/session.js');
    await session.resetSession(true);
    window.location.reload();
  };

  return (
    <div>
      <div className="card">
        <div className="card-title">
          <h3>Sessions</h3>
          <button className="btn sm primary" onClick={saveSession}>
            <Ic.Plus width={12} height={12} /> Save current
          </button>
        </div>
        {sessions.map((s) => {
          const title = s.scenarioTitle || s.title || s.name || 'Untitled';
          const savedAt = s.timestamp || s.savedAt || '';
          const count = s.messageCount ?? s.turnCount ?? 0;
          return (
            <div key={s.id} className="session-row" onClick={() => handleLoadSession(s)}>
              <div style={{ width: 8, height: 8, borderRadius: 99, background: "var(--fg-faint)", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="session-name" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {title}
                </div>
                <div className="session-meta">
                  {savedAt ? new Date(savedAt).toLocaleString() : 'No saved time'} · {count} {count === 1 ? 'message' : 'messages'}
                </div>
              </div>
              <button className="mini-icon-btn" title="Delete" onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}>
                <Ic.Trash width={12} height={12} />
              </button>
            </div>
          );
        })}
        {!sessions.length && <div className="empty">No saved sessions yet.</div>}
      </div>

      <div className="card">
        <div className="card-title"><h3>Export / Import</h3></div>
        <Field label="Export mode" info="Debug includes private actor thoughts and full diagnostics. Shareable strips thoughts and personal data. Markdown is a clean human-readable transcript. Evaluation outputs a structured dataset for fine-tuning or benchmarking.">
          <select value={exportMode} onChange={(e) => setExportMode(e.target.value)}>
            <option value="debug">Debug — full state, private thoughts, traces & metrics</option>
            <option value="shareable">Shareable — redacted privacy mode</option>
            <option value="markdown">Markdown — human-readable transcript</option>
            <option value="eval">Evaluation — structured QA dataset</option>
          </select>
        </Field>
        <div className="btn-row">
          <button className="btn" onClick={handleExport}><Ic.Download width={13} height={13} /> Export</button>
          <button className="btn" onClick={() => presetInputRef.current?.click()}><Ic.Upload width={13} height={13} /> Import</button>
          <input ref={presetInputRef} type="file" accept="application/json" hidden onChange={handlePresetFile} />
        </div>
      </div>

      <div className="card">
        <div className="card-title"><h3>Danger Zone</h3></div>
        <div className="btn-row">
          <button className="btn danger" onClick={async () => {
            const session = await import('../../modules/session.js');
            const confirmed = await session.requestConfirmPublic(
              'Clear the transcript, summaries, outcomes, and archived memory? Your setup (actors, scenario, settings) will be kept.',
              'Clear'
            );
            if (confirmed) await session.resetSession(false);
          }}>
            <Ic.Trash width={13} height={13} /> Clear conversation
          </button>
          <button className="btn danger" onClick={async () => {
            const session = await import('../../modules/session.js');
            const confirmed = await session.requestConfirmPublic(
              'Reset everything to factory defaults? This permanently deletes your actors, scenario, settings, documents, saved setups, and the current transcript. Saved sessions and other browser data on this origin are not affected. This cannot be undone.',
              'Reset all'
            );
            if (confirmed) await resetAllAppState();
          }}>
            <Ic.Trash width={13} height={13} /> Reset all
          </button>
        </div>
      </div>
    </div>
  );
}
