import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb, initDatabase } from '$lib/services/database.js';

// The in-memory database is used automatically outside Tauri

describe('Database', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
  });

  it('initializes without error', async () => {
    const db = getDb();
    expect(db).toBeDefined();
  });

  it('creates genes table', async () => {
    const db = getDb();
    const result = await db.execute(
      `INSERT INTO genes (animal_type, chromosome, gene, effectDominant, effectRecessive, appearance, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['test', 'chr01', '01A1', 'Toughness+', 'None', 'Body Color Hue', '', '2024-01-01', '2024-01-01'],
    );
    expect(result.rowsAffected).toBe(1);
  });

  it('creates pets table', async () => {
    const db = getDb();
    const result = await db.execute(
      `INSERT INTO pets (name, species, gender, content_hash, genome_data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['TestPet', 'BeeWasp', 'Female', 'abc123', '{}', '2024-01-01', '2024-01-01'],
    );
    expect(result.rowsAffected).toBe(1);
    expect(result.lastInsertId).toBeGreaterThan(0);
  });

  it('selects inserted genes', async () => {
    const db = getDb();
    await db.execute(
      `INSERT INTO genes (animal_type, chromosome, gene, effectDominant, effectRecessive, appearance, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['beewasp', 'chr01', '01A1', 'Toughness+', 'None', 'Body Color Hue', '', '2024-01-01', '2024-01-01'],
    );

    const rows = await db.select('SELECT * FROM genes WHERE animal_type = ?', ['beewasp']);
    expect(rows).toHaveLength(1);
    expect(rows[0].gene).toBe('01A1');
    expect(rows[0].effectDominant).toBe('Toughness+');
  });

  it('selects distinct animal types', async () => {
    const db = getDb();
    await db.execute(
      `INSERT INTO genes (animal_type, chromosome, gene, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      ['beewasp', 'chr01', '01A1', '2024-01-01', '2024-01-01'],
    );
    await db.execute(
      `INSERT INTO genes (animal_type, chromosome, gene, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      ['horse', 'chr01', '01A1', '2024-01-01', '2024-01-01'],
    );

    const rows = await db.select('SELECT DISTINCT animal_type FROM genes ORDER BY animal_type');
    expect(rows).toHaveLength(2);
    expect(rows[0].animal_type).toBe('beewasp');
    expect(rows[1].animal_type).toBe('horse');
  });

  it('counts rows', async () => {
    const db = getDb();
    await db.execute(
      `INSERT INTO pets (name, species, gender, content_hash, genome_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['Pet1', 'BeeWasp', 'Male', 'hash1', '{}', '2024-01-01', '2024-01-01'],
    );
    await db.execute(
      `INSERT INTO pets (name, species, gender, content_hash, genome_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['Pet2', 'Horse', 'Female', 'hash2', '{}', '2024-01-01', '2024-01-01'],
    );

    const rows = await db.select('SELECT COUNT(*) as cnt FROM pets');
    expect(rows[0].cnt).toBe(2);
  });

  it('updates rows', async () => {
    const db = getDb();
    await db.execute(
      `INSERT INTO genes (animal_type, chromosome, gene, effectDominant, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ['beewasp', 'chr01', '01A1', 'None', '2024-01-01', '2024-01-01'],
    );

    await db.execute('UPDATE genes SET effectDominant = ?, updated_at = ? WHERE animal_type = ? AND gene = ?', [
      'Toughness+',
      '2024-01-02',
      'beewasp',
      '01A1',
    ]);

    const rows = await db.select('SELECT effectDominant FROM genes WHERE gene = ?', ['01A1']);
    expect(rows[0].effectDominant).toBe('Toughness+');
  });

  describe('ORDER BY', () => {
    const INSERT_PET = `INSERT INTO pets (name, species, gender, content_hash, genome_data, toughness, created_at, updated_at)
       VALUES ($name, $species, $gender, $content_hash, $genome_data, $toughness, $created_at, $updated_at)`;

    function petParams(name, hash, toughness = 50) {
      return {
        name,
        species: 'BeeWasp',
        gender: 'Male',
        content_hash: hash,
        genome_data: '{}',
        toughness,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };
    }

    it('sorts ascending by default', async () => {
      const db = getDb();
      await db.execute(INSERT_PET, petParams('Charlie', 'h3'));
      await db.execute(INSERT_PET, petParams('Alice', 'h1'));
      await db.execute(INSERT_PET, petParams('Bob', 'h2'));

      const rows = await db.select('SELECT * FROM pets ORDER BY name');
      expect(rows.map((r) => r.name)).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('sorts descending with DESC', async () => {
      const db = getDb();
      await db.execute(INSERT_PET, petParams('Charlie', 'h3'));
      await db.execute(INSERT_PET, petParams('Alice', 'h1'));
      await db.execute(INSERT_PET, petParams('Bob', 'h2'));

      const rows = await db.select('SELECT * FROM pets ORDER BY name DESC');
      expect(rows.map((r) => r.name)).toEqual(['Charlie', 'Bob', 'Alice']);
    });

    it('sorts numerically for number columns', async () => {
      const db = getDb();
      await db.execute(INSERT_PET, petParams('A', 'h1', 10));
      await db.execute(INSERT_PET, petParams('B', 'h2', 2));
      await db.execute(INSERT_PET, petParams('C', 'h3', 100));

      const rows = await db.select('SELECT * FROM pets ORDER BY toughness');
      expect(rows.map((r) => r.toughness)).toEqual([2, 10, 100]);
    });

    it('supports multi-column ORDER BY', async () => {
      const db = getDb();
      await db.execute(INSERT_PET, petParams('Bob', 'h1', 50));
      await db.execute(INSERT_PET, petParams('Alice', 'h2', 50));
      await db.execute(INSERT_PET, petParams('Charlie', 'h3', 30));

      const rows = await db.select('SELECT * FROM pets ORDER BY toughness, name');
      expect(rows.map((r) => r.name)).toEqual(['Charlie', 'Alice', 'Bob']);
    });

    it('supports mixed ASC/DESC in multi-column ORDER BY', async () => {
      const db = getDb();
      await db.execute(INSERT_PET, petParams('Bob', 'h1', 50));
      await db.execute(INSERT_PET, petParams('Alice', 'h2', 50));
      await db.execute(INSERT_PET, petParams('Charlie', 'h3', 30));

      const rows = await db.select('SELECT * FROM pets ORDER BY toughness, name DESC');
      expect(rows.map((r) => r.name)).toEqual(['Charlie', 'Bob', 'Alice']);
    });
  });

  it('deletes rows', async () => {
    const db = getDb();
    await db.execute(
      `INSERT INTO pets (name, species, gender, content_hash, genome_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['ToDelete', 'BeeWasp', 'Male', 'delhash', '{}', '2024-01-01', '2024-01-01'],
    );

    const before = await db.select('SELECT COUNT(*) as cnt FROM pets');
    expect(before[0].cnt).toBe(1);

    const result = await db.execute('DELETE FROM pets WHERE name = ?', ['ToDelete']);
    expect(result.rowsAffected).toBe(1);

    const after = await db.select('SELECT COUNT(*) as cnt FROM pets');
    expect(after[0].cnt).toBe(0);
  });
});
