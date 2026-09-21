import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb, initDatabase } from '$lib/services/database.js';
import { CURRENT_SCHEMA_VERSION, getSchemaVersion, runMigrations } from '$lib/services/migrationService.js';

describe('Migration Service', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
  });

  it('fresh database starts at version 0', async () => {
    const version = await getSchemaVersion();
    expect(version).toBe(0);
  });

  it('runMigrations brings database to current version', async () => {
    await runMigrations();
    const version = await getSchemaVersion();
    expect(version).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('CURRENT_SCHEMA_VERSION is a positive integer', () => {
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThan(0);
    expect(Number.isInteger(CURRENT_SCHEMA_VERSION)).toBe(true);
  });

  it('running migrations twice is idempotent', async () => {
    await runMigrations();
    await runMigrations();
    const version = await getSchemaVersion();
    expect(version).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('backfills attributes_measured from the name the readings were recorded in', async () => {
    // v18 stores what eligibility used to re-derive by parsing the current
    // name. Backfilling on either proof — a name that parses, or a value off
    // the default — keeps every animal the old gate admitted and adds the
    // ones it was wrong about; from here a rename cannot change it (#526).
    const db = getDb();
    const insert = (name: string, hash: string, attrs: Record<string, number> = {}) =>
      db.execute(
        `INSERT INTO pets (name, species, gender, content_hash, genome_data, created_at, updated_at,
                           intelligence, toughness)
         VALUES ($name, $species, $gender, $content_hash, $genome_data, $created_at, $updated_at,
                 $intelligence, $toughness)`,
        {
          name,
          species: 'Horse',
          gender: 'Female',
          content_hash: hash,
          genome_data: '{}',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
          intelligence: attrs.intelligence ?? 50,
          toughness: attrs.toughness ?? 50,
        },
      );
    await insert('Kb F 40 80 70 70 70 70 70', 'structured');
    await insert('Dobbin', 'plain');
    // Hand-corrected in the editor under a name that never parsed: the old
    // gate excluded it, and the values prove it was measured.
    await insert('Dobbin the Second', 'edited', { toughness: 83 });

    await runMigrations();

    const rows = await db.select<Array<{ content_hash: string; attributes_measured: number }>>(
      'SELECT content_hash, attributes_measured FROM pets',
    );
    const flagOf = (hash: string) => rows.find((row) => row.content_hash === hash)?.attributes_measured;
    expect(flagOf('structured')).toBe(1);
    expect(flagOf('edited')).toBe(1);
    // NOT NULL DEFAULT 0 in production; the in-memory adapter leaves the
    // column off the row rather than adding it, so accept either.
    expect(flagOf('plain') ?? 0).toBe(0);
  });

  it('creates settings table after migration', async () => {
    await runMigrations();
    const db = (await import('$lib/services/database.js')).getDb();
    const result = await db.execute(
      'INSERT INTO settings (key, value, updated_at) VALUES ($key, $value, $updated_at)',
      { key: 'test', value: '"hello"', updated_at: '2024-01-01' },
    );
    expect(result.rowsAffected).toBe(1);
  });

  it('creates pet_images table after migration', async () => {
    await runMigrations();
    const db = (await import('$lib/services/database.js')).getDb();
    const result = await db.execute(
      `INSERT INTO pets (name, species, gender, content_hash, genome_data, created_at, updated_at)
       VALUES ($name, $species, $gender, $content_hash, $genome_data, $created_at, $updated_at)`,
      {
        name: 'Test',
        species: 'BeeWasp',
        gender: 'Female',
        content_hash: 'mighash',
        genome_data: '{}',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      },
    );
    const imgResult = await db.execute(
      `INSERT INTO pet_images (pet_id, filename, original_name, created_at)
       VALUES ($pet_id, $filename, $original_name, $created_at)`,
      { pet_id: result.lastInsertId, filename: 'test.png', original_name: 'test.png', created_at: '2024-01-01' },
    );
    expect(imgResult.rowsAffected).toBe(1);
  });
});
