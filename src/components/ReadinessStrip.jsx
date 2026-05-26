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
    ...(autoStop.enabled && !autoStop.goal?.trim()
      ? [{
          key: 'goal',
          label: 'Auto-stop: no goal',
          ok: false,
          warn: true,
        }]
      : []),
  ];

  const allOk = checks.every(c => c.ok);
  if (allOk) return null;

  return (
    <div
      className="readiness-strip"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        padding: '4px 12px',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-raised, rgba(0,0,0,0.15))',
        fontSize: 11,
      }}
    >
      {checks.map(c => {
        const color = c.ok ? 'var(--ok, #4caf50)' : c.warn ? 'var(--warn, #ff9800)' : 'var(--danger, #f44336)';
        return (
          <span
            key={c.key}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 6px',
              borderRadius: 10,
              background: `${color}22`,
              color,
              border: `1px solid ${color}66`,
              fontWeight: 500,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
            {c.label}
          </span>
        );
      })}
    </div>
  );
}
