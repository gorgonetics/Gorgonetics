import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '$lib/services/database.js';
import { compareBlockLetters } from '$lib/services/genomeParser.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';
import { fromGeneId, toGeneId } from '$lib/utils/geneAnalysis.js';

const MULTI_BLOCK_BEEWASP = `[Overview]
Format=1.0
Character=Tester
Entity=Multi Block Bee
Genome=BeeWasp

[Genes]
1=DDD RR? xD
2=DR
`;

describe('fromGeneId / toGeneId round-trip', () => {
  it('parses standard gene ids back to chromosome/block/position', () => {
    expect(fromGeneId('01A1')).toEqual({ chromosome: '01', block: 'A', position: 1 });
    expect(fromGeneId('15Z12')).toEqual({ chromosome: '15', block: 'Z', position: 12 });
    expect(fromGeneId('02AA3')).toEqual({ chromosome: '02', block: 'AA', position: 3 });
  });

  it('returns null for malformed ids', () => {
    expect(fromGeneId('1A1')).toBeNull(); // chromosome must be 2 digits
    expect(fromGeneId('01a1')).toBeNull(); // block must be uppercase
    expect(fromGeneId('01A')).toBeNull(); // position required
    expect(fromGeneId('')).toBeNull();
  });

  it('round-trips toGeneId(fromGeneId(x)) === x', () => {
    for (const id of ['01A1', '02B5', '15AA10', '20BC1']) {
      const parts = fromGeneId(id);
      expect(parts).not.toBeNull();
      if (parts) expect(toGeneId(parts)).toBe(id);
    }
  });
});

describe('loadPetGridFromDb', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
  });

  it('builds the per-block grid from pet_genes for an uploaded pet', async () => {
    // MULTI_BLOCK_BEEWASP layout:
    //   chr 01 → A=DDD (3), B=RR? (3), C=xD (2)
    //   chr 02 → A=DR (2)
    const upload = await petService.uploadPet(MULTI_BLOCK_BEEWASP, { name: 'Multi', gender: 'Female' });
    const grid = await petService.loadPetGridFromDb(upload.pet_id);

    expect(Object.keys(grid).sort()).toEqual(['01', '02']);

    expect(grid['01'].blocks.map((b) => b.letter)).toEqual(['A', 'B', 'C']);
    expect(grid['01'].blocks[0].genes.map((g) => g.id)).toEqual(['01A1', '01A2', '01A3']);
    expect(grid['01'].blocks[0].genes.map((g) => g.type)).toEqual(['D', 'D', 'D']);
    expect(grid['01'].blocks[1].genes.map((g) => g.id)).toEqual(['01B1', '01B2', '01B3']);
    expect(grid['01'].blocks[1].genes.map((g) => g.type)).toEqual(['R', 'R', '?']);
    expect(grid['01'].blocks[2].genes.map((g) => g.id)).toEqual(['01C1', '01C2']);
    expect(grid['01'].blocks[2].genes.map((g) => g.type)).toEqual(['x', 'D']);

    // allGenes is the flat list across blocks, with globalPosition starting at 1.
    expect(grid['01'].allGenes.map((g) => g.id)).toEqual([
      '01A1',
      '01A2',
      '01A3',
      '01B1',
      '01B2',
      '01B3',
      '01C1',
      '01C2',
    ]);
    expect(grid['01'].allGenes.map((g) => g.globalPosition)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    expect(grid['02'].blocks.map((b) => b.letter)).toEqual(['A']);
    expect(grid['02'].allGenes.map((g) => g.type)).toEqual(['D', 'R']);
  });

  it('returns an empty record when the pet does not exist at all', async () => {
    // No pets row → fallback can't find genome_data → still {}.
    const grid = await petService.loadPetGridFromDb(9999);
    expect(grid).toEqual({});
  });

  it('falls back to genome_data and re-projects pet_genes when the row set is empty', async () => {
    // Simulates an un-backfilled legacy pet: row exists in `pets`,
    // genome_data is intact, but pet_genes hasn't been populated yet.
    const upload = await petService.uploadPet(MULTI_BLOCK_BEEWASP, { name: 'Legacy', gender: 'Female' });
    const db = (await import('$lib/services/database.js')).getDb();
    await db.execute('DELETE FROM pet_genes WHERE pet_id = $id', { id: upload.pet_id });

    const grid = await petService.loadPetGridFromDb(upload.pet_id);
    // Same shape as the steady-state test above — the fallback must
    // produce identical output to a freshly-projected upload.
    expect(Object.keys(grid).sort()).toEqual(['01', '02']);
    expect(grid['01'].allGenes.map((g) => g.id)).toEqual([
      '01A1',
      '01A2',
      '01A3',
      '01B1',
      '01B2',
      '01B3',
      '01C1',
      '01C2',
    ]);
    expect(grid['02'].allGenes.map((g) => g.id)).toEqual(['02A1', '02A2']);

    // Fallback also writes pet_genes back, so the next call sees rows.
    const writtenRows = await db.select('SELECT COUNT(*) as n FROM pet_genes WHERE pet_id = $id', {
      id: upload.pet_id,
    });
    expect(writtenRows[0].n).toBeGreaterThan(0);
  });
});

describe('compareBlockLetters orders A..Z, AA, AB consistently with blockLetter', () => {
  it('puts single-letter blocks before multi-letter blocks', () => {
    const sorted = ['AA', 'B', 'A', 'BA', 'AB', 'Z'].slice().sort(compareBlockLetters);
    expect(sorted).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'BA']);
  });

  it('returns 0 for equal letters', () => {
    expect(compareBlockLetters('A', 'A')).toBe(0);
    expect(compareBlockLetters('AA', 'AA')).toBe(0);
  });
});
