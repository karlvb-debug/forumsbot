import React, { useState, useEffect, useRef } from 'react';
import * as Ic from '../Icons';
import { Field } from '../shared/FormControls';

export function SessionsPanel() {
  const [sessions, setSessions] = useState([]);
  const [exportMode, setExportMode] = useState('debug');
  const [pendingReset, setPendingReset] = useState(false);
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
        <Field label="Export mode">
          <select value={exportMode} onChange={(e) => setExportMode(e.target.value)}>
            <option value="debug">Debug — full state, private thoughts, traces & metrics</option>
            <option value="shareable">Shareable — redacted privacy mode</option>
            <option value="markdown">Markdown — human-readable transcript</option>
            <option value="eval">Evaluation — structured QA dataset</option>
          </select>
        </Field>
        <div className="field-hint" style={{ marginTop: -4, marginBottom: 8 }}>
          Debug exports include private thoughts and full prompt traces. Use Shareable before sending to others.
        </div>
        <div className="btn-row">
          <button className="btn" onClick={handleExport}><Ic.Download width={13} height={13} /> Export</button>
          <button className="btn" onClick={() => presetInputRef.current?.click()}><Ic.Upload width={13} height={13} /> Load preset</button>
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
          {pendingReset ? (
            <span className="confirm-inline">
              Reset app state to defaults?
              <button className="btn danger sm" onClick={resetAllAppState}>Yes, reset</button>
              <button className="btn sm" onClick={() => setPendingReset(false)}>Cancel</button>
            </span>
          ) : (
            <button className="btn danger" onClick={() => setPendingReset(true)}>
              <Ic.Trash width={13} height={13} /> Reset all
            </button>
          )}
        </div>
        <div className="field-hint" style={{ marginTop: 8 }}>
          Reset all restores Forum defaults only — it does not affect other browser storage on this origin.
        </div>
      </div>
    </div>
  );
}
