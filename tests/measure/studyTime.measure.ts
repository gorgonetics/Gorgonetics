/**
 * How long the study solve takes on the player's real database (#542).
 *
 * Solves the horse corpus three times and logs each run, so a regression in
 * the equation work shows as a number rather than a feeling. Read-only: the
 * database is snapshotted first. `STUDY_OUT` writes the studies as JSON, and
 * `PAIR_BY_ANIMAL=1` runs the cross rounds pair by pair, for comparing the two.
 *
 *   pnpm measure:study
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterAll, beforeAll, it, vi } from 'vitest';

const source =
  process.env.GORGONETICS_DB ?? join(homedir(), 'Library/Application Support/com.gorgonetics.app/gorgonetics.db');
const dir = mkdtempSync(join(tmpdir(), 'gorgonetics-measure-'));
const copy = join(dir, 'gorgonetics.db');
let sqlite: DatabaseSync;

/** tauri-plugin-sql takes positional values; node:sqlite rejects undefined and booleans. */
const bind = (values: unknown[] = []): SQLInputValue[] =>
  values.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : (v as SQLInputValue)));

function run(sql: string, values?: unknown[]) {
  const { changes, lastInsertRowid } = sqlite.prepare(sql).run(...bind(values));
  return { rowsAffected: Number(changes), lastInsertId: Number(lastInsertRowid) };
}

vi.mock('#lib/utils/environment.js', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: async () => ({
      select: async (sql: string, values?: unknown[]) => sqlite.prepare(sql).all(...bind(values)),
      execute: async (sql: string, values?: unknown[]) => run(sql, values),
      close: async () => {},
    }),
  },
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (command: string, args: { statements: Array<{ sql: string; params: unknown[] }> }) => {
    if (command !== 'db_execute_transaction') throw new Error(`unexpected command ${command}`);
    return args.statements.map((s) => {
      const r = run(s.sql, s.params);
      return { rows_affected: r.rowsAffected, last_insert_id: r.lastInsertId };
    });
  },
}));

beforeAll(async () => {
  const live = new DatabaseSync(source, { readOnly: true });
  await backup(live, copy);
  live.close();
  sqlite = new DatabaseSync(copy);
});

afterAll(() => {
  sqlite?.close();
  rmSync(dir, { recursive: true, force: true });
});

it('times the study solve', async () => {
  const { initDatabase } = await import('#lib/services/database.js');
  const { loadStudyCorpus } = await import('#lib/services/studyService.js');
  const { getGeneEffectsCached } = await import('#lib/services/geneService.js');
  const { buildEffectSlots, studyAll } = await import('#lib/utils/attributeStudy.js');
  await initDatabase();
  const { runMigrations } = await import('#lib/services/migrationService.js');
  await runMigrations();
  const effects = await getGeneEffectsCached('horse');
  const slots = buildEffectSlots(effects?.effects ?? {});
  const corpus = await loadStudyCorpus('horse', { requiredGenes: new Set(slots.map((s) => s.gene)) });
  const times: number[] = [];
  let studies: unknown = null;
  for (let run = 0; run < 3; run++) {
    const t0 = performance.now();
    studies = studyAll(corpus.subjects, slots, { pairByAnimal: process.env.PAIR_BY_ANIMAL === '1' });
    times.push(Math.round(performance.now() - t0));
  }
  const out = process.env.STUDY_OUT;
  if (out) writeFileSync(out, JSON.stringify(studies, null, 1));
  console.log(`subjects ${corpus.subjects.length}, solve ms ${times.join(', ')}`);
});
