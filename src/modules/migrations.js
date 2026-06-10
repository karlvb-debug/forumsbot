/**
 * Versioned state migrations.
 *
 * Each entry transforms the RAW persisted object (pre-normalization) in
 * place and runs only when the stored `schemaVersion` is older than the
 * migration's version, so old saves pay each migration exactly once instead
 * of every load forever. `normalizeState` calls `runMigrations` first and
 * remains the single rehydration gate, covering every load path
 * (localStorage boot, session load, preset import).
 *
 * Adding a migration:
 *  1. Append an entry with `version: CURRENT_SCHEMA_VERSION + 1`.
 *  2. Bump CURRENT_SCHEMA_VERSION.
 *  3. Keep `migrate` defensive — raw comes from user storage and may be
 *     arbitrarily old or partially corrupt. Throwing skips that migration
 *     but never blocks loading.
 *
 * The remaining legacy migrations still inline in normalizeState (mode →
 * systems, dm → director actor, document/knowledgeBase → documents[],
 * on_every_turn → cadence) should move here incrementally as they are
 * touched; new migrations must not be added to normalizeState.
 */

export const CURRENT_SCHEMA_VERSION = 1;

const MIGRATIONS = [
  {
    version: 1,
    description: 'scenario.objective → scenario.task; autoStop.goal → scenario.doneWhen',
    migrate(raw) {
      const scenario = raw.scenario && typeof raw.scenario === 'object' ? raw.scenario : null;
      if (scenario) {
        if (!scenario.task && scenario.objective) {
          scenario.task = String(scenario.objective).trim();
        }
        delete scenario.objective;
      }
      const autoStop = raw.autoStop && typeof raw.autoStop === 'object' ? raw.autoStop : null;
      if (autoStop && autoStop.goal != null) {
        const legacyGoal = String(autoStop.goal).trim();
        const task = String(scenario?.task || '').trim();
        // Only meaningfully different goals become completion criteria.
        if (legacyGoal && legacyGoal !== task && !String(scenario?.doneWhen || '').trim()) {
          if (scenario) scenario.doneWhen = legacyGoal;
          else raw.scenario = { doneWhen: legacyGoal };
        }
        delete autoStop.goal;
      }
    },
  },
];

/** Apply pending migrations to a raw persisted state object (mutates it). */
export function runMigrations(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const fromVersion = Number(raw.schemaVersion) || 0;
  for (const migration of MIGRATIONS) {
    if (fromVersion >= migration.version) continue;
    try {
      migration.migrate(raw);
    } catch (err) {
      console.warn(`[migrations] v${migration.version} (${migration.description}) failed:`, err?.message || err);
    }
  }
  raw.schemaVersion = CURRENT_SCHEMA_VERSION;
  return raw;
}
