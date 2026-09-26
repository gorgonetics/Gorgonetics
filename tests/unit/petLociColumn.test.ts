import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb, initDatabase } from '$lib/services/database.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';
import { compareGeneIds, decodeLoci, encodeLoci } from '$lib/utils/lociCodec.js';
import { loadAllPetLoci } from '$lib/utils/petLoci.js';

const SAMPLE_BEEWASP = readFileSync(resolve('data/Genes_SampleFaeBee.txt'), 'utf-8');

/**
 * Three-gene beewasp genome — same shape as the one used in positiveGenes
 * tests. After parse it produces exactly three loci at 01A1, 01A2, 01A3
 * with gene_type='D', so tests can assert exact contents.
 */
const MINIMAL_BEEWASP_GENOME = `[Overview]
Format=1.0
Character=Tester
Entity=Minimal Bee
Genome=BeeWasp

[Genes]
1=DDD
`;

const reset = async () => {
  await closeDatabase();
  await initDatabase();
  await runMigrations();
};

const lociRow = async (id: unknown) =>
  (
    await getDb().select<{ loci: string; loci_layout: string }[]>('SELECT loci, loci_layout FROM pets WHERE id = $id', {
      id,
    })
  )[0];

const lociOf = async (id: number) => [...((await loadAllPetLoci([id])).get(id) ?? new Map())];

describe('lociCodec', () => {
  it('orders loci by chromosome, block (A…Z, AA…) and position', () => {
    const ids = ['02A1', '01AA1', '01B2', '01B1', '10A1', '01A1'];
    expect([...ids].sort(compareGeneIds)).toEqual(['01A1', '01B1', '01B2', '01AA1', '02A1', '10A1']);
  });

  it('round-trips a genome and names the layout by its content', async () => {
    const a = await encodeLoci([
      ['01A2', 'R'],
      ['01A1', 'D'],
      ['01A3', 'x'],
    ]);
    expect(a.ids).toBe('01A1,01A2,01A3');
    expect(a.loci).toBe('DRx');
    expect([...(decodeLoci(a.ids.split(','), a.loci) ?? [])]).toEqual([
      ['01A1', 'D'],
      ['01A2', 'R'],
      ['01A3', 'x'],
    ]);
    const b = await encodeLoci([
      ['01A1', '?'],
      ['01A2', 'D'],
      ['01A3', 'R'],
    ]);
    expect(b.layout).toBe(a.layout);
    const other = await encodeLoci([['01A1', 'D']]);
    expect(other.layout).not.toBe(a.layout);
  });

  it('stores an unrecognised genotype as unknown, and rejects a corrupt row', async () => {
    expect((await encodeLoci([['01A1', 'Q']])).loci).toBe('?');
    expect(decodeLoci(['01A1', '01A2'], 'D')).toBeNull();
  });
});

describe('loci are written on upload', () => {
  beforeEach(reset);

  it('stores one character per genome position, in locus order', async () => {
    const result = await petService.uploadPet(MINIMAL_BEEWASP_GENOME, { name: 'Minimal', gender: 'Female' });
    expect((await lociRow(result.pet_id)).loci).toBe('DDD');
    expect(await lociOf(result.pet_id as number)).toEqual([
      ['01A1', 'D'],
      ['01A2', 'D'],
      ['01A3', 'D'],
    ]);
  });

  it('handles a realistic sample genome', async () => {
    const result = await petService.uploadPet(SAMPLE_BEEWASP, { name: 'Bee', gender: 'Female' });
    const row = await lociRow(result.pet_id);
    expect(row.loci.length).toBeGreaterThan(0);
    const [layout] = await getDb().select<{ ids: string }[]>('SELECT ids FROM locus_layouts WHERE layout = $layout', {
      layout: row.loci_layout,
    });
    expect(layout.ids.split(',')).toHaveLength(row.loci.length);
  });
});

