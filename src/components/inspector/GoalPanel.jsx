import React from 'react';
import { Field, Toggle } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';

export function GoalPanel() {
  const autoStop = useForumState(s => s.autoStop || {});
  const messages = useForumState(s => s.messages || []);

  const update = (key, val) => mutateState(s => { s.autoStop[key] = val; });
  const checkGoalNow = async () => {
    const turns = await import('../../modules/turns.js');
    await turns.judgeGoal(messages.slice(-turns.participantCycleCount()), { manual: true });
  };

  return (
    <div>
      <div className="card">
        <div className="card-title"><h3>Goal</h3><Toggle checked={autoStop.enabled ?? false} onChange={(v) => update('enabled', v)} label="Auto-stop" /></div>
        <Field label="Goal to reach" hint="LLM judge checks this after each round">
          <textarea rows={4} value={autoStop.goal || ''} onChange={(e) => update('goal', e.target.value)} />
        </Field>
      </div>

      <div className="card">
        <div className="card-title"><h3>Stop Conditions</h3></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Toggle checked={autoStop.goalCheckEnabled ?? true} onChange={(v) => update('goalCheckEnabled', v)} label="Judge goal after each round" />
          <Toggle checked={autoStop.stopOnAllSkip ?? true} onChange={(v) => update('stopOnAllSkip', v)} label="Stop when everyone skips" />
          <Toggle checked={autoStop.maxRoundsEnabled ?? true} onChange={(v) => update('maxRoundsEnabled', v)} label="Max rounds" />
        </div>
        <div style={{ marginTop: 10 }}>
          <Field label="Max rounds">
            <input type="number" value={autoStop.maxRounds ?? 12} min={1} max={50}
              onChange={(e) => update('maxRounds', parseInt(e.target.value) || 12)} />
          </Field>
        </div>
      </div>

      <div className="card">
        <div className="card-title"><h3>Status</h3></div>
        <div className="card-row"><span className="lbl">Rounds run</span><span className="val">{autoStop.roundsRun || 0} / {autoStop.maxRounds || 12}</span></div>
        <div className="card-row"><span className="lbl">Status</span><span className="val">{autoStop.status || 'Idle'}</span></div>
        <button className="btn full" style={{ marginTop: 10 }} onClick={checkGoalNow}>Check Goal Now</button>
      </div>
    </div>
  );
}
