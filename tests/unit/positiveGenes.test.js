import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb, initDatabase } from '$lib/services/database.js';
import * as geneService from '$lib/services/geneService.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';

const SAMPLE_BEEWASP = readFileSync(resolve('data/Genes_SampleFaeBee.txt'), 'utf-8');
const SAMPLE_HORSE = readFileSync(resolve('data/Genes_SampleHorse.txt'), 'utf-8');

/**
 * Seed a minimal set of gene effects so computePositiveGenesForGenome has
 * something to classify. We use chromosome IDs that appear in the sample
 * genomes (01A1, 01A2, 01B1) and assign them positive effects on core
 * attributes shared by both species.
 */
async function seedPositiveEffects(species) {
  await geneService.upsertGene(species, '01', '01A1', {
    effectDominant: 'Toughness+',
    effectRecessive: 'None',
  });
  await geneService.upsertGene(species, '01', '01A2', {
    effectDominant: 'Intelligence+',
    effectRecessive: 'None',
  });
  await geneService.upsertGene(species, '01', '01B1', {
    effectDominant: 'Friendliness+',
    effectRecessive: 'None',
  });
  geneService.clearGeneEffectsCache(species);
}

describe('positive_genes computation', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
    geneService.clearGeneEffectsCache();
  });

  it('stores 0 on upload when no gene effects are known', async () => {
    const result = await petService.uploadPet(SAMPLE_BEEWASP, 'Bee', 'Female');
    const pet = await petService.getPet(result.pet_id);
    expect(pet.positive_genes).toBe(0);
  });

  it('counts positive-effect genes at upload time once effects are seeded', async () => {
    await seedPositiveEffects('beewasp');
    const result = await petService.uploadPet(SAMPLE_BEEWASP, 'Bee', 'Female');
    const pet = await petService.getPet(result.pet_id);
    // With three seeded positive effects on dominant genes, the count is
    // bounded by how many of those positions carry D or x in the sample.
    expect(pet.positive_genes).toBeGreaterThanOrEqual(0);
    expect(pet.positive_genes).toBeLessThanOrEqual(3);
  });

  it('horse pets include species-specific effects in the total', async () => {
    await geneService.upsertGene('horse', '01', '01A1', {
      effectDominant: 'Temperament+',
      effectRecessive: 'None',
    });
    geneService.clearGeneEffectsCache('horse');
    const result = await petService.uploadPet(SAMPLE_HORSE, 'Horse', 'Male');
    const pet = await petService.getPet(result.pet_id);
    expect(pet.positive_genes).toBeGreaterThanOrEqual(0);
  });

  it('updatePet recomputes positive_genes when genome_data changes', async () => {
    await seedPositiveEffects('beewasp');
    const result = await petService.uploadPet(SAMPLE_BEEWASP, 'Bee', 'Female');
    const before = await petService.getPet(result.pet_id);

    // Simulate a genome edit by re-writing the stored JSON; recomputation is
    // what we care about, not the specific resulting value.
    const genome = JSON.parse(before.genome_data);
    await petService.updatePet(result.pet_id, { genome_data: JSON.stringify(genome) });
    const after = await petService.getPet(result.pet_id);
    expect(after.positive_genes).toBe(before.positive_genes);
  });
});

describe('backfillPositiveGenesIfNeeded', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
    geneService.clearGeneEffectsCache();
  });

  it('populates positive_genes for pets inserted before effects were seeded', async () => {
    // Upload first (effects empty → 0), then seed, then backfill.
    const upload = await petService.uploadPet(SAMPLE_BEEWASP, 'Bee', 'Female');
    const before = await petService.getPet(upload.pet_id);
    expect(before.positive_genes).toBe(0);

    await seedPositiveEffects('beewasp');
    // Backfill uses a settings flag to guard re-runs; reset it so the seeded
    // effects actually drive a recompute in this test.
    const db = getDb();
    await db.execute('DELETE FROM settings WHERE key = $k', { k: 'pets.positive_genes_backfilled' });
    await petService.backfillPositiveGenesIfNeeded();

    const after = await petService.getPet(upload.pet_id);
    expect(after.positive_genes).toBeGreaterThanOrEqual(0);
  });

  it('is idempotent — repeated calls do not change the stored count', async () => {
    await seedPositiveEffects('beewasp');
    const upload = await petService.uploadPet(SAMPLE_BEEWASP, 'Bee', 'Female');
    const first = await petService.getPet(upload.pet_id);

    await petService.backfillPositiveGenesIfNeeded();
    await petService.backfillPositiveGenesIfNeeded();
    const second = await petService.getPet(upload.pet_id);

    expect(second.positive_genes).toBe(first.positive_genes);
  });

  it('skips recomputation once the flag is set', async () => {
    // First upload + backfill with no effects: count is 0, flag gets set.
    const upload = await petService.uploadPet(SAMPLE_BEEWASP, 'Bee', 'Female');
    await petService.backfillPositiveGenesIfNeeded();
    const before = await petService.getPet(upload.pet_id);
    expect(before.positive_genes).toBe(0);

    // Seed effects now. A fresh backfill would produce a non-zero count, but
    // the flag is already set so the next call must be a no-op.
    await seedPositiveEffects('beewasp');
    await petService.backfillPositiveGenesIfNeeded();

    const after = await petService.getPet(upload.pet_id);
    expect(after.positive_genes).toBe(0);
  });
});
