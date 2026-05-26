import React, { useState } from 'react';
import * as Ic from '../Icons';
import { ConnectionPanel } from './ConnectionPanel';
import { ScenarioPanel } from './ScenarioPanel';
import { ActorsPanel } from './ActorsPanel';
import { MemoryPanel } from './MemoryPanel';
import { TelemetryPanel } from './TelemetryPanel';
import { GoalPanel } from './GoalPanel';
import { SessionsPanel } from './SessionsPanel';
import { DocumentsPanel } from './DocumentsPanel';
import { PromptViewerPanel } from './PromptViewerPanel';

const PANELS = {
  connection: ConnectionPanel,
  scenario: ScenarioPanel,
  actors: ActorsPanel,
  memory: MemoryPanel,
  telemetry: TelemetryPanel,
  goal: GoalPanel,
  sessions: SessionsPanel,
  documents: DocumentsPanel,
};

export function Inspector({ active, meta, nav }) {
  const [showPrompt, setShowPrompt] = useState(false);

  const navItem = nav.find(n => n.id === active);
  const Icon = navItem ? Ic[navItem.icon] : null;
  const Panel = PANELS[active];

  return (
    <aside className="inspector" aria-label="Inspector">
      <header className="inspector-header">
        <h2>
          {Icon && <span className="h-icon"><Icon width={16} height={16} /></span>}
          {showPrompt ? 'Prompt Viewer' : meta.title}
          <small>· {showPrompt ? 'last assembled prompt' : meta.sub}</small>
        </h2>
        <button
          className={"chip-btn" + (showPrompt ? " active" : "")}
          style={{ marginLeft: 'auto', fontSize: 11 }}
          title="View the last prompt sent to the model"
          onClick={() => setShowPrompt(v => !v)}
        >
          {showPrompt ? '← Back' : '🔬 Prompt'}
        </button>
      </header>
      <div className="inspector-body">
        {showPrompt
          ? <PromptViewerPanel />
          : (Panel ? <Panel /> : <div className="empty" style={{ padding: 40 }}>Panel not found</div>)
        }
      </div>
    </aside>
  );
}
