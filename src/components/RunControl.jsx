import React, { useState, useRef, useEffect } from 'react';
import * as Ic from './Icons';
import { useForumState } from '../hooks/useForumState';
import { useActions } from '../hooks/useActions';

// The three "step sizes" the Continue action can take. Selecting one arms it
// (sets ui.continueMode); the primary button and Enter are the run triggers.
const MODES = [
  { id: 'next',  label: 'Next',  desc: 'one routed speaker',       icon: Ic.Step,        hint: 'Alt+N' },
  { id: 'round', label: 'Round', desc: 'a full round of turns',    icon: Ic.FastForward, hint: 'Alt+R' },
  { id: 'auto',  label: 'Auto',  desc: 'run until stopped or done', icon: Ic.Play,        hint: 'Alt+A' },
];

/**
 * RunControl — a single split-button that consolidates the run model.
 *  • Primary segment: runs the currently-selected mode (becomes Stop while running).
 *  • Caret segment: opens a menu to switch the mode (arms it; does not run).
 * This replaces the old three-button "Next / Round / Auto" selector that
 * masqueraded as run triggers but only armed the mode.
 */
export function RunControl() {
  const autoRunning = useForumState(s => s.autoRunning);
  const continueMode = useForumState(s => s.ui?.continueMode || 'next');
  const { setContinueMode, continueConversation, stopGeneration } = useActions();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // While auto-running the whole control collapses to a single Stop button.
  if (autoRunning) {
    return (
      <div className="run-control" ref={ref}>
        <button className="run-control-main danger" onClick={stopGeneration} title="Stop (Esc)" aria-label="Stop">
          <Ic.Stop width={13} height={13} /><span>Stop</span>
        </button>
      </div>
    );
  }

  const current = MODES.find(m => m.id === continueMode) || MODES[0];
  const CurrentIcon = current.icon;

  return (
    <div className="run-control" ref={ref}>
      <button
        className="run-control-main"
        onClick={() => continueConversation()}
        title={`Run ${current.label} — ${current.desc} (Enter)`}
        aria-label={`Run ${current.label}`}
      >
        <CurrentIcon width={13} height={13} /><span>{current.label}</span>
      </button>
      <button
        className={'run-control-caret' + (open ? ' active' : '')}
        onClick={() => setOpen(v => !v)}
        title="Change run mode"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Change run mode"
      >
        <Ic.ChevronDown width={13} height={13} />
      </button>
      {open && (
        <div className="run-control-menu" role="menu">
          {MODES.map(m => {
            const I = m.icon;
            const active = m.id === continueMode;
            return (
              <button
                key={m.id}
                role="menuitemradio"
                aria-checked={active}
                className={active ? 'checked' : ''}
                onClick={() => { setContinueMode(m.id); setOpen(false); }}
              >
                <I width={15} height={15} />
                <span className="run-mode-label">{m.label}</span>
                <span className="run-mode-desc">{m.desc}</span>
                {active
                  ? <Ic.Check width={14} height={14} className="run-mode-mark" />
                  : <span className="run-mode-hint">{m.hint}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
