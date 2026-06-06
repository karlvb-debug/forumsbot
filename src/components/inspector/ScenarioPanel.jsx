import React, { useMemo } from 'react';
import * as Ic from '../Icons';
import { Field, Toggle } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';
import { navigateToPanel } from '../../hooks/navigation.js';

export function ScenarioPanel() {
  const title = useForumState(s => s.scenario?.title || '');
  const premise = useForumState(s => s.scenario?.premise || '');
  const task = useForumState(s => s.scenario?.task || '');
  const doneWhen = useForumState(s => s.scenario?.doneWhen || '');
  const systems = useForumState(s => s.scenario?.systems || {});
  const actors = useForumState(s => s.actors || []);
  const activeDirector = actors.find(a => a.canDirect && a.enabled) || actors.find(a => a.canDirect);

  const updateScenario = (key, val) => mutateState(s => {
    s.scenario[key] = val;
    if (key === 'task' || key === 'doneWhen') {
      s.autoStop.roundsRun = 0;
      s.autoStop.status = 'Auto-stop ready.';
    }
  });
  const updateSystem = (group, key, val) => {
    // mutateState already persists via saveState — no extra call needed.
    mutateState(s => {
      if (!s.scenario.systems) s.scenario.systems = {};
      if (!s.scenario.systems[group]) s.scenario.systems[group] = {};
      s.scenario.systems[group][key] = val;
    });
  };
  const updateDirectorMode = (role) => {
    // Director mode lives on the director actor (single source of truth). The
    // engine derives narration etc. from it; the legacy scenario.systems.dmRole
    // copy is seed-only and no longer written here.
    mutateState(s => {
      const director = (s.actors || []).find(a => a.canDirect && a.enabled)
        || (s.actors || []).find(a => a.canDirect);
      if (director) director.directorMode = role;
    });
  };

  // Warn if the director is narrating while a non-director actor has a narrator-like name.
  const directorMode = activeDirector?.directorMode || systems.dmRole?.role || 'facilitator';
  const collisionActors = useMemo(() => {
    if (directorMode !== 'narrator') return [];
    return actors.filter(a => a.enabled && !a.canDirect && /narrator|environment/i.test(`${a.name} ${a.role}`));
  }, [actors, directorMode]);

  const stageEnabled = systems.stageDirections?.enabled ?? false;
  const stageIntensity = systems.stageDirections?.intensity ?? 'moderate';
  const stageMaxShare = systems.stageDirections?.maxTokenShare ?? 0.2;
  const alignStrictness = systems.alignment?.strictness ?? 'moderate';
  const allowDirectAddress = systems.turnRouting?.allowDirectAddress ?? true;

  return (
    <div>
      <div className="field-hint" style={{ marginBottom: 12 }}>
        Configure this forum's premise, task, and systems below. For a ready-made
        setup with a recommended cast, start from a{' '}
        <button className="link-btn" onClick={() => navigateToPanel('library')}>blueprint in the Library</button>.
      </div>

      <div className="card">
        <div className="card-title"><h3>Systems</h3></div>

        {collisionActors.length > 0 && (
          <div className="warn-card" style={{ marginBottom: 10 }}>
            ⚠ Director behavior is Narrator, but {collisionActors.map(a => a.name).join(', ')} has a narrator-like role. Consider disabling or renaming to avoid conflicts. Director behavior is also set on the director actor card in{' '}
            <button className="link-btn" onClick={() => navigateToPanel('actors')}>Actors</button>.
          </div>
        )}

        <Field label="Director Behavior" info="How the active Director frames their turns. This is also editable on the Director actor card.">
          <select value={directorMode} onChange={e => updateDirectorMode(e.target.value)}>
            <option value="facilitator">Facilitator — guides discussion, summarizes</option>
            <option value="narrator">Narrator — describes scene, drives story</option>
            <option value="arbiter">Arbiter — enforces rules, delivers verdicts</option>
            <option value="observer">Observer — silent unless directly addressed</option>
          </select>
        </Field>
        {!activeDirector && (
          <div className="field-hint" style={{ marginTop: -4, marginBottom: 8 }}>
            Add or enable a Director actor for this setting to affect director turns.
          </div>
        )}

        <Field label="Stage Directions">
          <Toggle
            checked={stageEnabled}
            onChange={v => updateSystem('stageDirections', 'enabled', v)}
            label={stageEnabled ? 'On — theatrical actions in *asterisks*' : 'Off — analytical forum'}
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

        <Field label="Alignment Strictness" info="How frequently actors are reminded of the scenario's Task. Stricter settings inject periodic reminders more often.">
          <select value={alignStrictness} onChange={e => updateSystem('alignment', 'strictness', e.target.value)}>
            <option value="strict">Strict — task reminder every 3 turns</option>
            <option value="moderate">Moderate — task reminder every 5 turns</option>
            <option value="loose">Loose — task reminder every 8 turns</option>
            <option value="off">Off — no periodic task reminders</option>
          </select>
        </Field>

        <Field label="Speaking Order" info="The resolver picks the next speaker based on conversation context: who was addressed, actor handoffs, recency, and relevance. Falls back to a tiny LLM call only when ambiguous.">
          <span className="field-value muted">Hybrid resolver (automatic)</span>
        </Field>

        <Field label="Direct Addressing">
          <Toggle
            checked={allowDirectAddress}
            onChange={v => updateSystem('turnRouting', 'allowDirectAddress', v)}
            label={allowDirectAddress ? 'On — actors can route to a named speaker' : 'Off — follow the configured turn route'}
          />
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
        <Field label="Task" info="What should the group accomplish? Injected into every actor prompt.">
          <textarea rows={3} value={task} onChange={(e) => updateScenario('task', e.target.value)} />
        </Field>
        <Field label="Done When" info="Concrete completion criteria. Enables the auto-stop judge. Leave blank for open-ended conversations.">
          <textarea rows={2} value={doneWhen} onChange={(e) => updateScenario('doneWhen', e.target.value)} />
        </Field>
      </div>

    </div>
  );
}
