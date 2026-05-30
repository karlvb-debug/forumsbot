import React from 'react';
import { Field, Toggle } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';

export function GoalPanel() {
  const autoStop = useForumState(s => s.autoStop || {});
  const messages = useForumState(s => s.messages || []);
  const model = useForumState(s => s.settings?.model || '');
  const objective = useForumState(s => s.scenario?.objective || '');

  const update = (key, val) => mutateState(s => { s.autoStop[key] = val; });

  const checkGoalNow = async () => {
    const turns = await import('../../modules/turns.js');
    await turns.judgeGoal(messages.slice(-turns.participantCycleCount()), { manual: true });
  };

  const handleCopyObjective = () => {
    if (!objective) return;
    // mutateState already persists — no extra saveState needed.
    mutateState(s => { s.autoStop.goal = objective; });
  };

  const canCheck = !!model && !!autoStop.goal?.trim() && messages.length > 0;
  const checkTitle = !model ? 'Choose a model first (Connection panel)'
    : !autoStop.goal?.trim() ? 'Enter a goal above first'
    : messages.length === 0 ? 'No conversation to judge yet'
    : 'Run goal judge against recent messages';

  const goalCheckMissingGoal = (autoStop.goalCheckEnabled ?? true) && !autoStop.goal?.trim();

  return (
    <div>
      <div className="card">
        <div className="card-title"><h3>Goal</h3><Toggle checked={autoStop.enabled ?? false} onChange={(v) => update('enabled', v)} label="Auto-stop" /></div>
        <Field label="Goal to reach" hint="LLM judge checks this after each round">
          <textarea rows={4} value={autoStop.goal || ''} onChange={(e) => update('goal', e.target.value)} />
        </Field>
        {goalCheckMissingGoal && (
          <div className="field-hint hint-warn" style={{ marginTop: 4 }}>
            Goal check is enabled but no goal is set.{' '}
            {objective && (
              <button className="chip-btn" style={{ fontSize: 11 }} onClick={handleCopyObjective}>
                Use objective
              </button>
            )}
          </div>
        )}
      </div>

      <details className="card card-disclosure">
        <summary className="card-title">
          <h3>Stop Conditions</h3>
          <span className="disclosure-sub">goal judge · skip · max rounds</span>
        </summary>
        <div className="disclosure-body">
          <Toggle checked={autoStop.goalCheckEnabled ?? true} onChange={(v) => update('goalCheckEnabled', v)} label="Judge goal after each round" />
          <Toggle checked={autoStop.stopOnAllSkip ?? true} onChange={(v) => update('stopOnAllSkip', v)} label="Stop when everyone skips" />
          <Toggle checked={autoStop.maxRoundsEnabled ?? false} onChange={(v) => update('maxRoundsEnabled', v)} label="Max rounds" />
          <Field label="Max rounds">
            <input type="number" value={autoStop.maxRounds ?? 5} min={1} max={50}
              onChange={(e) => update('maxRounds', parseInt(e.target.value) || 5)}
              disabled={!autoStop.maxRoundsEnabled} />
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
          Check Goal Now
        </button>
      </div>
    </div>
  );
}
