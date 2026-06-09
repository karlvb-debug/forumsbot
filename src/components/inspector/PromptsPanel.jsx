import React, { useState, useMemo, useCallback } from 'react';
import { useForumState, mutateState } from '../../hooks/useForumState';
import {
  frag, getDefault, getOverride, setOverride, clearOverride,
  clearAllOverrides, getAllKeys, getOverrideCount, hasOverride,
  PROMPT_GROUPS, keyLabel
} from '../../prompts/index.js';
import { PromptViewerPanel } from './PromptViewerPanel';

// ── Inline styles ─────────────────────────────────────────────────────────

const styles = {
  container: { padding: '8px 0' },
  toolbar: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '4px 8px', marginBottom: 8, flexWrap: 'wrap',
  },
  searchInput: {
    flex: '1 1 140px', minWidth: 100, padding: '5px 8px',
    background: 'var(--bg-raised, rgba(0,0,0,0.2))',
    border: '1px solid var(--border)', borderRadius: 6,
    color: 'var(--fg)', fontSize: 12, outline: 'none',
  },
  badge: {
    display: 'inline-block', padding: '1px 6px',
    borderRadius: 8, fontSize: 10, fontWeight: 700,
    background: 'var(--accent, #e0a030)', color: '#000',
    marginLeft: 4,
  },
  groupHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '6px 10px', cursor: 'pointer', userSelect: 'none',
    background: 'var(--bg-raised, rgba(0,0,0,0.15))',
    borderRadius: 6, marginBottom: 2,
    fontSize: 12, fontWeight: 600, color: 'var(--fg)',
    border: '1px solid var(--border)',
  },
  fragItem: {
    padding: '8px 10px', marginBottom: 6,
    borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg, #1a1a1a)',
  },
  fragLabel: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 4,
  },
  fragKey: {
    fontSize: 11, fontWeight: 600, color: 'var(--fg-mute)',
    fontFamily: 'monospace',
  },
  fragName: {
    fontSize: 12, fontWeight: 600, color: 'var(--fg)',
    marginBottom: 2,
  },
  textarea: {
    width: '100%', boxSizing: 'border-box', padding: '6px 8px',
    background: 'var(--bg-raised, rgba(0,0,0,0.2))',
    border: '1px solid var(--border)', borderRadius: 4,
    color: 'var(--fg)', fontSize: 11, lineHeight: 1.45,
    fontFamily: 'monospace', resize: 'vertical',
    minHeight: 60, outline: 'none',
  },
  overrideBorder: {
    borderColor: 'var(--accent, #e0a030)',
  },
  defaultPre: {
    margin: '4px 0 0', padding: '4px 8px',
    background: 'var(--bg-raised, rgba(0,0,0,0.1))',
    borderRadius: 4, fontSize: 10, lineHeight: 1.4,
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    color: 'var(--fg-mute)', maxHeight: 120, overflowY: 'auto',
    border: '1px solid var(--border)',
  },
  viewerToggle: {
    marginLeft: 'auto',
  },
};

// ── Fragment Editor ───────────────────────────────────────────────────────

