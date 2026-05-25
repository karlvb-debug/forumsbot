import React, { useState, useEffect } from 'react';
import * as Ic from '../Icons';
import { Field } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';

export function SessionsPanel() {
  const [sessions, setSessions] = useState([]);
  const [exportMode, setExportMode] = useState('debug');

  // Load sessions from IndexedDB on mount
  useEffect(() => {
    import('../../modules/db.js').then(db => {
      db.getAllSessions().then(s => setSessions(s || []));
    });
  }, []);

  const saveSession = async () => {
    const { saveCurrentSession } = await import('../../modules/session.js');
    await saveCurrentSession();
    const db = await import('../../modules/db.js');
    setSessions(await db.getAllSessions() || []);
  };

  const handleLoadSession = async (session) => {
    const mod = await import('../../modules/session.js');
    await mod.loadSession(session);
  };

  const deleteSession = async (id) => {
    const db = await import('../../modules/db.js');
    await db.deleteSession(id);
    setSessions(await db.getAllSessions() || []);
  };

  const handleExport = async () => {
    const { exportSession } = await import('../../modules/session.js');
    exportSession(exportMode);
  };

  return (
    <div>
      <div className="card">
        <div className="card-title"><h3>Sessions</h3><button className="btn sm primary" onClick={saveSession}><Ic.Plus width={12} height={12} /> Save current</button></div>
        {sessions.map((s) => (
          <div key={s.id} className="session-row" onClick={() => handleLoadSession(s)}>
            <div style={{ width: 8, height: 8, borderRadius: 99, background: "var(--fg-faint)", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="session-name" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title || s.name || 'Untitled'}</div>
              <div className="session-meta">{s.savedAt ? new Date(s.savedAt).toLocaleString() : ''} · {s.turnCount || 0} turns</div>
            </div>
            <button className="mini-icon-btn" title="Delete" onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}>
              <Ic.Trash width={12} height={12} />
            </button>
          </div>
        ))}
        {!sessions.length && <div className="empty">No saved sessions yet.</div>}
      </div>

      <div className="card">
        <div className="card-title"><h3>Export / Import</h3></div>
        <Field label="Export mode">
          <select value={exportMode} onChange={(e) => setExportMode(e.target.value)}>
            <option value="debug">Debug — all traces & metrics</option>
            <option value="share">Shareable — redacted privacy mode</option>
            <option value="md">Markdown — human-readable</option>
          </select>
        </Field>
        <div className="btn-row">
          <button className="btn" onClick={handleExport}><Ic.Download width={13} height={13} /> Export</button>
          <button className="btn"><Ic.Upload width={13} height={13} /> Load preset</button>
        </div>
      </div>

      <div className="card">
        <div className="card-title"><h3>Danger Zone</h3></div>
        <div className="btn-row">
          <button className="btn danger" onClick={async () => {
            const db = await import('../../modules/db.js');
            await db.clearMessages();
            mutateState(s => { s.messages = []; });
          }}><Ic.Trash width={13} height={13} /> Clear transcript</button>
          <button className="btn danger" onClick={() => {
            if (confirm('Reset all state? This cannot be undone.')) {
              localStorage.clear();
              window.location.reload();
            }
          }}><Ic.Trash width={13} height={13} /> Reset all</button>
        </div>
      </div>
    </div>
  );
}
