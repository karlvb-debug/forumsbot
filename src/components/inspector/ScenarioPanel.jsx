import React, { useMemo } from 'react';
import * as Ic from '../Icons';
import { Field, Toggle, Seg } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';
import { navigateToPanel } from '../../hooks/navigation.js';

export function ScenarioPanel() {
  const mode = useForumState(s => s.scenario?.mode || 'problem');
  const title = useForumState(s => s.scenario?.title || '');
  const premise = useForumState(s => s.scenario?.premise || '');
  const objective = useForumState(s => s.scenario?.objective || '');
  const systems = useForumState(s => s.scenario?.systems || {});
  const actors = useForumState(s => s.actors || []);

  const updateScenario = (key, val) => mutateState(s => { s.scenario[key] = val; });
  const updateSystem = (group, key, val) => {
    // mutateState already persists via saveState — no extra call needed.
    mutateState(s => {
      if (!s.scenario.systems) s.scenario.systems = {};
      if (!s.scenario.systems[group]) s.scenario.systems[group] = {};
      s.scenario.systems[group][key] = val;
    });
  };

  // Warn if the director is in Narrator mode but a non-director actor has a narrator-like name
  const directorMode = actors.find(a => a.canDirect && a.enabled)?.directorMode || 'facilitator';
  const collisionActors = useMemo(() => {
    if (directorMode !== 'narrator') return [];
    return actors.filter(a => a.enabled && !a.canDirect && /narrator|environment/i.test(`${a.name} ${a.role}`));
  }, [actors, directorMode]);

  const stageEnabled = systems.stageDirections?.enabled ?? (mode === 'story');
  const stageIntensity = systems.stageDirections?.intensity ?? 'moderate';
  const stageMaxShare = systems.stageDirections?.maxTokenShare ?? 0.2;
  const alignStrictness = systems.alignment?.strictness ?? (mode === 'problem' ? 'strict' : 'moderate');
  const docSchema = systems.document?.schema ?? (mode === 'story' ? 'story-bible' : mode === 'problem' ? 'findings' : 'freeform');

  return (
    <div>
      <div className="field-hint" style={{ marginBottom: 12 }}>
        Configure this forum's premise, objective, and systems below. For a ready-made
        setup with a recommended cast, start from a{' '}
        <button className="link-btn" onClick={() => navigateToPanel('library')}>blueprint in the Library</button>.
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
            ⚠ Director is in Narrator mode, but {collisionActors.map(a => a.name).join(', ')} has a narrator-like role. Consider disabling or renaming to avoid conflicts. Director mode is set on the director actor card in{' '}
            <button className="link-btn" onClick={() => navigateToPanel('actors')}>Actors</button>.
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

        <Field label="Alignment Strictness" info="How firmly actors are kept on the scenario's Objective. Stricter settings inject 'get back on topic' nudges when the discussion drifts.">
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
