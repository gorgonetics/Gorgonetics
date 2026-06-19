import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '$lib/services/database.js';
import * as geneService from '$lib/services/geneService.js';
import { runMigrations } from '$lib/services/migrationService.js';
import { computeOffspringTrio } from '$lib/services/offspringTrioService.js';
import * as petService from '$lib/services/petService.js';
import { Gender } from '$lib/types/index.js';

/** Three-locus beewasp genome at 01A1, 01A2, 01A3, alleles set per test. */
function beewaspGenome(name, alleles) {
  return `[Overview]
Format=1.0
Character=Tester
Entity=${name}
Genome=BeeWasp

[Genes]
1=${alleles}
`;
}

async function uploadParent(name, gender, alleles) {
  const result = await petService.uploadPet(beewaspGenome(name, alleles), { name, gender });
  expect(result.status).toBe('success');
  const pet = await petService.getPet(result.pet_id);
  expect(pet).not.toBeNull();
  return pet;
}

async function reset() {
  await closeDatabase();
  await initDatabase();
  await runMigrations();
  geneService.clearGeneEffectsCache();
}

/**
 * Register the three test loci:
 *  - 01A1: recessive positive  → x × x yields a new-positive gain
 *  - 01A2: recessive negative  → x × x yields a new risk
 *  - 01A3: dominant  positive  → x × D locks in a homozygous-dominant gain
 */
async function registerGenes() {
  await geneService.upsertGene('beewasp', '01', '01A1', { effectDominant: 'None', effectRecessive: 'Toughness+' });
  await geneService.upsertGene('beewasp', '01', '01A2', { effectDominant: 'None', effectRecessive: 'Speed-' });
  await geneService.upsertGene('beewasp', '01', '01A3', { effectDominant: 'Intelligence+', effectRecessive: 'None' });
  geneService.clearGeneEffectsCache('beewasp');
}

