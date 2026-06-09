import React, { useMemo } from 'react';
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
    mutateState(s => {
      if (!s.scenario.systems) s.scenario.systems = {};
      if (!s.scenario.systems[group]) s.scenario.systems[group] = {};
      s.scenario.systems[group][key] = val;
    });
  };
  const updateDirectorMode = (role) => {
    mutateState(s => {
      const director = (s.actors || []).find(a => a.canDirect && a.enabled)
        || (s.actors || []).find(a => a.canDirect);
      if (director) director.directorMode = role;
    });
  };

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
      <div className="card">
        <div className="card-title"><h3>Core Context</h3><span className="badge">non-compressible</span></div>
        <Field label="Title">
          <input value={title} onChange={e => updateScenario('title', e.target.value)} />
        </Field>
        <Field label="Premise" info="The backstory injected into every actor prompt.">
          <textarea rows={4} value={premise} onChange={e => updateScenario('premise', e.target.value)} />
        </Field>
        <Field label="Task" info="What should the group accomplish?">
          <textarea rows={3} value={task} onChange={e => updateScenario('task', e.target.value)} />
        </Field>
        <Field label="Done When" info="Concrete completion criteria — enables the auto-stop judge. Leave blank for open-ended.">
          <textarea rows={2} value={doneWhen} onChange={e => updateScenario('doneWhen', e.target.value)} />
        </Field>
      </div>

      <div className="card">
        <div className="card-title"><h3>Systems</h3></div>

        {collisionActors.length > 0 && (
          <div className="warn-card" style={{ marginBottom: 10 }}>
            ⚠ Director is set to Narrator but {collisionActors.map(a => a.name).join(', ')} has a narrator-like role — consider disabling or renaming to avoid conflicts. Also editable on the{' '}
            <button className="link-btn" onClick={() => navigateToPanel('actors')}>actor card</button>.
          </div>
        )}

        <Field label="Director Behavior" info="How the active Director frames their turns. Also editable on the Director actor card.">
          <select value={directorMode} onChange={e => updateDirectorMode(e.target.value)}>
            <option value="facilitator">Facilitator — guides discussion, summarizes</option>
            <option value="narrator">Narrator — describes scene, drives story</option>
            <option value="arbiter">Arbiter — enforces rules, delivers verdicts</option>
            <option value="observer">Observer — silent unless directly addressed</option>
          </select>
        </Field>
        {!activeDirector && (
          <div className="field-hint" style={{ marginTop: -4, marginBottom: 8 }}>
            No active Director — add one in <button className="link-btn" onClick={() => navigateToPanel('actors')}>Actors</button>.
          </div>
        )}

        <Field label="Stage Directions" info="Adds theatrical action cues between dialogue (*walks to the window*). Great for roleplay or storytelling; leave off for analytical debates.">
          <Toggle
            checked={stageEnabled}
            onChange={v => updateSystem('stageDirections', 'enabled', v)}
            label={stageEnabled ? 'On — theatrical actions in *asterisks*' : 'Off — analytical forum'}
          />
        </Field>

        {stageEnabled && (
          <>
            <Field label="Intensity" info="How richly actors describe physical actions and environment. Minimal keeps it functional; Immersive adds full sensory detail.">
              <select value={stageIntensity} onChange={e => updateSystem('stageDirections', 'intensity', e.target.value)}>
                <option value="minimal">Minimal — actions only when necessary</option>
                <option value="moderate">Moderate — regular action beats</option>
                <option value="immersive">Immersive — rich sensory description</option>
              </select>
            </Field>
            <Field label={`Max stage share — ${Math.round(stageMaxShare * 100)}%`} info="Maximum fraction of an actor's response that can be stage directions. Prevents physical descriptions from crowding out dialogue.">
              <input type="range" min={0.1} max={0.6} step={0.05}
                value={stageMaxShare}
                onChange={e => updateSystem('stageDirections', 'maxTokenShare', parseFloat(e.target.value))}
              />
            </Field>
          </>
        )}

        <Field label="Alignment Strictness" info="How often actors receive a task reminder. Stricter = more frequent.">
          <select value={alignStrictness} onChange={e => updateSystem('alignment', 'strictness', e.target.value)}>
            <option value="strict">Strict — every 3 turns</option>
            <option value="moderate">Moderate — every 5 turns</option>
            <option value="loose">Loose — every 8 turns</option>
            <option value="off">Off — no reminders</option>
          </select>
        </Field>

        <Field label="Direct Addressing" info="When on, an actor can end their turn by addressing a named peer ('...right, Alex?'), which routes the next turn to that person. When off, the configured turn order is always followed.">
          <Toggle
            checked={allowDirectAddress}
            onChange={v => updateSystem('turnRouting', 'allowDirectAddress', v)}
            label={allowDirectAddress ? 'On — actors can route to a named speaker' : 'Off — follow configured turn order'}
          />
        </Field>
      </div>
    </div>
  );
}
