import React, { useState, useEffect, useCallback } from 'react';
import { Shell } from './components/Shell';
import { Rail } from './components/Rail';
import { Topbar } from './components/Topbar';
import { Inspector } from './components/inspector/Inspector';
import { Transcript } from './components/Transcript';
import { Composer } from './components/Composer';
import { CommandPalette } from './components/CommandPalette';
import { StopModal } from './components/StopModal';
import { ConfirmModal } from './components/ConfirmModal';
import { AiAssistant } from './components/AiAssistant';
import { ReadinessStrip } from './components/ReadinessStrip';
// Importing state.js triggers loadState() at module level
import './modules/state.js';
import { setModuleRefs, useActions } from './hooks/useActions.js';
import { mutateState, notifyStateChange, saveState, useForumState } from './hooks/useForumState.js';

// Navigation items for the rail
const NAV = [
  { id: 'scenario',   label: 'Scenario',   icon: 'Target',   group: 1 },
  { id: 'actors',     label: 'Actors',      icon: 'Actors',   group: 1 },
  { id: 'memory',     label: 'Memory',      icon: 'Brain',    group: 2 },
  { id: 'telemetry',  label: 'Telemetry',   icon: 'Gauge',    group: 2 },
  { id: 'documents',  label: 'Documents',   icon: 'Doc',      group: 2 },
  { id: 'goal',       label: 'Goal',        icon: 'Sliders',  group: 3 },
  { id: 'sessions',   label: 'Sessions',    icon: 'Sessions', group: 3 },
  { id: 'connection', label: 'Connection',  icon: 'Plug',     group: 4 },
  { id: 'help',       label: 'Help',        icon: 'Info',     group: 4 },
];

const NAV_TITLES = {
  scenario:   { title: 'Scenario',    sub: 'premise · objective · mode' },
  actors:     { title: 'Actors',      sub: 'panel composition' },
  memory:     { title: 'Memory',      sub: 'facts · summary · anchors · outcomes' },
  telemetry:  { title: 'Telemetry',   sub: 'alignment · drift · influence' },
  documents:  { title: 'Documents',   sub: 'working docs · references · links' },
  goal:       { title: 'Goal',        sub: 'auto-stop & judges' },
  sessions:   { title: 'Sessions',    sub: 'save · load · export' },
  connection: { title: 'Connection',  sub: 'LM Studio · model · generation' },
  help:       { title: 'Help',        sub: 'documentation · reference' },
};

