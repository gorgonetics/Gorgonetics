import { beforeEach, describe, expect, it } from 'vitest';
import { buildInClauseParams, closeDatabase, getDb, initDatabase } from '$lib/services/database.js';

/**
 * The in-memory adapter's WHERE evaluation. Regression guard for the `IN (…)`
 * clause: it previously matched only `col = ?` and silently dropped `IN`
 * conditions, so a subset query returned every row. Real SQLite (Tauri) always
 * honoured `IN`; these tests keep the fallback in step so dev/test reflect
 * production.
 */
describe('InMemoryDatabase — WHERE IN', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    const db = getDb();
    for (const [id, name, species] of [
      [1, 'Bee', 'BeeWasp'],
      [2, 'Horse A', 'Horse'],
      [3, 'Horse B', 'Horse'],
    ] as const) {
      await db.execute(
        `INSERT INTO pets (id, name, species, gender, content_hash, genome_data)
         VALUES ($id, $name, $species, 'Male', $hash, '{}')`,
        { id, name, species, hash: `h${id}` },
      );
    }
  });

  it('returns only the rows whose id is in the list', async () => {
    const { placeholders, params } = buildInClauseParams([2, 3], 'id');
    const rows = await getDb().select<{ id: number }[]>(
      `SELECT id, name FROM pets WHERE id IN (${placeholders})`,
      params,
    );
    expect(rows.map((r) => r.id).sort()).toEqual([2, 3]);
  });

  it('honours IN in a COUNT query', async () => {
    const { placeholders, params } = buildInClauseParams([2, 3], 'id');
    const rows = await getDb().select<{ cnt: number }[]>(
      `SELECT COUNT(*) as cnt FROM pets WHERE id IN (${placeholders})`,
      params,
    );
    expect(rows[0].cnt).toBe(2);
  });

  it('combines IN with an equality condition, consuming params in order', async () => {
    const { placeholders, params } = buildInClauseParams([1, 2, 3], 'id');
    const rows = await getDb().select<{ id: number }[]>(
      `SELECT id FROM pets WHERE species = $species AND id IN (${placeholders})`,
      { species: 'Horse', ...params },
    );
    expect(rows.map((r) => r.id).sort()).toEqual([2, 3]);
  });

  it('matches nothing when no id is in the list', async () => {
    const { placeholders, params } = buildInClauseParams([99], 'id');
    const rows = await getDb().select<{ id: number }[]>(`SELECT id FROM pets WHERE id IN (${placeholders})`, params);
    expect(rows).toEqual([]);
  });
});
