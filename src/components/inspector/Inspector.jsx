import React, { useState } from 'react';
import * as Ic from '../Icons';
import { ConnectionPanel } from './ConnectionPanel';
import { ScenarioPanel } from './ScenarioPanel';
import { ActorsPanel } from './ActorsPanel';
import { MemoryPanel } from './MemoryPanel';
import { TelemetryPanel } from './TelemetryPanel';
import { GoalPanel } from './GoalPanel';
import { SessionsPanel } from './SessionsPanel';
import { LibraryPanel } from './LibraryPanel';
import { DocumentsPanel } from './DocumentsPanel';
import { PromptViewerPanel } from './PromptViewerPanel';
import { HelpPanel } from './HelpPanel';
import { ParticipationPanel } from './ParticipationPanel';

const PANELS = {
  connection: ConnectionPanel,
  scenario: ScenarioPanel,
  actors: ActorsPanel,
  participation: ParticipationPanel,
  memory: MemoryPanel,
  telemetry: TelemetryPanel,
  goal: GoalPanel,
  library: LibraryPanel,
  sessions: SessionsPanel,
  documents: DocumentsPanel,
  help: HelpPanel,
};

export function Inspector({ active, meta, nav, embedded = false }) {
  const [showPrompt, setShowPrompt] = useState(false);

  const navItem = nav.find(n => n.id === active);
  const Icon = navItem ? Ic[navItem.icon] : null;
  const Panel = PANELS[active];

  const promptToggle = (
    <button
      className={"chip-btn" + (showPrompt ? " active" : "")}
      style={{ marginLeft: 'auto' }}
      title="View the last prompt sent to the model"
      onClick={() => setShowPrompt(v => !v)}
    >
      {showPrompt ? '← Back' : '🔬 Prompt'}
    </button>
  );

  const body = (
    <div className="inspector-body">
      {showPrompt
        ? <PromptViewerPanel />
        : (Panel ? <Panel /> : <div className="empty" style={{ padding: 40 }}>Panel not found</div>)
      }
    </div>
  );

  // Embedded (mobile sheet): the Sheet supplies the title chrome, so render a
  // slim prompt-toggle row plus the shared panel body — same panels, no dupes.
  if (embedded) {
    return (
      <div className="inspector inspector--embedded" aria-label="Inspector">
        <div className="inspector-embedded-actions">{promptToggle}</div>
        {body}
      </div>
    );
  }

  return (
    <aside className="inspector" aria-label="Inspector">
      <header className="inspector-header">
        <h2>
          {Icon && <span className="h-icon"><Icon width={16} height={16} /></span>}
          {showPrompt ? 'Prompt Viewer' : meta.title}
          <small>· {showPrompt ? 'last assembled prompt' : meta.sub}</small>
        </h2>
        {promptToggle}
      </header>
      {body}
    </aside>
  );
}
