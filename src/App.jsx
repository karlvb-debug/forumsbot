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
import { PauseCard } from './components/PauseCard';
import { AiAssistant } from './components/AiAssistant';
import { ReadinessStrip } from './components/ReadinessStrip';
import { DocEditorStage } from './components/DocEditorStage';
import { BottomNav } from './components/BottomNav';
import { Sheet } from './components/Sheet';
import * as Ic from './components/Icons';
// Importing state.js triggers loadState() at module level
import './modules/state.js';
import { setModuleRefs, useActions } from './hooks/useActions.js';
import { mutateState, notifyStateChange, saveState, useForumState } from './hooks/useForumState.js';

// Small media-query hook (no dependency) — drives the mobile shell.
function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

// Navigation items for the rail
const NAV = [
  { id: 'scenario',      label: 'Scenario',     icon: 'Target',   group: 1 },
  { id: 'actors',        label: 'Actors',       icon: 'Actors',   group: 1 },
  { id: 'participation', label: 'You',          icon: 'Info',     group: 1 },
  { id: 'memory',        label: 'Memory',       icon: 'Brain',    group: 2 },
  { id: 'telemetry',     label: 'Telemetry',    icon: 'Gauge',    group: 2 },
  { id: 'documents',     label: 'Documents',    icon: 'Doc',      group: 2 },
  { id: 'goal',          label: 'Goal',         icon: 'Sliders',  group: 3 },
  { id: 'sessions',      label: 'Sessions',     icon: 'Sessions', group: 3 },
  { id: 'connection',    label: 'Connection',   icon: 'Plug',     group: 4 },
  { id: 'help',          label: 'Help',         icon: 'Info',     group: 4 },
];

const NAV_TITLES = {
  scenario:      { title: 'Scenario',      sub: 'premise · objective · mode' },
  actors:        { title: 'Actors',        sub: 'panel composition' },
  participation: { title: 'Participation', sub: 'your role · pause policy' },
  memory:        { title: 'Memory',        sub: 'facts · summary · anchors · outcomes' },
  telemetry:     { title: 'Telemetry',     sub: 'alignment · drift · influence' },
  documents:     { title: 'Documents',     sub: 'working docs · references · links' },
  goal:          { title: 'Goal',          sub: 'auto-stop & judges' },
  sessions:      { title: 'Sessions',      sub: 'save · load · export' },
  connection:    { title: 'Connection',    sub: 'LM Studio · model · generation' },
  help:          { title: 'Help',          sub: 'documentation · reference' },
};

