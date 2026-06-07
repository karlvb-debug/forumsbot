import React from 'react';
import { Field, Toggle } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';

export default function AutoStopPanel() {
  const autoStop = useForumState(s => s.autoStop || {});
  const messages = useForumState(s => s.messages || []);
  const model = useForumState(s => s.settings?.model || '');
  const task = useForumState(s => s.scenario?.task || '');
  const doneWhen = useForumState(s => s.scenario?.doneWhen || '');
  const intentPass = useForumState(s => s.settings?.intentPass || 'auto');
  const turnDelay = useForumState(s => s.settings?.turnDelay ?? 0);

  const update = (key, val) => mutateState(s => { s.autoStop[key] = val; });
  const updateSetting = (key, val) => mutateState(s => { s.settings[key] = val; });

  const checkGoalNow = async () => {
    const turns = await import('../../modules/turns.js');
    await turns.judgeGoal([], { manual: true });
  };

  const canCheck = !!model && !!doneWhen.trim() && messages.length > 0;
  const checkTitle = !model ? 'Choose a model first (Connection panel)'
    : !doneWhen.trim() ? 'Set "Done When" in Scenario first'
    : messages.length === 0 ? 'No conversation to judge yet'
    : 'Run goal judge against recent messages';

  return (
    <div>
      <div className="card">
        <div className="card-title"><h3>Auto Stop</h3><Toggle checked={autoStop.enabled ?? false} onChange={(v) => update('enabled', v)} label="Enabled" /></div>

        {task.trim() && (
          <div className="card-row" style={{ marginBottom: 4 }}>
            <span className="lbl">Task</span>
            <span className="val" style={{ whiteSpace: 'pre-wrap' }}>{task}</span>
          </div>
        )}
        {doneWhen.trim() ? (
          <div className="card-row" style={{ marginBottom: 4 }}>
            <span className="lbl">Done When</span>
            <span className="val" style={{ whiteSpace: 'pre-wrap' }}>{doneWhen}</span>
          </div>
        ) : (
          <div className="field-hint" style={{ marginTop: 4, marginBottom: 8 }}>
            Set "Done When" in Scenario to enable automatic completion checks.
          </div>
        )}
      </div>

      <details className="card card-disclosure">
        <summary className="card-title">
          <h3>Stop Conditions</h3>
          <span className="disclosure-sub">goal judge · skip · max rounds</span>
        </summary>
        <div className="disclosure-body">
          <Toggle checked={autoStop.goalCheckEnabled ?? true} onChange={(v) => update('goalCheckEnabled', v)} label="Judge completion after each round" />
          <Toggle checked={autoStop.stopOnAllSkip ?? true} onChange={(v) => update('stopOnAllSkip', v)} label="Stop when everyone skips" />
          <Toggle checked={autoStop.maxRoundsEnabled ?? false} onChange={(v) => update('maxRoundsEnabled', v)} label="Max rounds" />
          <Field label="Max rounds">
            <input type="number" value={autoStop.maxRounds ?? 5} min={1} max={50}
              onChange={(e) => update('maxRounds', parseInt(e.target.value) || 5)}
              disabled={!autoStop.maxRoundsEnabled} />
          </Field>
        </div>
      </details>

      <details className="card card-disclosure">
        <summary className="card-title">
          <h3>Auto-run & Routing</h3>
          <span className="disclosure-sub">speed · speaker selection</span>
        </summary>
        <div className="disclosure-body">
          <Field label="Turn delay (s)" hint="Pause between actor turns when auto-running (0 = instant).">
            <input
              type="number"
              value={turnDelay}
              min={0} max={30} step={0.5}
              onChange={(e) => updateSetting('turnDelay', parseFloat(e.target.value) || 0)}
            />
          </Field>
          <Field label="Speaker selection" hint="How the engine decides who speaks next when multiple candidates are equally scored.">
            <select value={intentPass} onChange={(e) => updateSetting('intentPass', e.target.value)}>
              <option value="auto">Smart — grounded intent (ambiguous turns only)</option>
              <option value="always">Always — reason before every turn</option>
              <option value="off">Off — heuristic name-picker only</option>
            </select>
          </Field>
        </div>
      </details>

      <div className="card">
        <div className="card-title"><h3>Status</h3></div>
        <div className="card-row">
          <span className="lbl">Rounds run</span>
          <span className="val">
            {autoStop.maxRoundsEnabled
              ? `${autoStop.roundsRun || 0} / ${autoStop.maxRounds || 5}`
              : `${autoStop.roundsRun || 0}`}
          </span>
        </div>
        <div className="card-row"><span className="lbl">Status</span><span className="val">{autoStop.status || 'Idle'}</span></div>
        <button className="btn full" style={{ marginTop: 10 }} onClick={checkGoalNow}
          disabled={!canCheck} title={checkTitle}>
          Check Now
        </button>
      </div>
    </div>
  );
}
