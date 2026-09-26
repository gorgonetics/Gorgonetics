import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb, initDatabase } from '$lib/services/database.js';
import { getSchemaVersion, runMigrations } from '$lib/services/migrationService.js';
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

describe('updatePet and the genome', () => {
  beforeEach(reset);

  it('does not rewrite the genome: genome_data is no longer a column', async () => {
    // The genes live in `loci` and the file in `genome_text` (#556). A caller
    // passing the old column changes nothing rather than half-updating a pet.
    const result = await petService.uploadPet(MINIMAL_BEEWASP_GENOME, { name: 'Minimal', gender: 'Female' });
    const before = await lociRow(result.pet_id);
    expect(await petService.updatePet(result.pet_id as number, { genome_data: '{"genes":{}}' })).toBe(false);
    expect(await lociRow(result.pet_id)).toEqual(before);
    expect(await petService.getPetGenomeText(result.pet_id as number)).toBe(MINIMAL_BEEWASP_GENOME);
  });

  it('does not touch the loci when only non-genome fields change', async () => {
    const result = await petService.uploadPet(MINIMAL_BEEWASP_GENOME, { name: 'Minimal', gender: 'Female' });
    const before = await lociRow(result.pet_id);
    await petService.updatePet(result.pet_id as number, { name: 'Renamed' });
    expect(await lociRow(result.pet_id)).toEqual(before);
  });
});

describe('loadAllPetLoci fills an empty column from the genome text', () => {
  beforeEach(reset);

  it('writes the column back for a pet whose column is empty', async () => {
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
    const genomeText = `[Overview]
Format=1.0
Character=Tester
Entity=Legacy Bee
Genome=BeeWasp

[Genes]
1=DR
`;
    const ins = await db.execute(
      `INSERT INTO pets
       (name, species, gender, breed, breeder, content_hash, genome_text, notes,
        created_at, updated_at,
        intelligence, toughness, friendliness, ruggedness, enthusiasm, virility, ferocity, temperament, sort_order,
        starred, stabled, is_pet_quality, positive_genes)
       VALUES ($name, $species, $gender, $breed, $breeder, $content_hash, $genome_text, $notes,
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
        genome_text: genomeText,
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
  /** A database exactly as v18 left it: `pet_genes` rows and no loci columns. */
  const v18WithPet = async (): Promise<number> => {
    await closeDatabase();
    await initDatabase();
    await runMigrations(18);
    const db = getDb();
    const ins = await db.execute(
      `INSERT INTO pets (name, species, gender, content_hash, genome_data, created_at, updated_at)
       VALUES ($name, $species, $gender, $content_hash, $genome_data, $created_at, $updated_at)`,
      {
        name: 'Minimal',
        species: 'BeeWasp',
        gender: 'Female',
        content_hash: 'v18hash',
        // Deliberately not the rows below: the migration must read the rows.
        genome_data: JSON.stringify({ genes: {} }),
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      },
    );
    const id = Number(ins.lastInsertId);
    // Out of locus order, to show the column is canonical.
    for (const [gene, type] of [
      ['01A3', 'x'],
      ['01A1', 'D'],
      ['01A2', 'R'],
    ])
      await db.execute('INSERT INTO pet_genes (pet_id, gene_id, gene_type) VALUES ($pid, $gid, $gt)', {
        pid: id,
        gid: gene,
        gt: type,
      });
    return id;
  };

  it('moves pet_genes rows into the loci column and drops the table', async () => {
    const id = await v18WithPet();
    await runMigrations(19);
    expect((await lociRow(id)).loci).toBe('DRx');
    expect(await lociOf(id)).toEqual([
      ['01A1', 'D'],
      ['01A2', 'R'],
      ['01A3', 'x'],
    ]);
    await expect(getDb().select('SELECT pet_id FROM pet_genes')).resolves.toEqual([]);
  });

  it('leaves a plain v18 database when interrupted, so the next launch migrates again', async () => {
    const id = await v18WithPet();
    const db = getDb();
    const transaction = db.transaction.bind(db);
    // Fail the write transaction partway: after the columns are added, a
    // statement that cannot run. The transaction must roll all of it back.
    db.transaction = async (statements) => {
      db.transaction = transaction;
      return transaction([...statements.slice(0, 3), { sql: 'ALTER TABLE pets ADD COLUMN loci TEXT' }]);
    };
    await expect(runMigrations(19)).rejects.toThrow('duplicate column name');
    expect(await getSchemaVersion()).toBe(18);

    await runMigrations(19);
    expect(await getSchemaVersion()).toBe(19);
    expect((await lociRow(id)).loci).toBe('DRx');
  });
});

describe('migration v20', () => {
  /** A v19 database with one pet that has only `genome_data`, and one with loci. */
  const v19 = async (): Promise<{ legacy: number; current: number }> => {
    await closeDatabase();
    await initDatabase();
    await runMigrations(19);
    const db = getDb();
    const current = (await petService.uploadPet(MINIMAL_BEEWASP_GENOME, { name: 'Current', gender: 'Female' }))
      .pet_id as number;
    const ins = await db.execute(
      `INSERT INTO pets (name, species, gender, content_hash, genome_data, genome_text, created_at, updated_at)
       VALUES ($name, $species, $gender, $content_hash, $genome_data, $genome_text, $created_at, $updated_at)`,
      {
        name: 'Pre-v13',
        species: 'BeeWasp',
        gender: 'Female',
        content_hash: 'prev13',
        genome_data: JSON.stringify({
          genes: {
            '01': [
              { chromosome: '01', block: 'A', position: 2, gene_type: 'x' },
              { chromosome: '01', block: 'A', position: 1, gene_type: 'R' },
            ],
          },
        }),
        genome_text: '',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      },
    );
    return { legacy: Number(ins.lastInsertId), current };
  };

  it('keeps a pre-v13 genome by moving it into loci, then drops genome_data', async () => {
    const { legacy, current } = await v19();
    await runMigrations(20);
    expect(await getSchemaVersion()).toBe(20);
    expect(await lociOf(legacy)).toEqual([
      ['01A1', 'R'],
      ['01A2', 'x'],
    ]);
    expect((await lociRow(current)).loci).toBe('DDD');
    const rows = await getDb().select<Record<string, unknown>[]>('SELECT * FROM pets');
    expect(rows.every((row) => !('genome_data' in row))).toBe(true);
  });

  it('leaves a plain v19 database when interrupted', async () => {
    const { legacy } = await v19();
    const db = getDb();
    const transaction = db.transaction.bind(db);
    db.transaction = async (statements) => {
      db.transaction = transaction;
      return transaction([...statements.slice(0, 1), { sql: 'ALTER TABLE pets ADD COLUMN loci TEXT' }]);
    };
    await expect(runMigrations(20)).rejects.toThrow('duplicate column name');
    expect(await getSchemaVersion()).toBe(19);
    expect((await lociRow(legacy)).loci).toBe('');

    await runMigrations(20);
    expect((await lociRow(legacy)).loci).toBe('Rx');
  });
});
