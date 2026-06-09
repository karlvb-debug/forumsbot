import React from 'react';
import { useForumState } from '../hooks/useForumState';

/**
 * ReadinessStrip — a thin status bar below the transcript that shows
 * green/amber/red indicators for key session readiness checks.
 */
export function ReadinessStrip() {
  const model = useForumState(s => s.settings?.model?.trim() || '');
  const actors = useForumState(s => s.actors || []);
  const memoryEnabled = useForumState(s => s.memory?.enabled ?? false);
  const autoStop = useForumState(s => s.autoStop || {});
  const scenario = useForumState(s => s.scenario || {});

  const enabledActors = actors.filter(a => a.enabled);
  const hasActors = enabledActors.length > 0;

  const checks = [
    {
      key: 'model',
      label: model ? `Model: ${model.length > 24 ? model.slice(0, 22) + '…' : model}` : 'No model',
      ok: !!model,
    },
    {
      key: 'actors',
      label: hasActors ? `${enabledActors.length} actor${enabledActors.length !== 1 ? 's' : ''}` : 'No actors',
      ok: hasActors,
    },
    {
      key: 'memory',
      label: memoryEnabled ? 'Memory on' : 'Memory off',
      ok: memoryEnabled,
      warn: !memoryEnabled,
    },
    ...(autoStop.enabled && (autoStop.goalCheckEnabled ?? true) && !scenario.doneWhen?.trim()
      ? [{
          key: 'goal',
          label: 'No completion criteria set',
          ok: false,
          warn: true,
        }]
      : []),
  ];

  const allOk = checks.every(c => c.ok);
  if (allOk) return null;

  return (
    <div className="readiness-strip">
      {checks.map(c => {
        const color = c.ok ? 'var(--ok)' : c.warn ? 'var(--warn)' : 'var(--danger)';
        return (
          <span key={c.key} className="readiness-chip" style={{ '--chip': color }}>
            <span className="readiness-dot" />
            {c.label}
          </span>
        );
      })}
    </div>
  );
}
