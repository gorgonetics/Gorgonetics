import { beforeEach, describe, expect, it } from 'vitest';
import { rankBreedingPairs } from '$lib/services/breedingService.js';
import { closeDatabase, initDatabase } from '$lib/services/database.js';
import * as geneService from '$lib/services/geneService.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';
import { Gender } from '$lib/types/index.js';

/**
 * Three-locus beewasp genome: positions 01A1, 01A2, 01A3 — alleles
 * controlled by the test via the third line. Same body the existing
 * stats tests use; just parameterised on the allele triplet.
 */
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

describe('rankBreedingPairs — pair construction', () => {
  beforeEach(reset);

  it('returns no pairs when only one gender is present', async () => {
    await geneService.upsertGene('beewasp', '01', '01A1', { effectDominant: 'Toughness+', effectRecessive: 'None' });
    geneService.clearGeneEffectsCache('beewasp');
    const m = await uploadParent('M1', Gender.MALE, 'D??');
    const result = await rankBreedingPairs({ species: 'BeeWasp', pets: [m] });
    expect(result).toEqual([]);
  });

  it('returns the cartesian product of males × females', async () => {
    await geneService.upsertGene('beewasp', '01', '01A1', { effectDominant: 'Toughness+', effectRecessive: 'None' });
    geneService.clearGeneEffectsCache('beewasp');
    const m1 = await uploadParent('M1', Gender.MALE, 'D??');
    const m2 = await uploadParent('M2', Gender.MALE, 'R??');
    const f1 = await uploadParent('F1', Gender.FEMALE, 'D??');
    const f2 = await uploadParent('F2', Gender.FEMALE, 'x??');
    const result = await rankBreedingPairs({ species: 'BeeWasp', pets: [m1, m2, f1, f2] });
    expect(result).toHaveLength(4);
    // Order: each male × every female, in input order.
    expect(result.map((r) => [r.male.name, r.female.name])).toEqual([
      ['M1', 'F1'],
      ['M1', 'F2'],
      ['M2', 'F1'],
      ['M2', 'F2'],
    ]);
  });
});

describe('rankBreedingPairs — EV math', () => {
  beforeEach(reset);

  it('matches hand-computed values for a single pair across the Mendelian table', async () => {
    // Three loci with three different effect signatures so the per-attribute
    // breakdown gets exercised:
    //   01A1: dominant=Toughness+   recessive=None
    //   01A2: dominant=Intelligence- recessive=None    (no positive sign)
    //   01A3: dominant=None          recessive=Friendliness+
    await geneService.upsertGene('beewasp', '01', '01A1', { effectDominant: 'Toughness+', effectRecessive: 'None' });
    await geneService.upsertGene('beewasp', '01', '01A2', { effectDominant: 'Intelligence-', effectRecessive: 'None' });
    await geneService.upsertGene('beewasp', '01', '01A3', { effectDominant: 'None', effectRecessive: 'Friendliness+' });
    geneService.clearGeneEffectsCache('beewasp');

    // Parents:
    //   Male:   D x R   → at 01A1 D, 01A2 x, 01A3 R
    //   Female: x R x
    const male = await uploadParent('M', Gender.MALE, 'DxR');
    const female = await uploadParent('F', Gender.FEMALE, 'xRx');

    const [pair] = await rankBreedingPairs({ species: 'BeeWasp', pets: [male, female] });

    // Locus 1: D × x → D=.5, x=.5, R=0, unknown=0 → mixed=.5, Toughness+=1
    // Locus 2: x × R → D=0, x=.5, R=.5, unknown=0 → mixed=.5, no positive (sign is '-')
    // Locus 3: R × x → D=0, x=.5, R=.5, unknown=0 → mixed=.5, Friendliness+=.5
    expect(pair.totalLoci).toBe(3);
    expect(pair.evMixed).toBeCloseTo(1.5, 10);
    expect(pair.evUnknown).toBe(0);
    expect(pair.evPositiveByAttribute.Toughness).toBeCloseTo(1, 10);
    expect(pair.evPositiveByAttribute.Friendliness).toBeCloseTo(0.5, 10);
    expect(pair.evPositiveByAttribute.Intelligence).toBe(0);
    expect(pair.evPositiveTotal).toBeCloseTo(1.5, 10);
  });

  it('counts mixed-EV at every locus, not just attribute-bearing ones', async () => {
    // Only seed an effect for locus 1; loci 2/3 have no genes-table
    // entry and therefore no attribute, but their mixed mass must still
    // count toward EV[mixed] (the predictability metric is gene-agnostic).
    await geneService.upsertGene('beewasp', '01', '01A1', { effectDominant: 'Toughness+', effectRecessive: 'None' });
    geneService.clearGeneEffectsCache('beewasp');

    const male = await uploadParent('M', Gender.MALE, 'xxx');
    const female = await uploadParent('F', Gender.FEMALE, 'xxx');

    const [pair] = await rankBreedingPairs({ species: 'BeeWasp', pets: [male, female] });

    // x × x at every locus → P(x) = 0.5 each, so EV[mixed] = 1.5.
    expect(pair.totalLoci).toBe(3);
    expect(pair.evMixed).toBeCloseTo(1.5, 10);
    expect(pair.evUnknown).toBe(0);
    // Only locus 1 has an attribute, contributing P(D∨x) = 0.75 to Toughness.
    expect(pair.evPositiveByAttribute.Toughness).toBeCloseTo(0.75, 10);
    expect(pair.evPositiveTotal).toBeCloseTo(0.75, 10);
  });

  it('routes unknown alleles to evUnknown without polluting evMixed or evPositive', async () => {
    await geneService.upsertGene('beewasp', '01', '01A1', { effectDominant: 'Toughness+', effectRecessive: 'None' });
    await geneService.upsertGene('beewasp', '01', '01A2', { effectDominant: 'Toughness+', effectRecessive: 'None' });
    await geneService.upsertGene('beewasp', '01', '01A3', { effectDominant: 'Toughness+', effectRecessive: 'None' });
    geneService.clearGeneEffectsCache('beewasp');

    // Male unknown at every locus; female fully observed dominant.
    const male = await uploadParent('M', Gender.MALE, '???');
    const female = await uploadParent('F', Gender.FEMALE, 'DDD');

    const [pair] = await rankBreedingPairs({ species: 'BeeWasp', pets: [male, female] });

    expect(pair.totalLoci).toBe(3);
    expect(pair.evUnknown).toBe(3);
    expect(pair.evMixed).toBe(0);
    expect(pair.evPositiveTotal).toBe(0);
    expect(pair.evPositiveByAttribute.Toughness).toBe(0);
  });
});

