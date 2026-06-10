import { describe, it, expect } from 'vitest';
import { runMigrations, CURRENT_SCHEMA_VERSION } from './migrations.js';

describe('runMigrations', () => {
  it('migrates scenario.objective → task and stamps the schema version', () => {
    const raw = { scenario: { title: 'T', objective: 'Reach a decision' } };
    runMigrations(raw);
    expect(raw.scenario.task).toBe('Reach a decision');
    expect(raw.scenario.objective).toBeUndefined();
    expect(raw.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('keeps an existing task over a legacy objective', () => {
    const raw = { scenario: { task: 'Keep me', objective: 'Ignore me' } };
    runMigrations(raw);
    expect(raw.scenario.task).toBe('Keep me');
  });

  it('migrates autoStop.goal → doneWhen only when meaningfully different from the task', () => {
    const distinct = { scenario: { task: 'Plan X' }, autoStop: { goal: 'X is approved by all' } };
    runMigrations(distinct);
    expect(distinct.scenario.doneWhen).toBe('X is approved by all');
    expect(distinct.autoStop.goal).toBeUndefined();

    const duplicate = { scenario: { task: 'Plan X' }, autoStop: { goal: 'Plan X' } };
    runMigrations(duplicate);
    expect(duplicate.scenario.doneWhen).toBeUndefined();
    expect(duplicate.autoStop.goal).toBeUndefined();
  });

  it('skips migrations the stored state already has', () => {
    const raw = { schemaVersion: CURRENT_SCHEMA_VERSION, scenario: { objective: 'Stale field, post-migration save' } };
    runMigrations(raw);
    // v1 did not run again — the field is left exactly as stored.
    expect(raw.scenario.objective).toBe('Stale field, post-migration save');
    expect(raw.scenario.task).toBeUndefined();
  });

  it('tolerates junk input', () => {
    expect(runMigrations(null)).toBeNull();
    expect(runMigrations(undefined)).toBeUndefined();
    const noScenario = { autoStop: { goal: 'Lonely goal' } };
    runMigrations(noScenario);
    expect(noScenario.scenario.doneWhen).toBe('Lonely goal');
  });
});