function FragmentEditor({ fragKey }) {
  const [expanded, setExpanded] = useState(false);
  const override = getOverride(fragKey);
  const defaultText = getDefault(fragKey);
  const isOverridden = override != null;
  const displayText = isOverridden ? override : defaultText;

  const handleChange = useCallback((e) => {
    setOverride(fragKey, e.target.value);
    // Trigger React re-render through state notification
    mutateState(() => {});
  }, [fragKey]);

  const handleReset = useCallback(() => {
    clearOverride(fragKey);
    mutateState(() => {});
  }, [fragKey]);

  return (
    <div style={{
      ...styles.fragItem,
      ...(isOverridden ? styles.overrideBorder : {}),
    }}>
      <div style={styles.fragLabel}>
        <div>
          <div style={styles.fragName}>{keyLabel(fragKey)}</div>
          <div style={styles.fragKey}>{fragKey}</div>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {isOverridden && (
            <button className="btn sm" title="Reset to default" onClick={handleReset}
              style={{ fontSize: 11, padding: '2px 6px' }}>
              ↺
            </button>
          )}
          {isOverridden && (
            <span style={{ ...styles.badge, fontSize: 9 }}>edited</span>
          )}
        </div>
      </div>
      <textarea
        style={{
          ...styles.textarea,
          ...(isOverridden ? { borderColor: 'var(--accent, #e0a030)' } : {}),
        }}
        value={displayText || ''}
        onChange={handleChange}
        spellCheck={false}
      />
      {isOverridden && (
        <div>
          <button
            className="btn sm"
            style={{ fontSize: 10, padding: '1px 5px', marginTop: 4 }}
            onClick={() => setExpanded(v => !v)}
          >
            {expanded ? 'Hide default' : 'Show default'}
          </button>
          {expanded && (
            <pre style={styles.defaultPre}>{defaultText}</pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── Group Disclosure ──────────────────────────────────────────────────────

function PromptGroup({ group, searchFilter }) {
  const [open, setOpen] = useState(false);

  const visibleKeys = useMemo(() => {
    if (!searchFilter) return group.keys;
    const q = searchFilter.toLowerCase();
    return group.keys.filter(k =>
      k.toLowerCase().includes(q) ||
      keyLabel(k).toLowerCase().includes(q) ||
      (getDefault(k) || '').toLowerCase().includes(q)
    );
  }, [group.keys, searchFilter]);

  const overrideCount = useMemo(() =>
    visibleKeys.filter(k => hasOverride(k)).length,
    [visibleKeys]
  );

  if (visibleKeys.length === 0) return null;

  return (
    <div style={{ marginBottom: 4 }}>
      <div style={styles.groupHeader} onClick={() => setOpen(v => !v)}>
        <span>
          {open ? '▾' : '▸'} {group.label}
          <span style={{ fontWeight: 400, color: 'var(--fg-mute)', marginLeft: 6, fontSize: 11 }}>
            ({visibleKeys.length})
          </span>
        </span>
        {overrideCount > 0 && (
          <span style={styles.badge}>{overrideCount} edited</span>
        )}
      </div>
      {open && (
        <div style={{ padding: '4px 0 0 0' }}>
          {visibleKeys.map(k => <FragmentEditor key={k} fragKey={k} />)}
        </div>
      )}
    </div>
  );
}

// ── Main Panel ───────────────────────────────────────────────────────────

export function PromptsPanel() {
  const [search, setSearch] = useState('');
  const [showViewer, setShowViewer] = useState(false);

  // Re-render when overrides change
  useForumState(s => JSON.stringify(s.promptOverrides || {}));

  const overrideCount = getOverrideCount();

  const handleResetAll = useCallback(() => {
    if (overrideCount === 0) return;
    if (!window.confirm(`Reset all ${overrideCount} prompt override(s) to defaults?`)) return;
    clearAllOverrides();
    mutateState(() => {});
  }, [overrideCount]);

  const handleExport = useCallback(() => {
    const overrides = {};
    for (const key of getAllKeys()) {
      if (hasOverride(key)) overrides[key] = getOverride(key);
    }
    const blob = new Blob(
      [JSON.stringify({ version: 1, overrides }, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'forum-prompts.json';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data?.overrides || typeof data.overrides !== 'object') {
          alert('Invalid prompt overrides file.');
          return;
        }
        const allKeys = new Set(getAllKeys());
        let applied = 0, skipped = 0;
        for (const [key, value] of Object.entries(data.overrides)) {
          if (allKeys.has(key) && typeof value === 'string') {
            setOverride(key, value);
            applied++;
          } else {
            skipped++;
          }
        }
        mutateState(() => {});
        alert(`Imported ${applied} override(s).${skipped ? ` Skipped ${skipped} unknown key(s).` : ''}`);
      } catch (err) {
        alert('Failed to parse file: ' + err.message);
      }
    };
    input.click();
  }, []);

  if (showViewer) {
    return (
      <div style={styles.container}>
        <div style={styles.toolbar}>
          <button className="btn sm" onClick={() => setShowViewer(false)}>
            ← Back to Editor
          </button>
          <span style={{ fontSize: 12, color: 'var(--fg-mute)' }}>
            Last assembled prompt
          </span>
        </div>
        <PromptViewerPanel />
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.toolbar}>
        <input
          type="text"
          placeholder="Search prompts…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={styles.searchInput}
        />
        {overrideCount > 0 && (
          <button className="btn sm" onClick={handleResetAll}
            title={`Reset all ${overrideCount} overrides`}
            style={{ fontSize: 11 }}>
            ↺ Reset all ({overrideCount})
          </button>
        )}
        <button className="btn sm" onClick={handleExport}
          title="Export prompt overrides as JSON" style={{ fontSize: 11 }}>
          ↓ Export
        </button>
        <button className="btn sm" onClick={handleImport}
          title="Import prompt overrides from JSON" style={{ fontSize: 11 }}>
          ↑ Import
        </button>
        <button
          className="chip-btn"
          onClick={() => setShowViewer(true)}
          title="View the last assembled prompt sent to the model"
          style={styles.viewerToggle}
        >
          🔬 Last Prompt
        </button>
      </div>

      {overrideCount > 0 && (
        <div style={{ padding: '0 4px', marginBottom: 8 }}>
          <span style={styles.badge}>
            {overrideCount} override{overrideCount !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {PROMPT_GROUPS.map(g => (
        <PromptGroup key={g.id} group={g} searchFilter={search} />
      ))}
    </div>
  );
}

