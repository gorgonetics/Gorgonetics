import { beforeEach, describe, expect, it } from 'vitest';
import { rankBreedingPairs } from '$lib/services/breedingService.js';
import { closeDatabase, initDatabase } from '$lib/services/database.js';
import * as geneService from '$lib/services/geneService.js';
import { runMigrations } from '$lib/services/migrationService.js';
import { computeOffspringTrio } from '$lib/services/offspringTrioService.js';
import * as petService from '$lib/services/petService.js';
import type { Pet } from '$lib/types/index.js';
import { Gender } from '$lib/types/index.js';

/** Three-locus beewasp genome at 01A1, 01A2, 01A3, alleles set per test. */
function beewaspGenome(name: string, alleles: string) {
  return `[Overview]
Format=1.0
Character=Tester
Entity=${name}
Genome=BeeWasp

[Genes]
1=${alleles}
`;
}

async function uploadParent(name: string, gender: string, alleles: string): Promise<Pet> {
  const result = await petService.uploadPet(beewaspGenome(name, alleles), { name, gender });
  expect(result.status).toBe('success');
  const pet = await petService.getPet(result.pet_id as number);
  expect(pet).not.toBeNull();
  return pet as Pet;
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
    const a1 = chromosomes.flatMap((c) => c.genes).find((g) => g.geneId === '01A1')!;

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
    const ghost = { id: 999999, name: 'Ghost', species: 'BeeWasp' } as unknown as Pet;

    await expect(computeOffspringTrio(father, ghost, { species: 'BeeWasp' })).rejects.toThrow();
  });
});

describe('computeOffspringTrio — horse chromosome 1 carrier genes (recessive +, dominant -)', () => {
  beforeEach(reset);

  const horseGenome = (name: string, alleles: string) => `[Overview]
Format=1.0
Character=Tester
Entity=${name}
Genome=Horse

[Genes]
1=${alleles}
`;

  async function uploadHorse(name: string, gender: string, alleles: string): Promise<Pet> {
    const result = await petService.uploadPet(horseGenome(name, alleles), { name, gender });
    expect(result.status).toBe('success');
    const pet = await petService.getPet(result.pet_id as number);
    expect(pet).not.toBeNull();
    return pet as Pet;
  }

  // Chromosome-1 horse genes express the beneficial trait only when
  // homozygous-recessive; the dominant allele expresses the harmful version.
  async function registerCarrierGenes() {
    for (const id of ['01A1', '01A2', '01A3']) {
      await geneService.upsertGene('horse', '01', id, { effectDominant: 'Speed-', effectRecessive: 'Speed+' });
    }
    geneService.clearGeneEffectsCache('horse');
  }

  it('reads carrier×carrier as a gain, recessive pair as locked-in, dominant pair as neutral', async () => {
    await registerCarrierGenes();
    // locus 01A1 → x × x, 01A2 → R × R, 01A3 → D × D
    const father = await uploadHorse('Sire', Gender.MALE, 'xRD');
    const mother = await uploadHorse('Dam', Gender.FEMALE, 'xRD');

    const { chromosomes, summary } = await computeOffspringTrio(father, mother, { species: 'Horse' });
    const byId = Object.fromEntries(chromosomes.flatMap((c) => c.genes).map((g) => [g.geneId, g]));

    // Carrier × carrier: both parents show the harmful dominant, but the cross
    // can surface the beneficial recessive (25%) neither parent expresses.
    expect(byId['01A1'].verdict).toBe('gain');
    expect(byId['01A1'].source).toBe('both');
    expect(byId['01A1'].lockedIn).toBe(false);
    expect(byId['01A1'].pPositive).toBeCloseTo(0.25, 10);
    expect(byId['01A1'].pNegative).toBeCloseTo(0.75, 10);
    // Both sides target the same attribute, so it is kept (not ambiguous).
    expect(byId['01A1'].attribute).toBe('Speed');

    // Both recessive: the beneficial trait is locked in (offspring guaranteed RR).
    expect(byId['01A2'].verdict).toBe('gain');
    expect(byId['01A2'].lockedIn).toBe(true);

    // Both dominant: offspring guaranteed to express the harmful dominant; nothing new.
    expect(byId['01A3'].verdict).toBe('neutral');

    expect(summary).toMatchObject({ totalGenes: 3, gains: 2, risks: 0, lockedIn: 1, unknownLoci: 0 });
  });
});

