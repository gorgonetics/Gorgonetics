import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '$lib/services/database.js';
import * as geneService from '$lib/services/geneService.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';

/**
 * Three-gene beewasp genome at 01A1 / 01A2 / 01A3, all dominant. Stats
 * tests seed effects on these positions and assert the SQL aggregate
 * picks them up via pre-parsed columns rather than re-parsing JSON.
 */
const MINIMAL_BEEWASP_GENOME = `[Overview]
Format=1.0
Character=Tester
Entity=Minimal Bee
Genome=BeeWasp

[Genes]
1=DDD
`;

async function seedMixedEffects() {
  await geneService.upsertGene('beewasp', '01', '01A1', {
    effectDominant: 'Toughness+',
    effectRecessive: 'None',
  });
  await geneService.upsertGene('beewasp', '01', '01A2', {
    effectDominant: 'Intelligence+',
    effectRecessive: 'None',
  });
  await geneService.upsertGene('beewasp', '01', '01A3', {
    effectDominant: 'Toughness-',
    effectRecessive: 'None',
  });
  geneService.clearGeneEffectsCache('beewasp');
}

describe('getPetGeneStats reads pre-parsed columns', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
    geneService.clearGeneEffectsCache();
  });

  it('aggregates per-attribute counts from pet_genes joined with parsed effects', async () => {
    await seedMixedEffects();
    const result = await petService.uploadPet(MINIMAL_BEEWASP_GENOME, 'Minimal', 'Female');
    const { stats, totalGenes, neutralGenes } = await petService.getPetGeneStats(result.pet_id, 'BeeWasp');

    expect(totalGenes).toBe(3);
    expect(neutralGenes).toBe(0);
    expect(stats.Intelligence).toMatchObject({ positive: 1, negative: 0, dominant: 1 });
    expect(stats.Toughness).toMatchObject({ positive: 1, negative: 1, dominant: 2 });
  });

  it('classifies genes with no parsed effect as neutral', async () => {
    // Only seed two of the three positions; the third has no genes-table
    // entry and must fall through to the neutral bucket.
    await geneService.upsertGene('beewasp', '01', '01A1', {
      effectDominant: 'Toughness+',
      effectRecessive: 'None',
    });
    await geneService.upsertGene('beewasp', '01', '01A2', {
      effectDominant: 'Intelligence+',
      effectRecessive: 'None',
    });
    geneService.clearGeneEffectsCache('beewasp');

    const result = await petService.uploadPet(MINIMAL_BEEWASP_GENOME, 'Minimal', 'Female');
    const { stats, totalGenes, neutralGenes } = await petService.getPetGeneStats(result.pet_id, 'BeeWasp');

    expect(totalGenes).toBe(3);
    expect(neutralGenes).toBe(1);
    expect(stats.Intelligence.positive).toBe(1);
    expect(stats.Toughness.positive).toBe(1);
  });

  it('returns an empty stats record for a pet with no pet_genes rows', async () => {
    // No upload → no pet_genes rows. Stats must still return a fully
    // initialized attribute map so consumers can render zero rows.
    const { stats, totalGenes, neutralGenes } = await petService.getPetGeneStats(9999, 'BeeWasp');
    expect(totalGenes).toBe(0);
    expect(neutralGenes).toBe(0);
    expect(stats.Intelligence).toMatchObject({ positive: 0, negative: 0, dominant: 0, recessive: 0, mixed: 0 });
  });
});

describe('getParsedGenesCached reflects gene edits', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
    geneService.clearGeneEffectsCache();
  });

  it('invalidates when clearGeneEffectsCache is called', async () => {
    await geneService.upsertGene('beewasp', '01', '01A1', {
      effectDominant: 'Toughness+',
      effectRecessive: 'None',
    });
    geneService.clearGeneEffectsCache('beewasp');

    let map = await geneService.getParsedGenesCached('BeeWasp');
    expect(map['01A1']?.dominantSign).toBe('+');
    expect(map['01A1']?.dominantAttribute).toBe('toughness');

    // Edit the gene to a negative effect and invalidate.
    await geneService.upsertGene('beewasp', '01', '01A1', {
      effectDominant: 'Toughness-',
      effectRecessive: 'None',
    });
    geneService.clearGeneEffectsCache('beewasp');

    map = await geneService.getParsedGenesCached('BeeWasp');
    expect(map['01A1']?.dominantSign).toBe('-');
  });
});
