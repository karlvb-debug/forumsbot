import React, { useState, useEffect } from 'react';
import * as Ic from '../Icons';
import { useForumState } from '../../hooks/useForumState';
import { BLUEPRINTS } from '../../modules/blueprints.js';

// The Library is the home for reusable setups: built-in blueprints (scenario +
// systems + cast + seeded docs) and the user's own saved setups. Applying any of
// these touches multiple modules (scenario, actors, autoStop, documents), which
// is why it lives here rather than inside the Scenario editor.
export function LibraryPanel() {
  const actors = useForumState(s => s.actors || []);
  const messageCount = useForumState(s => (s.messages || []).length);

  const [selected, setSelected] = useState('');
  const [configs, setConfigs] = useState([]);
  const [configName, setConfigName] = useState('');

  const refreshConfigs = async () => {
    const mod = await import('../../modules/session.js');
    setConfigs(mod.listConfigurations());
  };
  useEffect(() => { refreshConfigs(); }, []);

  const selectedBp = BLUEPRINTS.find(b => b.id === selected) || null;

  const applySelectedBlueprint = async () => {
    if (!selectedBp) return;
    const mod = await import('../../modules/session.js');
    if (messageCount > 0 || actors.length > 0) {
      const ok = await mod.requestConfirmPublic(
        `Apply the "${selectedBp.label}" blueprint? This replaces the current scenario and cast (${selectedBp.cast.length} actors). Your transcript is kept.`,
        'Apply blueprint'
      );
      if (!ok) return;
    }
    await mod.applyBlueprint(selectedBp.id);
  };

  const handleSaveSetup = async () => {
    const mod = await import('../../modules/session.js');
    mod.saveConfiguration(configName);
    setConfigName('');
    await refreshConfigs();
  };

  const handleApplySetup = async (config) => {
    const mod = await import('../../modules/session.js');
    const ok = await mod.requestConfirmPublic(
      `Apply saved setup "${config.name}"? This replaces the current scenario and cast. Your transcript is kept.`,
      'Apply'
    );
    if (ok) mod.applyConfiguration(config);
  };

  const handleDeleteSetup = async (id) => {
    const mod = await import('../../modules/session.js');
    mod.deleteConfiguration(id);
    await refreshConfigs();
  };

  return (
    <div>
      {/* ── Blueprints ─────────────────────────────────────────── */}
      <div className="card">
        <div className="card-title"><h3>Blueprints</h3></div>
        <div className="field-hint" style={{ marginBottom: 10 }}>
          A turnkey setup — scenario, systems, and a recommended cast (some also seed working documents). Everything stays editable after you apply it.
        </div>
        <div className="btn-row" style={{ marginBottom: selectedBp ? 8 : 0 }}>
          <select
            style={{ flex: 1, fontSize: 12 }}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">— Choose a blueprint —</option>
            {BLUEPRINTS.map(bp => (
              <option key={bp.id} value={bp.id} title={bp.description}>
                {bp.icon} {bp.label} · {bp.cast.length} actors
              </option>
            ))}
          </select>
          <button className="btn sm primary" disabled={!selectedBp} onClick={applySelectedBlueprint}>
            Apply
          </button>
        </div>
        {selectedBp && (
          <div className="field-hint">{selectedBp.description}</div>
        )}
      </div>

      {/* ── Saved setups (user blueprints) ─────────────────────── */}
      <div className="card">
        <div className="card-title"><h3>Your saved setups</h3></div>
        <div className="field-hint" style={{ marginBottom: 8 }}>
          Save the current scenario, cast, and generation settings as a reusable setup — no transcript.
        </div>
        <div className="btn-row" style={{ marginBottom: 10 }}>
          <input
            style={{ flex: 1, fontSize: 12 }}
            placeholder="Name this setup…"
            value={configName}
            onChange={e => setConfigName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSaveSetup(); }}
          />
          <button className="btn sm primary" onClick={handleSaveSetup}>
            <Ic.Plus width={12} height={12} /> Save current
          </button>
        </div>
        {configs.map((c) => (
          <div key={c.id} className="session-row" onClick={() => handleApplySetup(c)} title="Apply this setup">
            <div style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--accent)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="session-name" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.name}
              </div>
              <div className="session-meta">
                {c.savedAt ? new Date(c.savedAt).toLocaleDateString() : ''} · {c.actorCount ?? (c.actors?.length || 0)} actors
              </div>
            </div>
            <button className="mini-icon-btn" title="Delete" onClick={(e) => { e.stopPropagation(); handleDeleteSetup(c.id); }}>
              <Ic.Trash width={12} height={12} />
            </button>
          </div>
        ))}
        {!configs.length && <div className="empty">No saved setups yet.</div>}
      </div>
    </div>
  );
}