describe('updatePet rewrites the loci when the genome changes', () => {
  beforeEach(reset);

  it('replaces the loci, and clears the imported text, when genome_data is updated', async () => {
    const result = await petService.uploadPet(MINIMAL_BEEWASP_GENOME, { name: 'Minimal', gender: 'Female' });

    // Rewrite the genome to have only one gene instead of three.
    const oneGeneJson = JSON.stringify({
      format_version: '1.0',
      breeder: 'Tester',
      name: 'Empty',
      genome_type: 'BeeWasp',
      genes: {
        '01': [{ chromosome: '01', block: 'A', position: 1, gene_type: 'R' }],
      },
    });
    await petService.updatePet(result.pet_id as number, { genome_data: oneGeneJson });

    expect(await lociOf(result.pet_id as number)).toEqual([['01A1', 'R']]);
    // The imported file no longer describes the genome, so sharing must not
    // publish it.
    expect(await petService.getPetGenomeText(result.pet_id as number)).toBe('');
  });

  it('does not touch the loci when only non-genome fields change', async () => {
    const result = await petService.uploadPet(MINIMAL_BEEWASP_GENOME, { name: 'Minimal', gender: 'Female' });
    const before = await lociRow(result.pet_id);
    await petService.updatePet(result.pet_id as number, { name: 'Renamed' });
    expect(await lociRow(result.pet_id)).toEqual(before);
  });
});

describe('loadAllPetLoci fills an empty column from genome_data', () => {
  beforeEach(reset);

  it('writes the column back for a pet imported before it existed', async () => {
    const result = await petService.uploadPet(MINIMAL_BEEWASP_GENOME, { name: 'Minimal', gender: 'Female' });
    await getDb().execute('UPDATE pets SET loci = $empty, loci_layout = $empty WHERE id = $id', {
      empty: '',
      id: result.pet_id,
    });
    expect(await lociOf(result.pet_id as number)).toHaveLength(3);
    expect((await lociRow(result.pet_id)).loci).toBe('DDD');
  });
});

describe('backfillPetLociIfNeeded', () => {
  beforeEach(reset);

  it('fills the column for pets that have none', async () => {
    // Insert a pet via raw SQL bypassing uploadPet so its loci stay empty.
    // All named params — the in-memory adapter needs consistent
    // parameterisation.
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

    await petService.backfillPetLociIfNeeded();
    expect(await lociOf(Number(ins.lastInsertId))).toEqual([
      ['01A1', 'D'],
      ['01A2', 'R'],
    ]);
  });

  it('is a no-op when every pet already has its loci', async () => {
    const result = await petService.uploadPet(MINIMAL_BEEWASP_GENOME, { name: 'Minimal', gender: 'Female' });
    expect(await petService.backfillPetLociIfNeeded()).toBe(false);
    expect((await lociRow(result.pet_id)).loci).toBe('DDD');
  });

  it('handles an empty pets table without error', async () => {
    expect(await petService.backfillPetLociIfNeeded()).toBe(false);
  });
});

describe('migration v19', () => {
  it('moves pet_genes rows into the loci column and drops the table', async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
    const db = getDb();
    // Stand the database back up as v18 saw it: a pet with projected rows,
    // out of locus order to show the column is canonical, and no loci yet.
    const result = await petService.uploadPet(MINIMAL_BEEWASP_GENOME, { name: 'Minimal', gender: 'Female' });
    await db.execute('UPDATE pets SET loci = $empty, loci_layout = $empty WHERE id = $id', {
      empty: '',
      id: result.pet_id,
    });
    await db.execute('CREATE TABLE IF NOT EXISTS pet_genes (pet_id INTEGER, gene_id TEXT, gene_type TEXT)');
    for (const [gene, type] of [
      ['01A3', 'x'],
      ['01A1', 'D'],
      ['01A2', 'R'],
    ])
      await db.execute('INSERT INTO pet_genes (pet_id, gene_id, gene_type) VALUES ($pid, $gid, $gt)', {
        pid: result.pet_id,
        gid: gene,
        gt: type,
      });
    await db.execute('PRAGMA user_version = 18');

    await runMigrations();

    // The rows, not the stored genome (`DDD`), are what readers saw before.
    expect((await lociRow(result.pet_id)).loci).toBe('DRx');
    await expect(db.select('SELECT pet_id FROM pet_genes')).resolves.toEqual([]);
  });
});
