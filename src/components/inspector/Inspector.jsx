import React from 'react';
import * as Ic from '../Icons';
import { ConnectionPanel } from './ConnectionPanel';
import { ScenarioPanel } from './ScenarioPanel';
import { ActorsPanel } from './ActorsPanel';
import { MemoryPanel } from './MemoryPanel';
import { TelemetryPanel } from './TelemetryPanel';
import { GoalPanel } from './GoalPanel';
import { DocPanel } from './DocPanel';
import { SessionsPanel } from './SessionsPanel';
import { KnowledgeBasePanel } from './KnowledgeBasePanel';

const PANELS = {
  connection: ConnectionPanel,
  scenario: ScenarioPanel,
  actors: ActorsPanel,
  memory: MemoryPanel,
  telemetry: TelemetryPanel,
  goal: GoalPanel,
  doc: DocPanel,
  sessions: SessionsPanel,
  kb: KnowledgeBasePanel,
};

export function Inspector({ active, meta, nav }) {
  const navItem = nav.find(n => n.id === active);
  const Icon = navItem ? Ic[navItem.icon] : null;
  const Panel = PANELS[active];

  return (
    <aside className="inspector" aria-label="Inspector">
      <header className="inspector-header">
        <h2>
          {Icon && <span className="h-icon"><Icon width={16} height={16} /></span>}
          {meta.title}
          <small>· {meta.sub}</small>
        </h2>
      </header>
      <div className="inspector-body">
        {Panel ? <Panel /> : <div className="empty" style={{ padding: 40 }}>Panel not found</div>}
      </div>
    </aside>
  );
}
