/**
 * How well the study pins each breed's base, on the player's real database.
 *
 * Runs the same study the Study tab runs and counts every (breed, attribute)
 * cell by what is known: exact, a two-sided range, one side only, nothing,
 * or crossed bounds. Read-only: the database is snapshotted into a temporary
 * file first, because a study run persists its magnitude table.
 *
 *   pnpm measure:bases
 *   GORGONETICS_DB=/path/to/gorgonetics.db pnpm measure:bases
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterAll, beforeAll, it, vi } from 'vitest';
import type { BaselineReading } from '$lib/utils/attributeStudy.js';

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

vi.mock('$lib/utils/environment.js', () => ({ isTauri: () => true }));
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

type Kind = 'exact' | 'range' | 'upper' | 'lower' | 'unknown' | 'conflict';

function kindOf(r: BaselineReading): Kind {
  if (r.min !== null && r.max !== null) return r.min === r.max ? 'exact' : r.min > r.max ? 'conflict' : 'range';
  if (r.max !== null) return 'upper';
  if (r.min !== null) return 'lower';
  return 'unknown';
}

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

it('measures base bounds per breed and attribute', async () => {
  const { initDatabase } = await import('$lib/services/database.js');
  const { runAttributeStudy, STUDYABLE_SPECIES } = await import('$lib/services/studyService.js');
  const { baseText, breedLabel, gapText } = await import('$lib/utils/baseMatrix.js');
  await initDatabase();

  const lines = [`Snapshot of ${source}`];
  for (const species of STUDYABLE_SPECIES) {
    const run = await runAttributeStudy(species);
    const counts: Record<Kind | 'gap only', number> = {
      exact: 0,
      range: 0,
      upper: 0,
      lower: 0,
      unknown: 0,
      conflict: 0,
      'gap only': 0,
    };
    let throughGap = 0;
    const cells: string[] = [];
    for (const study of run.studies) {
      const { readings, offsets } = study.baselines;
      for (const r of readings) {
        const kind = kindOf(r);
        counts[kind]++;
        if (r.minVia || r.maxVia) throughGap++;
        const via = [
          r.minVia && `≥ via ${breedLabel(r.minVia.breed)}`,
          r.maxVia && `≤ via ${breedLabel(r.maxVia.breed)}`,
        ]
          .filter(Boolean)
          .join(', ');
        cells.push(
          `  ${study.attribute.padEnd(13)} ${breedLabel(r.breed).padEnd(13)} ${baseText(r).padEnd(10)} ${kind.padEnd(8)} lump ${r.value}, ${r.unresolved.length} unresolved, ${r.support} animals${via ? `; ${via}` : ''}`,
        );
      }
      for (const o of offsets) {
        if (readings.some((r) => r.breed === o.breed)) continue;
        counts['gap only']++;
        cells.push(`  ${study.attribute.padEnd(13)} ${breedLabel(o.breed).padEnd(13)} ${gapText(o)}`);
      }
    }
    lines.push(
      '',
      `${species}: ${run.corpus.subjects.length} animals studied`,
      `  ${Object.entries(counts)
        .map(([k, n]) => `${k} ${n}`)
        .join(', ')}; ${throughGap} tightened through a gap`,
      ...cells,
    );
  }
  // Straight to stdout: vitest buffers `console.log` from a passing test.
  process.stdout.write(`${lines.join('\n')}\n`);
});
