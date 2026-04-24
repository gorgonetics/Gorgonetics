import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb, initDatabase } from '$lib/services/database.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';

const SAMPLE_BEEWASP = readFileSync(resolve('data/Genes_SampleFaeBee.txt'), 'utf-8');

/**
 * Three-gene beewasp genome — same shape as the one used in positiveGenes
 * tests. After parse it produces exactly three rows at 01A1, 01A2, 01A3
 * with gene_type='D', so tests can assert exact counts.
 */
const MINIMAL_BEEWASP_GENOME = `[Overview]
Format=1.0
Character=Tester
Entity=Minimal Bee
Genome=BeeWasp

[Genes]
1=DDD
`;

describe('pet_genes is populated on upload', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
  });

  it('inserts one pet_genes row per genome position', async () => {
    const result = await petService.uploadPet(MINIMAL_BEEWASP_GENOME, 'Minimal', 'Female');
    const db = getDb();
    const rows = await db.select('SELECT gene_id, gene_type FROM pet_genes WHERE pet_id = $pid ORDER BY gene_id', {
      pid: result.pet_id,
    });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ gene_id: '01A1', gene_type: 'D' });
    expect(rows[1]).toMatchObject({ gene_id: '01A2', gene_type: 'D' });
    expect(rows[2]).toMatchObject({ gene_id: '01A3', gene_type: 'D' });
  });

  it('handles a realistic sample genome', async () => {
    const result = await petService.uploadPet(SAMPLE_BEEWASP, 'Bee', 'Female');
    const db = getDb();
    const [count] = await db.select('SELECT COUNT(*) as n FROM pet_genes WHERE pet_id = $pid', {
      pid: result.pet_id,
    });
    expect(count.n).toBeGreaterThan(0);
  });
});

describe('updatePet rewrites pet_genes when the genome changes', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
  });

  it('replaces rows when genome_data is updated', async () => {
    const result = await petService.uploadPet(MINIMAL_BEEWASP_GENOME, 'Minimal', 'Female');

    // Rewrite the genome to have only one gene instead of three.
    const emptyGenomeJson = JSON.stringify({
      format_version: '1.0',
      breeder: 'Tester',
      name: 'Empty',
      genome_type: 'BeeWasp',
      genes: {
        '01': [{ chromosome: '01', block: 'A', position: 1, gene_type: 'R' }],
      },
    });
    await petService.updatePet(result.pet_id, { genome_data: emptyGenomeJson });

    const db = getDb();
    const rows = await db.select('SELECT gene_id, gene_type FROM pet_genes WHERE pet_id = $pid ORDER BY gene_id', {
      pid: result.pet_id,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gene_id: '01A1', gene_type: 'R' });
  });

  it('does not touch pet_genes when only non-genome fields change', async () => {
    const result = await petService.uploadPet(MINIMAL_BEEWASP_GENOME, 'Minimal', 'Female');
    const db = getDb();
    const [before] = await db.select('SELECT COUNT(*) as n FROM pet_genes WHERE pet_id = $pid', {
      pid: result.pet_id,
    });
    expect(before.n).toBe(3);

    await petService.updatePet(result.pet_id, { name: 'Renamed' });
    const [after] = await db.select('SELECT COUNT(*) as n FROM pet_genes WHERE pet_id = $pid', {
      pid: result.pet_id,
    });
    expect(after.n).toBe(3);
  });
});

describe('deletePet removes a pet and its pet_genes rows', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
  });

  it('drops the pet and its pet_genes rows together', async () => {
    const result = await petService.uploadPet(MINIMAL_BEEWASP_GENOME, 'Minimal', 'Female');
    await petService.deletePet(result.pet_id);
    const db = getDb();
    const [count] = await db.select('SELECT COUNT(*) as n FROM pet_genes WHERE pet_id = $pid', {
      pid: result.pet_id,
    });
    expect(count.n).toBe(0);
  });
});

describe('backfillPetGenesIfNeeded', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
  });

  it('populates rows for pets missing pet_genes entirely', async () => {
    // Insert a pet via raw SQL bypassing uploadPet so pet_genes stays
    // empty for that pet. All named params — the in-memory adapter needs
    // consistent parameterisation.
    const db = getDb();
    const genome = {
      format_version: '1.0',
      breeder: 'Tester',
      name: 'Legacy Bee',
      genome_type: 'BeeWasp',
      genes: {
        '01': [
          { chromosome: '01', block: 'A', position: 1, gene_type: 'D' },
          { chromosome: '01', block: 'A', position: 2, gene_type: 'R' },
        ],
      },
    };
    const ins = await db.execute(
      `INSERT INTO pets
       (name, species, gender, breed, breeder, content_hash, genome_data, notes,
        created_at, updated_at,
        intelligence, toughness, friendliness, ruggedness, enthusiasm, virility, ferocity, temperament, sort_order,
        starred, stabled, is_pet_quality, positive_genes)
       VALUES ($name, $species, $gender, $breed, $breeder, $content_hash, $genome_data, $notes,
               $created_at, $updated_at,
               $intelligence, $toughness, $friendliness, $ruggedness, $enthusiasm, $virility, $ferocity, $temperament, $sort_order,
               $starred, $stabled, $is_pet_quality, $positive_genes)`,
      {
        name: 'Legacy Bee',
        species: 'BeeWasp',
        gender: 'Female',
        breed: '',
        breeder: 'Tester',
        content_hash: 'legacyhash',
        genome_data: JSON.stringify(genome),
        notes: '',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        intelligence: 50,
        toughness: 50,
        friendliness: 50,
        ruggedness: 50,
        enthusiasm: 50,
        virility: 50,
        ferocity: 50,
        temperament: 50,
        sort_order: 0,
        starred: 0,
        stabled: 1,
        is_pet_quality: 0,
        positive_genes: 0,
      },
    );

    await petService.backfillPetGenesIfNeeded();

    const rows = await db.select('SELECT gene_id, gene_type FROM pet_genes WHERE pet_id = $pid ORDER BY gene_id', {
      pid: ins.lastInsertId,
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.gene_id)).toEqual(['01A1', '01A2']);
  });

  it('steady-state run is a no-op when every pet already has rows', async () => {
    const result = await petService.uploadPet(MINIMAL_BEEWASP_GENOME, 'Minimal', 'Female');
    // Second call should find nothing to do and exit without re-inserting.
    await petService.backfillPetGenesIfNeeded();
    const db = getDb();
    const [count] = await db.select('SELECT COUNT(*) as n FROM pet_genes WHERE pet_id = $pid', {
      pid: result.pet_id,
    });
    expect(count.n).toBe(3);
  });

  it('handles an empty pets table without error', async () => {
    await petService.backfillPetGenesIfNeeded();
    const db = getDb();
    const [count] = await db.select('SELECT COUNT(*) as n FROM pet_genes');
    expect(count.n).toBe(0);
  });
});
