import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb, initDatabase } from '$lib/services/database.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';

const SAMPLE_BEEWASP = readFileSync(resolve('data/Genes_SampleFaeBee.txt'), 'utf-8');

const MINIMAL_BEEWASP_GENOME = `[Overview]
Format=1.0
Character=Tester
Entity=Minimal Bee
Genome=BeeWasp

[Genes]
1=DD?
`;

describe('uploadPet persists gene-count columns', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
  });

  it('writes total/known/unknown counts at upload time', async () => {
    const result = await petService.uploadPet(MINIMAL_BEEWASP_GENOME, 'Minimal', 'Female');
    const pet = await petService.getPet(result.pet_id);
    expect(pet.total_genes).toBe(3);
    expect(pet.known_genes).toBe(2);
    expect(pet.unknown_genes).toBe(1);
    expect(pet.has_unknown_genes).toBe(true);
  });

  it('handles a realistic sample genome', async () => {
    const result = await petService.uploadPet(SAMPLE_BEEWASP, 'Bee', 'Female');
    const pet = await petService.getPet(result.pet_id);
    expect(pet.total_genes).toBeGreaterThan(0);
    expect(pet.known_genes + pet.unknown_genes).toBe(pet.total_genes);
  });
});

describe('updatePet refreshes gene-count columns when genome_data changes', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
  });

  it('rewrites counts when genome_data is replaced', async () => {
    const result = await petService.uploadPet(MINIMAL_BEEWASP_GENOME, 'Minimal', 'Female');
    const before = await petService.getPet(result.pet_id);
    expect(before.total_genes).toBe(3);

    // Empty-genome JSON forces counts to 0 — proves the update hook ran.
    const empty = JSON.stringify({
      format_version: '1.0',
      breeder: 'Tester',
      name: 'Empty',
      genome_type: 'BeeWasp',
      genes: {},
    });
    await petService.updatePet(result.pet_id, { genome_data: empty });

    const after = await petService.getPet(result.pet_id);
    expect(after.total_genes).toBe(0);
    expect(after.known_genes).toBe(0);
    expect(after.unknown_genes).toBe(0);
    expect(after.has_unknown_genes).toBe(false);
  });
});

describe('backfillGeneCountsIfNeeded', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
  });

  it('populates counts for pets inserted before the column existed', async () => {
    const upload = await petService.uploadPet(MINIMAL_BEEWASP_GENOME, 'Minimal', 'Female');
    const db = getDb();

    // Simulate a pre-v11 row by zeroing the columns and clearing the flag.
    await db.execute('UPDATE pets SET total_genes = $t, known_genes = $k, unknown_genes = $u WHERE id = $id', {
      t: 0,
      k: 0,
      u: 0,
      id: upload.pet_id,
    });
    await db.execute('DELETE FROM settings WHERE key = $k', { k: 'pets.gene_counts_backfilled' });

    const wrote = await petService.backfillGeneCountsIfNeeded();
    expect(wrote).toBe(true);

    const pet = await petService.getPet(upload.pet_id);
    expect(pet.total_genes).toBe(3);
    expect(pet.known_genes).toBe(2);
    expect(pet.unknown_genes).toBe(1);
  });

  it('returns false when every pet already has matching counts', async () => {
    // uploadPet writes the counts at insert time, so the backfill has
    // nothing to do — wrote=false avoids a spurious appState reload.
    await petService.uploadPet(MINIMAL_BEEWASP_GENOME, 'Minimal', 'Female');
    expect(await petService.backfillGeneCountsIfNeeded()).toBe(false);
  });

  it('second call short-circuits via the flag', async () => {
    const upload = await petService.uploadPet(MINIMAL_BEEWASP_GENOME, 'Minimal', 'Female');
    const db = getDb();

    // Zero the columns so the first call has real work to do.
    await db.execute('UPDATE pets SET total_genes = $t, known_genes = $k, unknown_genes = $u WHERE id = $id', {
      t: 0,
      k: 0,
      u: 0,
      id: upload.pet_id,
    });
    await db.execute('DELETE FROM settings WHERE key = $k', { k: 'pets.gene_counts_backfilled' });

    expect(await petService.backfillGeneCountsIfNeeded()).toBe(true);
    expect(await petService.backfillGeneCountsIfNeeded()).toBe(false);
  });
});
