import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb, initDatabase } from '$lib/services/database.js';
import * as geneService from '$lib/services/geneService.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';

const SAMPLE_BEEWASP = readFileSync(resolve('data/Genes_SampleFaeBee.txt'), 'utf-8');

/**
 * Deterministic three-gene beewasp genome used by the tests below. After
 * parsing, the genes land at positions 01A1, 01A2, 01A3 — all dominant (D).
 * Seeding effects for these exact positions gives tests an exact count to
 * assert against.
 */
const MINIMAL_BEEWASP_GENOME = `[Overview]
Format=1.0
Character=Tester
Entity=Minimal Bee
Genome=BeeWasp

[Genes]
1=DDD
`;

/** Genome JSON with no genes — used to force recomputation to drop to 0. */
const EMPTY_GENOME_JSON = JSON.stringify({
  format_version: '1.0',
  breeder: 'Tester',
  name: 'Empty',
  genome_type: 'BeeWasp',
  genes: {},
});

/**
 * Seed exactly two positive dominant effects on the minimal genome. Expected
 * positive_genes count when uploading MINIMAL_BEEWASP_GENOME is therefore 2.
 */
async function seedTwoPositiveEffects() {
  await geneService.upsertGene('beewasp', '01', '01A1', {
    effectDominant: 'Toughness+',
    effectRecessive: 'None',
  });
  await geneService.upsertGene('beewasp', '01', '01A2', {
    effectDominant: 'Intelligence+',
    effectRecessive: 'None',
  });
  // 01A3 is intentionally left unseeded so it does not contribute.
  geneService.clearGeneEffectsCache('beewasp');
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

  it('counts seeded positive-effect genes exactly at upload time', async () => {
    await seedTwoPositiveEffects();
    const result = await petService.uploadPet(MINIMAL_BEEWASP_GENOME, 'Minimal', 'Female');
    const pet = await petService.getPet(result.pet_id);
    expect(pet.positive_genes).toBe(2);
  });

  it('updatePet recomputes positive_genes when genome_data changes', async () => {
    await seedTwoPositiveEffects();
    const result = await petService.uploadPet(MINIMAL_BEEWASP_GENOME, 'Minimal', 'Female');
    const before = await petService.getPet(result.pet_id);
    expect(before.positive_genes).toBe(2);

    // Replace the genome with one that has no genes — recompute must drop the
    // stored count to 0, proving the update hook actually runs.
    await petService.updatePet(result.pet_id, { genome_data: EMPTY_GENOME_JSON });
    const after = await petService.getPet(result.pet_id);
    expect(after.positive_genes).toBe(0);
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
    // Upload first with no effects → stored as 0.
    const upload = await petService.uploadPet(MINIMAL_BEEWASP_GENOME, 'Minimal', 'Female');
    const before = await petService.getPet(upload.pet_id);
    expect(before.positive_genes).toBe(0);

    // Seed effects, reset the idempotency flag, then backfill. The count must
    // now reflect the two seeded positive effects — proving backfill ran.
    await seedTwoPositiveEffects();
    const db = getDb();
    await db.execute('DELETE FROM settings WHERE key = $k', { k: 'pets.positive_genes_backfilled' });
    await petService.backfillPositiveGenesIfNeeded();

    const after = await petService.getPet(upload.pet_id);
    expect(after.positive_genes).toBe(2);
  });

  it('is idempotent — repeated calls do not change the stored count', async () => {
    await seedTwoPositiveEffects();
    const upload = await petService.uploadPet(MINIMAL_BEEWASP_GENOME, 'Minimal', 'Female');
    const first = await petService.getPet(upload.pet_id);
    expect(first.positive_genes).toBe(2);

    await petService.backfillPositiveGenesIfNeeded();
    await petService.backfillPositiveGenesIfNeeded();
    const second = await petService.getPet(upload.pet_id);

    expect(second.positive_genes).toBe(first.positive_genes);
  });

  it('skips recomputation once the flag is set', async () => {
    // First upload + backfill with no effects: count is 0, flag gets set.
    const upload = await petService.uploadPet(MINIMAL_BEEWASP_GENOME, 'Minimal', 'Female');
    await petService.backfillPositiveGenesIfNeeded();
    const before = await petService.getPet(upload.pet_id);
    expect(before.positive_genes).toBe(0);

    // Seed effects now. A fresh backfill would produce count=2, but the flag
    // is already set so the next call must be a no-op.
    await seedTwoPositiveEffects();
    await petService.backfillPositiveGenesIfNeeded();

    const after = await petService.getPet(upload.pet_id);
    expect(after.positive_genes).toBe(0);
  });

  it('returns 0 without throwing when genome_data is malformed JSON', async () => {
    // computePositiveGenesForGenome is defensive — called directly to avoid
    // uploadPet's format validation.
    const n = await petService.computePositiveGenesForGenome('{not valid json', '');
    expect(n).toBe(0);
  });
});
