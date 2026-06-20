import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '$lib/services/database.js';
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