describe('computeOffspringTrio', () => {
  beforeEach(reset);

  it('classifies gain, risk, and locked-in loci for a pair', async () => {
    await registerGenes();
    const father = await uploadParent('Sire', Gender.MALE, 'xxx');
    const mother = await uploadParent('Dam', Gender.FEMALE, 'xxD');

    const { chromosomes, summary } = await computeOffspringTrio(father, mother, { species: 'BeeWasp' });

    expect(summary.totalGenes).toBe(3);
    expect(summary.gains).toBe(2);
    expect(summary.risks).toBe(1);
    expect(summary.lockedIn).toBe(1);
    expect(summary.unknownLoci).toBe(0);

    const genes = chromosomes.flatMap((c) => c.genes);
    const byId = Object.fromEntries(genes.map((g) => [g.geneId, g]));

    expect(byId['01A1'].verdict).toBe('gain');
    expect(byId['01A1'].lockedIn).toBe(false);
    expect(byId['01A1'].dist).toEqual({ D: 0.25, x: 0.5, R: 0.25, unknown: 0 });

    expect(byId['01A2'].verdict).toBe('risk');

    expect(byId['01A3'].verdict).toBe('gain');
    expect(byId['01A3'].lockedIn).toBe(true);
    expect(byId['01A3'].source).toBe('both');
  });

  it('carries the offspring distribution and parent allele types on each entry', async () => {
    await registerGenes();
    const father = await uploadParent('Sire', Gender.MALE, 'DRx');
    const mother = await uploadParent('Dam', Gender.FEMALE, 'RDx');

    const { chromosomes } = await computeOffspringTrio(father, mother, { species: 'BeeWasp' });
    const byId = Object.fromEntries(chromosomes.flatMap((c) => c.genes).map((g) => [g.geneId, g]));

    expect(byId['01A1'].fatherType).toBe('D');
    expect(byId['01A1'].motherType).toBe('R');
    // D × R → all heterozygous.
    expect(byId['01A1'].dist).toEqual({ D: 0, x: 1, R: 0, unknown: 0 });
  });

  it('counts unknown loci when a parent allele is unknown', async () => {
    await registerGenes();
    const father = await uploadParent('Sire', Gender.MALE, '?xx');
    const mother = await uploadParent('Dam', Gender.FEMALE, 'xxx');

    const { summary } = await computeOffspringTrio(father, mother, { species: 'BeeWasp' });
    expect(summary.unknownLoci).toBe(1);
  });

  it('treats an unknown parent allele as having no expressed effect', async () => {
    await registerGenes();
    const father = await uploadParent('Sire', Gender.MALE, '?xx');
    const mother = await uploadParent('Dam', Gender.FEMALE, 'Dxx');

    const { chromosomes } = await computeOffspringTrio(father, mother, { species: 'BeeWasp' });
    const a1 = chromosomes.flatMap((c) => c.genes).find((g) => g.geneId === '01A1');

    // Father's allele is '?', so it expresses nothing knowable.
    expect(a1.fatherType).toBe('?');
    expect(a1.fatherEffect).toBeUndefined();
    // Mother's D allele expresses the dominant effect string.
    expect(a1.motherEffect).toBe('None');
    expect(a1.dist).toEqual({ D: 0, x: 0, R: 0, unknown: 1 });
  });

  it('pairs loci by gene_id, treating a locus absent from one parent as unknown', async () => {
    // Add a fourth locus so the father's genome is longer than the mother's.
    await registerGenes();
    await geneService.upsertGene('beewasp', '01', '01A4', { effectDominant: 'Toughness+', effectRecessive: 'None' });
    geneService.clearGeneEffectsCache('beewasp');

    const father = await uploadParent('Sire', Gender.MALE, 'xxxD');
    const mother = await uploadParent('Dam', Gender.FEMALE, 'xxx');

    const { chromosomes, summary } = await computeOffspringTrio(father, mother, { species: 'BeeWasp' });
    const byId = Object.fromEntries(chromosomes.flatMap((c) => c.genes).map((g) => [g.geneId, g]));

    // The union covers all four loci; 01A4 exists only on the father.
    expect(summary.totalGenes).toBe(4);
    expect(byId['01A4'].fatherType).toBe('D');
    expect(byId['01A4'].motherType).toBeNull();
    // Mother absent → offspring allele is unknowable, not a bogus pairing.
    expect(byId['01A4'].dist).toEqual({ D: 0, x: 0, R: 0, unknown: 1 });
    expect(byId['01A4'].verdict).toBe('neutral');
    expect(byId['01A4'].motherEffect).toBeUndefined();
  });

  it('leaves attribute undefined when dominant and recessive target different attributes', async () => {
    await geneService.upsertGene('beewasp', '01', '01A1', { effectDominant: 'Toughness+', effectRecessive: 'Speed-' });
    await geneService.upsertGene('beewasp', '01', '01A2', { effectDominant: 'Intelligence+', effectRecessive: 'None' });
    geneService.clearGeneEffectsCache('beewasp');
    const father = await uploadParent('Sire', Gender.MALE, 'xx');
    const mother = await uploadParent('Dam', Gender.FEMALE, 'xx');

    const { chromosomes } = await computeOffspringTrio(father, mother, { species: 'BeeWasp' });
    const byId = Object.fromEntries(chromosomes.flatMap((c) => c.genes).map((g) => [g.geneId, g]));

    // Conflicting attributes → no single label.
    expect(byId['01A1'].attribute).toBeUndefined();
    // Single-sided effect → its attribute.
    expect(byId['01A2'].attribute).toBe('Intelligence');
  });

  it('throws when a parent has no projected genome', async () => {
    await registerGenes();
    const father = await uploadParent('Sire', Gender.MALE, 'xxx');
    const ghost = { id: 999999, name: 'Ghost', species: 'BeeWasp' };

    await expect(computeOffspringTrio(father, ghost, { species: 'BeeWasp' })).rejects.toThrow();
  });
});
