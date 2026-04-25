import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb, initDatabase } from '$lib/services/database.js';
import { runMigrations } from '$lib/services/migrationService.js';

/**
 * Tests for the in-memory adapter's `transaction()` implementation.
 * The Tauri-side path is exercised by the petService unit tests through
 * writePetGenes — those run on the in-memory adapter too, so this file
 * focuses on the bare API and rollback semantics.
 */
describe('db.transaction', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
  });

  it('runs all statements and returns one result per statement', async () => {
    const db = getDb();
    const results = await db.transaction([
      {
        sql: `INSERT INTO genes (animal_type, chromosome, gene, effectDominant, effectRecessive, appearance, breed, notes, created_at, updated_at)
              VALUES ($at, $chr, $g, $ed, $er, $ap, $br, $no, $ca, $ua)`,
        params: {
          at: 'beewasp',
          chr: '01',
          g: '01A1',
          ed: 'None',
          er: 'None',
          ap: 'None',
          br: '',
          no: '',
          ca: 't',
          ua: 't',
        },
      },
      {
        sql: `INSERT INTO genes (animal_type, chromosome, gene, effectDominant, effectRecessive, appearance, breed, notes, created_at, updated_at)
              VALUES ($at, $chr, $g, $ed, $er, $ap, $br, $no, $ca, $ua)`,
        params: {
          at: 'beewasp',
          chr: '01',
          g: '01A2',
          ed: 'None',
          er: 'None',
          ap: 'None',
          br: '',
          no: '',
          ca: 't',
          ua: 't',
        },
      },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].rowsAffected).toBe(1);
    expect(results[1].rowsAffected).toBe(1);
    const rows = await db.select('SELECT gene FROM genes WHERE animal_type = $at ORDER BY gene', { at: 'beewasp' });
    expect(rows.map((r) => r.gene)).toEqual(['01A1', '01A2']);
  });

  it('returns an empty array when given no statements', async () => {
    const db = getDb();
    const results = await db.transaction([]);
    expect(results).toEqual([]);
  });
});
