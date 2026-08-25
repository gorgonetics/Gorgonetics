import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '$lib/services/database.js';
import * as geneService from '$lib/services/geneService.js';
import { safeCullSet, scoreStable } from '$lib/services/geneticQualityService.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';
import { Gender, type Pet } from '$lib/types/index.js';

/**
 * Three-locus beewasp genome; the third line carries the alleles. Same
 * fixture shape the breeding-service tests use.
 */
function genome(name: string, alleles: string) {
  return `[Overview]
Format=1.0
Character=Tester
Entity=${name}
Genome=BeeWasp

[Genes]
1=${alleles}
`;
}

async function upload(name: string, gender: Gender, alleles: string): Promise<Pet> {
  const result = await petService.uploadPet(genome(name, alleles), { name, gender });
  expect(result.status).toBe('success');
  const pet = await petService.getPet(result.pet_id as number);
  expect(pet).not.toBeNull();
  return pet as Pet;
}

/**
 * `01A1` mirrors the horse chromosome-01 shape — dominant negative,
 * recessive positive — so the recessive allele carries two benefits and the
 * dominant allele carries only liability. `01A2` is a plain dominant
 * positive. `01A3` is inert.
 */
async function seedGenes() {
  await geneService.upsertGene('beewasp', '01', '01A1', {
    effectDominant: 'Toughness-',
    effectRecessive: 'Intelligence+',
  });
  await geneService.upsertGene('beewasp', '01', '01A2', {
    effectDominant: 'Friendliness+',
    effectRecessive: 'None',
  });
  await geneService.upsertGene('beewasp', '01', '01A3', {
    effectDominant: 'None',
    effectRecessive: 'None',
  });
  geneService.clearGeneEffectsCache('beewasp');
}

async function reset() {
  await closeDatabase();
  await initDatabase();
  await runMigrations();
  geneService.clearGeneEffectsCache();
  await seedGenes();
}

describe('scoreStable', () => {
  beforeEach(reset);

  it('returns an entry for every input pet', async () => {
    const pets = [
      await upload('A', Gender.MALE, 'RDx'),
      await upload('B', Gender.FEMALE, 'DDx'),
      await upload('C', Gender.MALE, 'DDx'),
    ];
    const { scores, meaningful } = await scoreStable({ species: 'BeeWasp', pets });
    expect([...scores.keys()].sort()).toEqual(pets.map((p) => p.id).sort());
    expect(meaningful).toBe(true);
  });

  it('credits the sole holder of a recessive positive and nobody else', async () => {
    const sole = await upload('Sole', Gender.FEMALE, 'RDx');
    const others = [await upload('X', Gender.MALE, 'DDx'), await upload('Y', Gender.MALE, 'DDx')];
    const { scores, shares } = await scoreStable({ species: 'BeeWasp', pets: [sole, ...others] });

    // 01A1: recessive allele carries two benefits (Intelligence+ and clearing
    // Toughness−), nobody else carries it → capability 0 → 1.
    expect(scores.get(sole.id)?.atRiskCapability).toBeCloseTo(2, 10);
    expect(scores.get(sole.id)?.soleSourceSlots).toBe(2);
    for (const o of others) {
      expect(scores.get(o.id)?.atRiskCapability).toBe(0);
    }
    // The whole stable's irreplaceable capability sits in one animal.
    expect(shares.get(sole.id)).toBeCloseTo(100, 10);
    expect(shares.get(others[0].id)).toBe(0);
  });

  it('flags a population too small to discriminate', async () => {
    const pets = [await upload('A', Gender.MALE, 'RDx'), await upload('B', Gender.FEMALE, 'DDx')];
    expect((await scoreStable({ species: 'BeeWasp', pets })).meaningful).toBe(false);
  });

  it('returns empty for an empty stable rather than dividing by zero', async () => {
    const result = await scoreStable({ species: 'BeeWasp', pets: [] });
    expect(result.scores.size).toBe(0);
    expect(result.shares.size).toBe(0);
    expect(result.meaningful).toBe(false);
  });

  it('scores relative to the set it is given, not the whole database', async () => {
    const a = await upload('A', Gender.FEMALE, 'RDx');
    const b = await upload('B', Gender.MALE, 'RDx');
    const c = await upload('C', Gender.MALE, 'DDx');
    // A and B are mutually redundant → neither is irreplaceable.
    const both = await scoreStable({ species: 'BeeWasp', pets: [a, b, c] });
    expect(both.scores.get(a.id)?.atRiskCapability).toBe(0);
    // Drop B from the population and A becomes the sole source.
    const withoutB = await scoreStable({ species: 'BeeWasp', pets: [a, c] });
    expect(withoutB.scores.get(a.id)?.atRiskCapability).toBeCloseTo(2, 10);
  });
});

describe('safeCullSet', () => {
  beforeEach(reset);

  it('releases redundant animals but never the last source', async () => {
    // Two carriers of the recessive positive plus four animals without it.
    const carriers = [await upload('C1', Gender.FEMALE, 'xDx'), await upload('C2', Gender.MALE, 'xDx')];
    const rest = [
      await upload('R1', Gender.MALE, 'DDx'),
      await upload('R2', Gender.MALE, 'DDx'),
      await upload('R3', Gender.FEMALE, 'DDx'),
      await upload('R4', Gender.FEMALE, 'DDx'),
    ];
    const pets = [...carriers, ...rest];

    // Individually, every animal reads as free to release — the trap.
    const { scores } = await scoreStable({ species: 'BeeWasp', pets });
    expect([...scores.values()].every((r) => r.atRiskCapability === 0)).toBe(true);

    const { releasable } = await safeCullSet({ species: 'BeeWasp', pets });
    const releasedNames = releasable.map((r) => r.pet.name);
    // At most one of the two carriers may go.
    expect(releasedNames.filter((n) => n === 'C1' || n === 'C2')).toHaveLength(1);
  });

  it('reports the cost of the next release when nothing more is free', async () => {
    // Four recessive-positive loci, one sole holder each, plus a fifth
    // animal holding nothing unique. Only that fifth release is free.
    for (const [id, effect] of [
      ['01A2', 'Friendliness+'],
      ['01A3', 'Ruggedness+'],
      ['01A4', 'Enthusiasm+'],
    ] as const) {
      await geneService.upsertGene('beewasp', '01', id, { effectDominant: 'None', effectRecessive: effect });
    }
    geneService.clearGeneEffectsCache('beewasp');

    const pets = [
      await upload('P1', Gender.MALE, 'RDDD'),
      await upload('P2', Gender.FEMALE, 'DRDD'),
      await upload('P3', Gender.MALE, 'DDRD'),
      await upload('P4', Gender.FEMALE, 'DDDR'),
      await upload('P5', Gender.FEMALE, 'DDDD'),
    ];
    const { releasable, next } = await safeCullSet({ species: 'BeeWasp', pets });

    expect(releasable.map((r) => r.pet.name)).toEqual(['P5']);
    expect(next).not.toBeNull();
    // The cheapest remaining holds a single-benefit locus outright: 1.0.
    expect(next?.cost).toBeCloseTo(1, 10);
  });

  it('handles an empty stable', async () => {
    expect(await safeCullSet({ species: 'BeeWasp', pets: [] })).toEqual({ releasable: [], next: null });
  });
});
