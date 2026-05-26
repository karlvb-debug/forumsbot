import React, { useMemo } from 'react';
import * as Ic from '../Icons';
import { Field, Toggle, Seg } from '../shared/FormControls';
import { useForumState, mutateState, saveState } from '../../hooks/useForumState';
import { applyScenarioPreset } from '../../modules/session.js';

const PRESET_OPTIONS = [
  { value: '', label: '— Apply a preset —' },
  { value: 'brainstorm', label: 'Brainstorm Session' },
  { value: 'risk', label: 'Risk Assessment' },
  { value: 'debate', label: 'Structured Debate' },
  { value: 'retrospective', label: 'Project Retrospective' },
  { value: 'story', label: 'Collaborative Story' },
  { value: 'interview', label: 'Expert Panel Interview' },
  { value: 'improv', label: 'Collaborative Improv' },
  { value: 'problemsolving', label: 'Problem Solving' },
];

export function ScenarioPanel() {
  const mode = useForumState(s => s.scenario?.mode || 'problem');
  const title = useForumState(s => s.scenario?.title || '');
  const premise = useForumState(s => s.scenario?.premise || '');
  const objective = useForumState(s => s.scenario?.objective || '');
  const systems = useForumState(s => s.scenario?.systems || {});
  const actors = useForumState(s => s.actors || []);

  const updateScenario = (key, val) => mutateState(s => { s.scenario[key] = val; });
  const updateSystem = (group, key, val) => {
    mutateState(s => {
      if (!s.scenario.systems) s.scenario.systems = {};
      if (!s.scenario.systems[group]) s.scenario.systems[group] = {};
      s.scenario.systems[group][key] = val;
    });
    saveState();
  };

  const handlePreset = (e) => {
    const key = e.target.value;
    if (!key) return;
    applyScenarioPreset(key);
    e.target.value = '';
  };

  // Warn if DM narrates but an actor is named "Narrator" or "Environment"
  const dmNarrates = systems.dmRole?.narrates ?? (mode === 'story');
  const collisionActors = useMemo(() => {
    if (!dmNarrates) return [];
    return actors.filter(a => a.enabled && /narrator|environment/i.test(`${a.name} ${a.role}`));
  }, [actors, dmNarrates]);

  const stageEnabled = systems.stageDirections?.enabled ?? (mode === 'story');
  const stageIntensity = systems.stageDirections?.intensity ?? 'moderate';
  const stageMaxShare = systems.stageDirections?.maxTokenShare ?? 0.2;
  const alignStrictness = systems.alignment?.strictness ?? (mode === 'problem' ? 'strict' : 'moderate');
  const dmRoleVal = systems.dmRole?.role ?? (mode === 'story' ? 'narrator' : 'facilitator');
  const docSchema = systems.document?.schema ?? (mode === 'story' ? 'story-bible' : mode === 'problem' ? 'findings' : 'freeform');

  return (
    <div>
      <div className="card">
        <div className="card-title"><h3>Scenario Presets</h3></div>
        <select
          style={{ width: '100%', marginBottom: 4 }}
          defaultValue=""
          onChange={handlePreset}
        >
          {PRESET_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <div className="field-hint">Selecting a preset fills in Mode, Title, Premise, Objective, and Systems.</div>
      </div>

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
          {mode === "story" && "Narrative roleplay — actors speak in character. Disable web tools in the Tools panel if you don't want actors to search."}
          {mode === "freeform" && "Open-ended discussion — no structured goal; actors explore freely."}
        </div>
      </div>

      <div className="card">
        <div className="card-title"><h3>Systems</h3></div>

        {collisionActors.length > 0 && (
          <div className="warn-card" style={{ marginBottom: 10 }}>
            ⚠ DM is set to narrate, but {collisionActors.map(a => a.name).join(', ')} has a narrator-like role. Consider disabling or renaming them to avoid narration conflicts.
          </div>
        )}

        <Field label="Stage Directions">
          <Toggle
            checked={stageEnabled}
            onChange={v => updateSystem('stageDirections', 'enabled', v)}
            label={stageEnabled ? 'On — theatrical actions in *asterisks*' : 'Off — analytical forum mode'}
          />
        </Field>

        {stageEnabled && (
          <>
            <Field label="Intensity">
              <select value={stageIntensity} onChange={e => updateSystem('stageDirections', 'intensity', e.target.value)}>
                <option value="minimal">Minimal — actions only when necessary</option>
                <option value="moderate">Moderate — regular action beats</option>
                <option value="immersive">Immersive — rich sensory description</option>
              </select>
            </Field>
            <Field label={`Max stage share — ${Math.round(stageMaxShare * 100)}%`}>
              <input type="range" min={0.1} max={0.6} step={0.05}
                value={stageMaxShare}
                onChange={e => updateSystem('stageDirections', 'maxTokenShare', parseFloat(e.target.value))}
              />
            </Field>
          </>
        )}

        <Field label="DM Role">
          <select value={dmRoleVal} onChange={e => updateSystem('dmRole', 'role', e.target.value)}>
            <option value="narrator">Narrator — describes scene, drives story</option>
            <option value="facilitator">Facilitator — guides discussion, summarizes</option>
            <option value="arbiter">Arbiter — enforces rules, delivers verdicts</option>
            <option value="observer">Observer — silent unless directly addressed</option>
          </select>
        </Field>

        <Field label="DM Narrates">
          <Toggle
            checked={systems.dmRole?.narrates ?? (mode === 'story')}
            onChange={v => updateSystem('dmRole', 'narrates', v)}
            label={systems.dmRole?.narrates ?? (mode === 'story') ? 'On — DM describes scene' : 'Off — DM facilitates only'}
          />
        </Field>

        <Field label="Alignment Strictness">
          <select value={alignStrictness} onChange={e => updateSystem('alignment', 'strictness', e.target.value)}>
            <option value="strict">Strict — hard redirects, alignment enforced</option>
            <option value="moderate">Moderate — gentle nudges when drifting</option>
            <option value="loose">Loose — follow the thread naturally</option>
            <option value="off">Off — no alignment signals</option>
          </select>
        </Field>

        <Field label="Document Schema">
          <select value={docSchema} onChange={e => updateSystem('document', 'schema', e.target.value)}>
            <option value="freeform">Freeform</option>
            <option value="decisions">Decisions — track choices and rationale</option>
            <option value="findings">Findings — structured analysis output</option>
            <option value="story-bible">Story Bible — characters, world, arc</option>
          </select>
        </Field>
      </div>

      <div className="card">
        <div className="card-title"><h3>Core Context</h3><span className="badge">non-compressible</span></div>
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