export default function App() {
  const [theme, setTheme] = useState('dark');
  const [density, setDensity] = useState('comfy');
  const [accent, setAccent] = useState('amber');
  const [activePanel, setActivePanel] = useState('actors');
  const [inspectorPos, setInspectorPos] = useState('left');
  const [ready, setReady] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const showThoughts = useForumState(s => s.settings?.showThoughts || false);

  const { nextTurn, runRound, startAuto, stopGeneration } = useActions();
  const stopModal = useForumState(s => s.ui?.stopModal || null);
  const confirmModal = useForumState(s => s.ui?.confirmModal || null);

  // Load modules on mount
  useEffect(() => {
    notifyStateChange(); // trigger initial React render with loaded state
    // Lazy-load modules to wire action hooks
    Promise.all([
      import('./modules/turns.js'),
      import('./modules/api.js'),
      import('./modules/session.js'),
      import('./modules/memory.js'),
      import('./modules/db.js'),
    ]).then(async ([turns, api, session, memory, db]) => {
      setModuleRefs({ turns, api, session, memory, db });
      await db.initializeMemoryStorage?.();
      saveState();
      // Auto-ping connection on startup
      api.startConnectionPing?.();
      setReady(true);
    }).catch(err => {
      console.warn('[App] Module init error (non-fatal):', err);
      setReady(true);
    });
  }, []);

  // ── Keyboard shortcuts ──────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      // Ctrl+K / ⌘K — command palette
      if (mod && !e.shiftKey && !e.altKey && e.key === 'k') { e.preventDefault(); setCmdOpen(v => !v); return; }
      // Alt+N — next turn (Ctrl+Shift+N / ⌘+Shift+N opens incognito window)
      if (e.altKey && !mod && !e.shiftKey && e.code === 'KeyN') { e.preventDefault(); nextTurn(); return; }
      // Alt+R — run full round (Ctrl+Shift+R / ⌘+Shift+R is hard reload)
      if (e.altKey && !mod && !e.shiftKey && e.code === 'KeyR') { e.preventDefault(); runRound(); return; }
      // Alt+A — toggle auto
      if (e.altKey && !mod && !e.shiftKey && e.code === 'KeyA') { e.preventDefault(); startAuto(); return; }
      // Alt+I — toggle AI assistant (Ctrl+Shift+I / ⌘+Shift+I opens DevTools)
      if (e.altKey && !mod && !e.shiftKey && e.code === 'KeyI') { e.preventDefault(); mutateState(s => { s.ui.assistantOpen = !s.ui.assistantOpen; }); return; }
      // Ctrl+S / ⌘S — save session (prevent default browser save)
      if (mod && !e.shiftKey && !e.altKey && e.key === 's') {
        e.preventDefault();
        import('./modules/session.js').then(m => m.saveCurrentSession?.());
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nextTurn, runRound, startAuto]);

  // ── Command palette handler ─────────────────────────────────
  const handleCommand = useCallback((item) => {
    if (item.kind === 'nav') {
      setActivePanel(item.id);
    } else if (item.id === 'act:next') {
      nextTurn();
    } else if (item.id === 'act:round') {
      runRound();
    } else if (item.id === 'act:auto') {
      startAuto();
    } else if (item.id === 'act:stop') {
      stopGeneration();
    } else if (item.id === 'act:nudge') {
      mutateState(s => {
        if (!s.telemetry) s.telemetry = {};
        s.telemetry.nudgeTriggered = true;
      });
    } else if (item.id === 'act:save') {
      import('./modules/session.js').then(m => m.saveCurrentSession?.());
    } else if (item.id === 'act:export') {
      import('./modules/session.js').then(m => m.exportSession?.('debug'));
    }
  }, [nextTurn, runRound, startAuto, stopGeneration]);

  // Theme class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle('theme-light', theme === 'light');
  }, [theme]);

  // Density class on <body>
  useEffect(() => {
    document.body.classList.remove('density-compact', 'density-comfy');
    document.body.classList.add(density === 'compact' ? 'density-compact' : 'density-comfy');
  }, [density]);

  // Accent CSS vars
  useEffect(() => {
    const map = {
      amber:  { l: 0.78, c: 0.13, h: 65,  fg: 'oklch(0.20 0.04 65)' },
      violet: { l: 0.72, c: 0.14, h: 295, fg: 'oklch(0.20 0.04 295)' },
      teal:   { l: 0.74, c: 0.12, h: 195, fg: 'oklch(0.18 0.04 195)' },
      coral:  { l: 0.72, c: 0.14, h: 25,  fg: 'oklch(0.20 0.04 25)' },
    };
    const m = map[accent] || map.amber;
    document.documentElement.style.setProperty('--accent', `oklch(${m.l} ${m.c} ${m.h})`);
    document.documentElement.style.setProperty('--accent-soft', `oklch(${m.l} ${m.c} ${m.h} / 0.16)`);
    document.documentElement.style.setProperty('--accent-fg', m.fg);
  }, [accent]);

  const inspectorOnLeft = inspectorPos === 'left';
  const meta = NAV_TITLES[activePanel] || { title: '', sub: '' };

  return (
    <Shell inspectorOnLeft={inspectorOnLeft}>
      <Rail
        nav={NAV}
        active={activePanel}
        onSelect={setActivePanel}
        theme={theme}
        onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
        onOpenCmd={() => setCmdOpen(true)}
      />
      <div className="main">
        <Topbar onOpenCmd={() => setCmdOpen(true)} />
        <div className={'workspace' + (inspectorOnLeft ? ' inspector-left-pos' : '')}>
          {inspectorOnLeft && (
            <Inspector active={activePanel} meta={meta} nav={NAV} />
          )}
          <div className="stage">
            <div className="stage-inner">
              <Transcript showThoughts={showThoughts} />
            </div>
            <ReadinessStrip />
            <Composer
              showThoughts={showThoughts}
              onToggleThoughts={() => mutateState(s => { s.settings.showThoughts = !s.settings.showThoughts; })}
            />
          </div>
          {!inspectorOnLeft && (
            <Inspector active={activePanel} meta={meta} nav={NAV} />
          )}
        </div>
      </div>

      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onSelect={handleCommand}
      />
      <AiAssistant />
      {confirmModal && (
        <ConfirmModal
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          onConfirm={() => import('./modules/session.js').then(m => m.resolveConfirmModal(true))}
          onCancel={() => import('./modules/session.js').then(m => m.resolveConfirmModal(false))}
        />
      )}
      {stopModal && (
        <StopModal
          reason={stopModal.reason}
          suggestedGoal={stopModal.suggestedGoal}
          onStop={() => import('./modules/turns.js').then(m => m.resolveStopOrContinue(true))}
          onContinue={(g) => import('./modules/turns.js').then(m => m.resolveStopOrContinue(false, g))}
        />
      )}
    </Shell>
  );
}