describe('rankBreedingPairs — horse breed-locked filtering', () => {
  beforeEach(reset);

  it('skips horse loci breed-locked to a different breed than the offspring breed', async () => {
    // Two horse loci: one breed-locked to Standardbred, one universal.
    // Offspring breed = Ilmarian → Standardbred locus is skipped from
    // every score (totalLoci, evMixed, evPositive).
    await geneService.upsertGene('horse', '01', '01A1', {
      effectDominant: 'Toughness+',
      effectRecessive: 'None',
      breed: 'Standardbred',
    });
    await geneService.upsertGene('horse', '01', '01A2', {
      effectDominant: 'Toughness+',
      effectRecessive: 'None',
      breed: '',
    });
    geneService.clearGeneEffectsCache('horse');

    const horseGenome = (name, alleles) => `[Overview]
Format=1.0
Character=Tester
Entity=${name}
Genome=Horse

[Genes]
1=${alleles}
`;

    const m = await petService.uploadPet(horseGenome('M', 'DD'), { name: 'M', gender: Gender.MALE });
    const f = await petService.uploadPet(horseGenome('F', 'DD'), { name: 'F', gender: Gender.FEMALE });
    expect(m.status).toBe('success');
    expect(f.status).toBe('success');
    const male = await petService.getPet(m.pet_id);
    const female = await petService.getPet(f.pet_id);
    expect(male).not.toBeNull();
    expect(female).not.toBeNull();

    const [withFilter] = await rankBreedingPairs({
      species: 'Horse',
      offspringBreed: 'Ilmarian',
      pets: [male, female],
    });
    expect(withFilter.totalLoci).toBe(1);
    expect(withFilter.evPositiveByAttribute.Toughness).toBeCloseTo(1, 10);

    const [withoutFilter] = await rankBreedingPairs({
      species: 'Horse',
      offspringBreed: 'Standardbred',
      pets: [male, female],
    });
    expect(withoutFilter.totalLoci).toBe(2);
    expect(withoutFilter.evPositiveByAttribute.Toughness).toBeCloseTo(2, 10);
  });
});