describe('computeOffspringTrio — per-locus score contributions', () => {
  beforeEach(reset);

  /**
   * The contribution lens exists to answer "which loci produced this score",
   * so the sum of what it shows has to be the score the breeding table
   * ranked. Checked against `rankBreedingPairs` itself rather than against a
   * hand-computed constant: a constant would keep passing if both sides
   * drifted together, which is the failure that matters.
   */
  it('sums each locus contribution back to the pair score the ranking produced', async () => {
    await registerGenes();
    const father = await uploadParent('Sire', Gender.MALE, 'xxx');
    const mother = await uploadParent('Dam', Gender.FEMALE, 'xxD');
    const spare = await uploadParent('Spare', Gender.FEMALE, 'DDD');
    const pool = [father, mother, spare];

    const ranked = await rankBreedingPairs({ species: 'BeeWasp', pets: pool });
    const row = ranked.find((r) => r.male.id === father.id && r.female.id === mother.id);
    expect(row).toBeDefined();

    const { chromosomes, summary } = await computeOffspringTrio(father, mother, { species: 'BeeWasp', pool });
    expect(summary.poolScored).toBe(true);

    const genes = chromosomes.flatMap((c) => c.genes);
    const sum = (pick: (g: (typeof genes)[number]) => number) => genes.reduce((acc, g) => acc + pick(g), 0);

    expect(sum((g) => g.contributions.positive)).toBeCloseTo(row!.evPositiveTotal, 10);
    expect(sum((g) => g.contributions.poolGain)).toBeCloseTo(row!.evPositiveWeighted, 10);
    expect(sum((g) => g.contributions.capability)).toBeCloseTo(row!.evCapabilityGain, 10);
  });

  it('attributes each locus by its own slots, and nothing to a locus with no positive slot', async () => {
    await registerGenes();
    const father = await uploadParent('Sire', Gender.MALE, 'xxx');
    const mother = await uploadParent('Dam', Gender.FEMALE, 'xxD');
    const spare = await uploadParent('Spare', Gender.FEMALE, 'DDD');

    const { chromosomes } = await computeOffspringTrio(father, mother, {
      species: 'BeeWasp',
      pool: [father, mother, spare],
    });
    const byId = Object.fromEntries(chromosomes.flatMap((c) => c.genes).map((g) => [g.geneId, g]));

    // 01A1 is recessive-positive; x × x puts 0.25 on the recessive outcome.
    expect(byId['01A1'].contributions.positive).toBeCloseTo(0.25, 10);
    // Only carriers in the pool → the `partial` gap weight, 1.2.
    expect(byId['01A1'].contributions.poolGain).toBeCloseTo(0.3, 10);
    // Pool capability at the slot is 0.5 (carriers, no homozygote); the foal
    // reaches homozygous-recessive a quarter of the time.
    expect(byId['01A1'].contributions.capability).toBeCloseTo(0.125, 10);

    // 01A2 is recessive-negative: no positive slot, so nothing to attribute.
    expect(byId['01A2'].contributions).toEqual({ positive: 0, poolGain: 0, capability: 0 });

    // 01A3 is dominant-positive and x × D, so the foal always expresses it —
    // but the pool already locks it, so it adds no capability.
    expect(byId['01A3'].contributions.positive).toBeCloseTo(1, 10);
    expect(byId['01A3'].contributions.poolGain).toBeCloseTo(0.6, 10);
    expect(byId['01A3'].contributions.capability).toBe(0);
  });

  /**
   * The pool is handed over unfiltered, but `rankBreedingPairs` only ever
   * loads the animals it pairs. A row whose gender is neither — `Gender` is a
   * TypeScript union, not a database constraint — would otherwise feed this
   * view's coverage and tallies alone, and the totals would stop reconciling.
   */
  it('ignores a pool member the ranking would never pair', async () => {
    await registerGenes();
    const father = await uploadParent('Sire', Gender.MALE, 'xxx');
    const mother = await uploadParent('Dam', Gender.FEMALE, 'xxD');
    const neither = await uploadParent('Odd', 'Unknown' as Gender, 'DDD');

    const ranked = await rankBreedingPairs({ species: 'BeeWasp', pets: [father, mother, neither] });
    const row = ranked.find((r) => r.male.id === father.id && r.female.id === mother.id);
    expect(row).toBeDefined();

    const { chromosomes } = await computeOffspringTrio(father, mother, {
      species: 'BeeWasp',
      pool: [father, mother, neither],
    });
    const genes = chromosomes.flatMap((c) => c.genes);
    const sum = (pick: (g: (typeof genes)[number]) => number) => genes.reduce((acc, g) => acc + pick(g), 0);

    expect(sum((g) => g.contributions.poolGain)).toBeCloseTo(row!.evPositiveWeighted, 10);
    expect(sum((g) => g.contributions.capability)).toBeCloseTo(row!.evCapabilityGain, 10);
  });

  it('reports no pool-measured contribution when opened without a pool', async () => {
    await registerGenes();
    const father = await uploadParent('Sire', Gender.MALE, 'xxx');
    const mother = await uploadParent('Dam', Gender.FEMALE, 'xxD');

    const { chromosomes, summary } = await computeOffspringTrio(father, mother, { species: 'BeeWasp' });
    expect(summary.poolScored).toBe(false);

    const genes = chromosomes.flatMap((c) => c.genes);
    // Total + needs only the two parents, so it is still attributed...
    expect(genes.some((g) => g.contributions.positive > 0)).toBe(true);
    // ...but Quality and Pool gain are measured against the rest of the
    // stable, and must read zero rather than fall back to a `missing` gap
    // weight that would invent a pool the caller never supplied.
    expect(genes.every((g) => g.contributions.capability === 0)).toBe(true);
    expect(genes.every((g) => g.contributions.poolGain === 0)).toBe(true);
  });

  /**
   * A locus where both parents are homozygous for the same allele is "locked":
   * every foal is that genotype, so nothing about it can change. It still
   * contributes to Pool gain and Total +, because neither measures a change —
   * both are absolute expected counts of what the foal expresses, and Pool
   * gain only re-weights that count by pool coverage. Quality is the one that
   * differences, so a locked positive contributes exactly nothing to it.
   */
  it('counts a locked positive toward Pool gain and Total + but never toward Quality', async () => {
    await registerGenes();
    // Both parents homozygous dominant at every locus → every locus locked.
    const father = await uploadParent('Sire', Gender.MALE, 'DDD');
    const mother = await uploadParent('Dam', Gender.FEMALE, 'DDD');
    const pool = [father, mother];

    const { chromosomes } = await computeOffspringTrio(father, mother, { species: 'BeeWasp', pool });
    const byId = Object.fromEntries(chromosomes.flatMap((c) => c.genes).map((g) => [g.geneId, g]));

    // 01A3 is dominant-positive, so a D × D lock means the foal always
    // expresses it: full mass on Total +, scaled by the `locked` gap weight
    // (0.6) for Pool gain.
    expect(byId['01A3'].fatherType).toBe('D');
    expect(byId['01A3'].motherType).toBe('D');
    expect(byId['01A3'].contributions.positive).toBeCloseTo(1, 10);
    expect(byId['01A3'].contributions.poolGain).toBeCloseTo(0.6, 10);
    // ...but the pool already breeds it true, so it adds no capability at all.
    expect(byId['01A3'].contributions.capability).toBe(0);

    // 01A1's positive is on the recessive allele, which a D × D pair can never
    // produce — locked, and contributing to nothing.
    expect(byId['01A1'].contributions).toEqual({ positive: 0, poolGain: 0, capability: 0 });
  });

  /**
   * The invariant behind the above, stated over a whole genome rather than one
   * fixture locus: wherever both parents are homozygous for the same allele,
   * that allele is in the pool, so the pool already breeds it true and the
   * marginal capability is zero by construction.
   */
  it('never attributes Quality to a locked locus', async () => {
    await registerGenes();
    const father = await uploadParent('Sire', Gender.MALE, 'DRx');
    const mother = await uploadParent('Dam', Gender.FEMALE, 'DRD');
    const pool = [father, mother];

    const { chromosomes } = await computeOffspringTrio(father, mother, { species: 'BeeWasp', pool });
    const locked = chromosomes
      .flatMap((c) => c.genes)
      .filter((g) => g.fatherType !== null && g.fatherType === g.motherType && g.fatherType !== 'x');

    expect(locked.length).toBeGreaterThan(0);
    expect(locked.every((g) => g.contributions.capability === 0)).toBe(true);
  });

  it('treats an empty pool as no pool', async () => {
    await registerGenes();
    const father = await uploadParent('Sire', Gender.MALE, 'xxx');
    const mother = await uploadParent('Dam', Gender.FEMALE, 'xxD');

    const { summary } = await computeOffspringTrio(father, mother, { species: 'BeeWasp', pool: [] });
    expect(summary.poolScored).toBe(false);
  });
});
