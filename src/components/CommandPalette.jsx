import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as Ic from './Icons';

const COMMANDS = [
  { id: 'scenario',   label: 'Open Scenario',      hint: 'S',     kind: 'nav', icon: Ic.Target },
  { id: 'actors',     label: 'Open Actors',         hint: 'A',     kind: 'nav', icon: Ic.Actors },
  { id: 'memory',     label: 'Open Memory',         hint: 'M',     kind: 'nav', icon: Ic.Brain },
  { id: 'telemetry',  label: 'Open Telemetry',      hint: 'T',     kind: 'nav', icon: Ic.Gauge },
  { id: 'doc',        label: 'Open Document',       hint: 'D',     kind: 'nav', icon: Ic.Doc },
  { id: 'goal',       label: 'Open Goal',           hint: 'G',     kind: 'nav', icon: Ic.Sliders },
  { id: 'sessions',   label: 'Open Sessions',       hint: 'L',     kind: 'nav', icon: Ic.Sessions },
  { id: 'kb',         label: 'Open Knowledge Base', hint: '',      kind: 'nav', icon: Ic.Search },
  { id: 'connection', label: 'Open Connection',     hint: 'K',     kind: 'nav', icon: Ic.Plug },
  { id: 'act:next',   label: 'Run next AI turn',    hint: 'Alt+N', kind: 'act', icon: Ic.Step },
  { id: 'act:round',  label: 'Run a full round',    hint: 'Alt+R', kind: 'act', icon: Ic.Round },
  { id: 'act:auto',   label: 'Toggle auto-run',     hint: 'Alt+A', kind: 'act', icon: Ic.Play },
  { id: 'act:stop',   label: 'Stop generation',     hint: 'Esc',   kind: 'act', icon: Ic.Stop },
  { id: 'act:nudge',  label: 'Trigger steering nudge', hint: '',   kind: 'act', icon: Ic.Bolt },
  { id: 'act:save',   label: 'Save session',        hint: 'Ctrl+S', kind: 'act', icon: Ic.Download },
  { id: 'act:export', label: 'Export transcript',    hint: '',      kind: 'act', icon: Ic.Download },
];

export function CommandPalette({ open, onClose, onSelect }) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return COMMANDS;
    const needle = query.toLowerCase();
    return COMMANDS.filter(c => c.label.toLowerCase().includes(needle));
  }, [query]);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIdx(0);
    // Focus after paint
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Keyboard nav
  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[activeIdx]) {
        onSelect(filtered[activeIdx]);
        onClose();
      }
    }
  };

  // Reset active index when filter changes
  useEffect(() => { setActiveIdx(0); }, [filtered]);

  if (!open) return null;

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd-box" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmd-input"
          autoFocus
          placeholder="Type a command or search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="cmd-list">
          {filtered.length === 0 && (
            <div className="empty" style={{ margin: 8 }}>No matches</div>
          )}
          {filtered.map((it, i) => (
            <div
              key={it.id}
              className={"cmd-item" + (i === activeIdx ? " active" : "")}
              onClick={() => { onSelect(it); onClose(); }}
              onMouseEnter={() => setActiveIdx(i)}
            >
              {it.icon && <it.icon width={16} height={16} />}
              <span>{it.label}</span>
              <span className="cmd-meta">{it.hint || it.kind}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
