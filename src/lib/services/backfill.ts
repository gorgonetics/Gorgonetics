/**
 * Generic startup-backfill runner. Two guard styles are supported: probe
 * (`guard` omitted, `loadWorkSet`/`computeUpdate` filter naturally — self-
 * heals after backup-restore) and flag (`guard` reads a settings entry,
 * `markDone` writes it — avoids re-scanning large tables every startup).
 */

import { yieldToUI } from '$lib/utils/async.js';

export interface BackfillSpec<Row, Update> {
  /** Used as the prefix for console.info progress logs. */
  label: string;
  /** Rows per batch. Defaults to 16. */
  batchSize?: number;
  /** Returns true to skip the backfill entirely (e.g., a settings flag). */
  guard?: () => Promise<boolean>;
  /** Load the candidate row set; backfill exits early when empty. */
  loadWorkSet: () => Promise<Row[]>;
  /** Compute the per-row update, or null to skip this row. */
  computeUpdate: (row: Row) => Promise<Update | null> | Update | null;
  /**
   * Apply one batch of updates and return the count actually applied. For
   * all-or-nothing implementations (typically `withTransaction` over the
   * whole batch) this is `updates.length`; tolerant per-row writers should
   * return the count of writes that succeeded.
   */
  applyBatch: (updates: Update[]) => Promise<number>;
  /** Optional hook to record completion (e.g., set a settings flag). */
  markDone?: () => Promise<void>;
}

/**
 * Run a startup backfill described by `spec`. Returns `true` when at least
 * one update was applied, `false` when the guard skipped, the work set was
 * empty, or every row's `computeUpdate` returned null.
 *
 * `markDone` runs only on success paths (including no-work-needed) — it
 * never runs after the guard short-circuits, since that's already a "done"
 * signal.
 */
export async function runBatchBackfill<Row, Update>(spec: BackfillSpec<Row, Update>): Promise<boolean> {
  if (spec.guard && (await spec.guard())) return false;

  const rows = await spec.loadWorkSet();
  if (rows.length === 0) {
    await spec.markDone?.();
    return false;
  }

  const batchSize = spec.batchSize ?? 16;
  console.info(`${spec.label}: ${rows.length} rows to process`);

  let applied = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const slice = rows.slice(i, i + batchSize);
    const computed = await Promise.all(slice.map((r) => Promise.resolve(spec.computeUpdate(r))));
    const updates = computed.filter((u): u is Update => u != null);
    if (updates.length > 0) {
      applied += await spec.applyBatch(updates);
    }
    const processed = Math.min(i + batchSize, rows.length);
    console.info(`${spec.label}: ${processed}/${rows.length} (${applied} applied)`);
    if (processed < rows.length) await yieldToUI();
  }

  await spec.markDone?.();
  console.info(`${spec.label}: done`);
  return applied > 0;
}
