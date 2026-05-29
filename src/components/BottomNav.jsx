import React from 'react';
import * as Ic from './Icons';

/**
 * Mobile bottom tab bar (shown only < 760px via CSS).
 * Navigation-first: the few most-used destinations plus one prominent
 * "advance the conversation" action. Auto/Round/Stop also live in the Composer
 * (visible above this bar) and the Command Palette.
 *
 * `mode` is the currently-highlighted tab: 'forum' | 'actors' | 'memory' | 'more'.
 */
export function BottomNav({ mode, onForum, onActors, onMemory, onMore, autoRunning, onRun, onStop }) {
  const tab = (key, label, Icon, onClick) => (
    <button
      type="button"
      className={'bottomnav-tab' + (mode === key ? ' active' : '')}
      onClick={onClick}
      aria-label={label}
      aria-current={mode === key ? 'page' : undefined}
    >
      <Icon width={20} height={20} />
      <span className="bottomnav-label">{label}</span>
    </button>
  );

  return (
    <nav className="bottomnav" aria-label="Primary">
      {tab('forum', 'Forum', Ic.Round, onForum)}
      {tab('actors', 'Actors', Ic.Actors, onActors)}

      {/* Center action: advance the conversation (or stop when auto-running) */}
      <button
        type="button"
        className={'bottomnav-run' + (autoRunning ? ' running' : '')}
        onClick={autoRunning ? onStop : onRun}
        aria-label={autoRunning ? 'Stop generation' : 'Next turn'}
        title={autoRunning ? 'Stop' : 'Next turn'}
      >
        {autoRunning ? <Ic.Stop width={20} height={20} /> : <Ic.Step width={22} height={22} />}
        <span className="bottomnav-label">{autoRunning ? 'Stop' : 'Run'}</span>
      </button>

      {tab('memory', 'Memory', Ic.Brain, onMemory)}
      {tab('more', 'More', Ic.Cmd, onMore)}
    </nav>
  );
}
