import React from 'react';
import * as Ic from '../Icons';
import { Field, Toggle, Seg } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';

export function ScenarioPanel() {
  const mode = useForumState(s => s.scenario?.mode || 'problem');
  const title = useForumState(s => s.scenario?.title || '');
  const premise = useForumState(s => s.scenario?.premise || '');
  const objective = useForumState(s => s.scenario?.objective || '');

  const updateScenario = (key, val) => mutateState(s => { s.scenario[key] = val; });

  return (
    <div>
      <div className="card">
        <div className="card-title"><h3><Ic.Target /> Mode</h3></div>
        <Seg full
          options={[
            { value: "problem", label: "Problem" },
            { value: "story", label: "Story" },
            { value: "freeform", label: "Freeform" },
          ]}
          value={mode} onChange={(v) => updateScenario('mode', v)}
        />
        <div className="field-hint" style={{ marginTop: 8 }}>
          {mode === "problem" && "Collaborative problem-solving — actors analyze, challenge assumptions, converge on solutions."}
          {mode === "story" && "Narrative roleplay — actors speak in character; web tools disabled."}
          {mode === "freeform" && "Open-ended discussion — no structured goal; actors explore freely."}
        </div>
      </div>

      <div className="card">
        <div className="card-title"><h3>Anchor</h3><span className="badge">non-compressible</span></div>
        <Field label="Title">
          <input value={title} onChange={(e) => updateScenario('title', e.target.value)} />
        </Field>
        <Field label="Premise" info="The backstory that grounds every actor prompt">
          <textarea rows={4} value={premise} onChange={(e) => updateScenario('premise', e.target.value)} />
        </Field>
        <Field label="Objective" info="Used for drift scoring and the auto-stop goal judge">
          <textarea rows={3} value={objective} onChange={(e) => updateScenario('objective', e.target.value)} />
        </Field>
      </div>

    </div>
  );
}
