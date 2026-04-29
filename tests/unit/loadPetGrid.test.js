import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '$lib/services/database.js';
import { compareBlockLetters, genomeToGeneStrings, parseGenome } from '$lib/services/genomeParser.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';
import { fromGeneId, parseGenesByBlock, toGeneId } from '$lib/utils/geneAnalysis.js';

const SAMPLE_BEEWASP = readFileSync(resolve('data/Genes_SampleFaeBee.txt'), 'utf-8');

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

  it('reproduces the structure parseGenesByBlock builds from genome JSON', async () => {
    // Upload a pet, then assert the SQL-loaded grid matches what
    // parseGenesByBlock returns for the same source genome.
    const upload = await petService.uploadPet(MULTI_BLOCK_BEEWASP, { name: 'Multi', gender: 'Female' });
    const grid = await petService.loadPetGridFromDb(upload.pet_id);

    const reference = parseGenesByBlock(genomeToGeneStrings(parseGenome(MULTI_BLOCK_BEEWASP)));

    // Same chromosome set
    expect(Object.keys(grid).sort()).toEqual(Object.keys(reference).sort());

    for (const chr of Object.keys(reference)) {
      const refChr = reference[chr];
      const gotChr = grid[chr];
      expect(gotChr.blocks.length).toBe(refChr.blocks.length);
      // Block letters in matching order
      expect(gotChr.blocks.map((b) => b.letter)).toEqual(refChr.blocks.map((b) => b.letter));
      // Each block's genes match (id, type, position, globalPosition)
      for (let i = 0; i < refChr.blocks.length; i++) {
        expect(gotChr.blocks[i].genes).toEqual(refChr.blocks[i].genes);
      }
      expect(gotChr.allGenes).toEqual(refChr.allGenes);
    }
  });

  it('handles a realistic sample genome with the same parity', async () => {
    const upload = await petService.uploadPet(SAMPLE_BEEWASP, { name: 'Bee', gender: 'Female' });
    const grid = await petService.loadPetGridFromDb(upload.pet_id);
    const reference = parseGenesByBlock(genomeToGeneStrings(parseGenome(SAMPLE_BEEWASP)));

    expect(Object.keys(grid).sort()).toEqual(Object.keys(reference).sort());
    for (const chr of Object.keys(reference)) {
      expect(grid[chr].allGenes).toEqual(reference[chr].allGenes);
    }
  });

  it('returns an empty record when the pet does not exist at all', async () => {
    // No pets row → fallback can't find genome_data → still {}.
    const grid = await petService.loadPetGridFromDb(9999);
    expect(grid).toEqual({});
  });

  it('falls back to genome_data when pet_genes is empty for a real pet', async () => {
    // Simulates an un-backfilled legacy pet: row exists in `pets`,
    // genome_data is intact, but pet_genes hasn't been populated yet.
    const upload = await petService.uploadPet(MULTI_BLOCK_BEEWASP, { name: 'Legacy', gender: 'Female' });
    const db = (await import('$lib/services/database.js')).getDb();
    await db.execute('DELETE FROM pet_genes WHERE pet_id = $id', { id: upload.pet_id });

    const grid = await petService.loadPetGridFromDb(upload.pet_id);
    const reference = parseGenesByBlock(genomeToGeneStrings(parseGenome(MULTI_BLOCK_BEEWASP)));
    expect(Object.keys(grid)).toEqual(Object.keys(reference));
    for (const chr of Object.keys(reference)) {
      expect(grid[chr].allGenes).toEqual(reference[chr].allGenes);
    }

    // Fallback also writes pet_genes back, so the next call sees rows.
    const writtenRows = await db.select('SELECT COUNT(*) as n FROM pet_genes WHERE pet_id = $id', {
      id: upload.pet_id,
    });
    expect(writtenRows[0].n).toBeGreaterThan(0);
  });

  it('lays out single-letter blocks for a typical small genome', async () => {
    // The realistic case: chromosome 01 of MULTI_BLOCK_BEEWASP has
    // blocks A, B, C — verify the loader produces them in order.
    const upload = await petService.uploadPet(MULTI_BLOCK_BEEWASP, { name: 'Multi', gender: 'Female' });
    const grid = await petService.loadPetGridFromDb(upload.pet_id);
    expect(grid['01'].blocks.map((b) => b.letter)).toEqual(['A', 'B', 'C']);
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