export default function App() {
  const [theme, setTheme] = useState('dark');
  const [density, setDensity] = useState('comfy');
  const [accent, setAccent] = useState('amber');
  const [activePanel, setActivePanel] = useState('actors');
  const [inspectorPos, setInspectorPos] = useState('left');
  const [ready, setReady] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [sheet, setSheet] = useState(null); // mobile only: null | 'panel' | 'more'
  const isMobile = useMediaQuery('(max-width: 759px)');
  const showThoughts = useForumState(s => s.settings?.showThoughts || false);
  const autoRunning = useForumState(s => s.autoRunning || false);

  const { nextTurn, runRound, startAuto, stopGeneration } = useActions();
  const stopModal = useForumState(s => s.ui?.stopModal || null);
  const confirmModal = useForumState(s => s.ui?.confirmModal || null);
  const pauseModal = useForumState(s => s.ui?.pauseModal || null);
  const awaitingUserInput = useForumState(s => s.ui?.awaitingUserInput || false);
  const focusedDocId = useForumState(s => s.ui?.focusedDocId || null);
  const hasUnresolvedPause = useForumState(s =>
    (s.pendingPauses || []).some(p => p.outcome === "honored" && !p.userResponse && !p.resolvedAt)
  );

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
      // Escape — dismiss modal overlays by directly clearing state
      if (e.key === 'Escape') {
        // Force clear whichever modal is open, then try to resolve the promise chain
        mutateState(s => {
          if (s.ui.confirmModal) {
            s.ui.confirmModal = null;
            import('./modules/session.js').then(m => m.resolveConfirmModal(false)).catch(() => {});
          } else if (s.ui.stopModal) {
            s.ui.stopModal = null;
            import('./modules/turns.js').then(m => m.resolveStopOrContinue(false)).catch(() => {});
          } else if (s.ui.pauseModal) {
            s.ui.pauseModal = null;
          }
        });
        e.preventDefault();
        return;
      }
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

  // Accent CSS vars — theme-aware: a darker accent on light backgrounds so
  // accent text/fills keep adequate contrast (the inline value overrides the
  // stylesheet's :root/.theme-light accent, so it must adapt to the theme).
  useEffect(() => {
    const map = {
      amber:  { h: 70,  c: 0.13 },
      violet: { h: 295, c: 0.14 },
      teal:   { h: 195, c: 0.12 },
      coral:  { h: 25,  c: 0.14 },
    };
    const m = map[accent] || map.amber;
    const light = theme === 'light';
    const l = light ? 0.62 : 0.80;
    const fg = light ? `oklch(0.99 0.01 ${m.h})` : `oklch(0.20 0.04 ${m.h})`;
    const root = document.documentElement.style;
    root.setProperty('--accent', `oklch(${l} ${m.c} ${m.h})`);
    root.setProperty('--accent-soft', `oklch(${l} ${m.c} ${m.h} / ${light ? 0.14 : 0.16})`);
    root.setProperty('--accent-fg', fg);
  }, [accent, theme]);

  const inspectorOnLeft = inspectorPos === 'left';
  const meta = NAV_TITLES[activePanel] || { title: '', sub: '' };

  // Mobile bottom-nav highlight + the "More" panel list
  const navMode = sheet === null
    ? 'forum'
    : sheet === 'more'
      ? 'more'
      : (activePanel === 'actors' ? 'actors' : activePanel === 'memory' ? 'memory' : 'more');
  const moreItems = NAV.filter(n => !['actors', 'memory'].includes(n.id));

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
          {!isMobile && inspectorOnLeft && (
            <Inspector active={activePanel} meta={meta} nav={NAV} />
          )}
          {focusedDocId ? (
            <DocEditorStage
              transcript={<Transcript showThoughts={showThoughts} />}
              composer={
                <Composer
                  showThoughts={showThoughts}
                  onToggleThoughts={() => mutateState(s => { s.settings.showThoughts = !s.settings.showThoughts; })}
                />
              }
            />
          ) : (
            <div className="stage">
              <div className="stage-inner">
                <Transcript showThoughts={showThoughts} />
              </div>
              <ReadinessStrip />
              {awaitingUserInput && (
                <div className="awaiting-input-strip">
                  ⏸ An actor is waiting for your response — see the pause card above
                </div>
              )}
              <Composer
                showThoughts={showThoughts}
                onToggleThoughts={() => mutateState(s => { s.settings.showThoughts = !s.settings.showThoughts; })}
              />
            </div>
          )}
          {!isMobile && !inspectorOnLeft && (
            <Inspector active={activePanel} meta={meta} nav={NAV} />
          )}
        </div>
      </div>

      {isMobile && (
        <>
          <Sheet open={sheet === 'panel'} title={meta.title} sub={meta.sub} onClose={() => setSheet(null)}>
            <Inspector active={activePanel} meta={meta} nav={NAV} embedded />
          </Sheet>
          <Sheet open={sheet === 'more'} title="More" sub="all panels & settings" onClose={() => setSheet(null)}>
            <div className="more-grid">
              {moreItems.map(n => {
                const I = Ic[n.icon];
                return (
                  <button key={n.id} className="more-item" onClick={() => { setActivePanel(n.id); setSheet('panel'); }}>
                    {I && <I width={20} height={20} />}
                    <span>{n.label}</span>
                  </button>
                );
              })}
              <button className="more-item" onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}>
                {theme === 'dark' ? <Ic.Sun width={20} height={20} /> : <Ic.Moon width={20} height={20} />}
                <span>Theme</span>
              </button>
              <button className="more-item" onClick={() => { setSheet(null); setCmdOpen(true); }}>
                <Ic.Cmd width={20} height={20} />
                <span>Commands</span>
              </button>
            </div>
          </Sheet>
          <BottomNav
            mode={navMode}
            onForum={() => setSheet(null)}
            onActors={() => { setActivePanel('actors'); setSheet('panel'); }}
            onMemory={() => { setActivePanel('memory'); setSheet('panel'); }}
            onMore={() => setSheet('more')}
            autoRunning={autoRunning}
            onRun={nextTurn}
            onStop={stopGeneration}
          />
        </>
      )}

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
      {pauseModal && (
        <div className="modal-overlay">
          <div className="modal-card pause-modal-card">
            <PauseCard
              msg={{ type: 'pause', pauseRecord: { ...pauseModal.pauseRecord, outcome: 'honored' } }}
              interactive={true}
            />
          </div>
        </div>
      )}
      {/* Persistent strip to reopen a dismissed/vanished pause modal */}
      {!pauseModal && hasUnresolvedPause && (
        <div
          className="unanswered-pause-strip"
          onClick={() => import('./modules/turns.js').then(m => m.reopenPause())}
        >
          <span className="unanswered-pause-icon">⏸</span>
          <span>An actor asked you a question — <strong>click here to reopen</strong></span>
        </div>
      )}
    </Shell>
  );
}
