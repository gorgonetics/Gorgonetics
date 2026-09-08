import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb, initDatabase } from '$lib/services/database.js';
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

    const { releases } = await safeCullSet({ species: 'BeeWasp', pets });
    const releasedNames = releases.map((r) => r.pet.name);
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
    const { releases, next } = await safeCullSet({ species: 'BeeWasp', pets });

    expect(releases.map((r) => r.pet.name)).toEqual(['P5']);
    expect(next).not.toBeNull();
    // The cheapest remaining holds a single-benefit locus outright: 1.0.
    expect(next?.cost).toBeCloseTo(1, 10);
  });

  it('handles an empty stable', async () => {
    expect(await safeCullSet({ species: 'BeeWasp', pets: [] })).toEqual({
      releases: [],
      totalCost: 0,
      totalCleared: 0,
      allFree: true,
      next: null,
      pinned: [],
      protectedBest: [],
      unscored: [],
      after: { males: 0, females: 0, pairs: 0 },
      atFloor: [],
    });
  });
});

describe('safeCullSet — freeing a fixed number of slots', () => {
  beforeEach(reset);

  /** Six animals: one sole carrier, five redundant. */
  async function stable() {
    return [
      await upload('Unique', Gender.FEMALE, 'RDx'),
      await upload('Dup1', Gender.MALE, 'DDx'),
      await upload('Dup2', Gender.MALE, 'DDx'),
      await upload('Dup3', Gender.FEMALE, 'DDx'),
      await upload('Dup4', Gender.FEMALE, 'DDx'),
      await upload('Dup5', Gender.MALE, 'DDx'),
    ];
  }

  it('frees exactly the requested number of slots', async () => {
    const pets = await stable();
    const { releases, allFree } = await safeCullSet({ species: 'BeeWasp', pets, slots: 2 });
    expect(releases).toHaveLength(2);
    expect(allFree).toBe(true);
    expect(releases.map((r) => r.pet.name)).not.toContain('Unique');
  });

  it('keeps going past the free ones when the slots demand it, and prices them', async () => {
    const pets = await stable();
    // Only three releases are free before the floor bites; asking for more
    // must surface the cost rather than silently returning a short list.
    const { releases, totalCost, allFree } = await safeCullSet({ species: 'BeeWasp', pets, slots: 3 });
    expect(releases).toHaveLength(3);
    expect(totalCost).toBe(0);
    expect(allFree).toBe(true);
  });

  it('never releases more than the population floor allows', async () => {
    const pets = await stable();
    const { releases } = await safeCullSet({ species: 'BeeWasp', pets, slots: 99 });
    expect(pets.length - releases.length).toBeGreaterThanOrEqual(3);
  });

  it('pins starred animals out of the walk entirely', async () => {
    const pets = await stable();
    // Star a redundant animal: it would otherwise be released first.
    await petService.updatePet(pets[1].id, { starred: true });
    const starred = (await petService.getPet(pets[1].id)) as Pet;
    const withStar = pets.map((p) => (p.id === starred.id ? starred : p));

    const { releases, pinned } = await safeCullSet({ species: 'BeeWasp', pets: withStar, slots: 2 });
    expect(pinned.map((p) => p.name)).toEqual(['Dup1']);
    expect(releases.map((r) => r.pet.name)).not.toContain('Dup1');
  });

  it('accepts explicit pins alongside starred ones', async () => {
    const pets = await stable();
    const { releases } = await safeCullSet({
      species: 'BeeWasp',
      pets,
      slots: 2,
      pinned: [pets[1].id, pets[2].id],
    });
    const names = releases.map((r) => r.pet.name);
    expect(names).not.toContain('Dup1');
    expect(names).not.toContain('Dup2');
  });
});

describe('safeCullSet — what the score cannot see', () => {
  beforeEach(reset);

  it('keeps enough of each sex for the pairs the freed slots are for', async () => {
    const pets = [
      await upload('M1', Gender.MALE, 'DDx'),
      await upload('M2', Gender.MALE, 'DDx'),
      await upload('M3', Gender.MALE, 'DDx'),
      await upload('M4', Gender.MALE, 'DDx'),
      await upload('M5', Gender.MALE, 'DDx'),
      await upload('F1', Gender.FEMALE, 'DDx'),
      await upload('F2', Gender.FEMALE, 'DDx'),
      await upload('F3', Gender.FEMALE, 'DDx'),
    ];
    // Everything is redundant, so only the sex floor shapes the answer.
    // Three pairs wanted: no female may go, and two males may.
    const three = await safeCullSet({ species: 'BeeWasp', pets, slots: 4, pairs: 3, protectBest: false });
    expect(three.releases.map((r) => r.pet.gender)).toEqual([Gender.MALE, Gender.MALE]);
    expect(three.after).toEqual({ males: 3, females: 3, pairs: 3 });
    expect(three.atFloor.sort()).toEqual([Gender.FEMALE, Gender.MALE]);

    // The default floor is the slot count, capped at what the animals left
    // could pair: four slots from eight leaves four animals, so two pairs.
    const auto = await safeCullSet({ species: 'BeeWasp', pets, slots: 4, protectBest: false });
    expect(auto.releases).toHaveLength(4);
    expect(auto.after.pairs).toBeGreaterThanOrEqual(2);

    // Opting out of the floor lets the walk ignore sex entirely.
    const none = await safeCullSet({ species: 'BeeWasp', pets, slots: 4, pairs: 0, protectBest: false });
    expect(none.atFloor).toEqual([]);
  });

  it('keeps the best animal by expressed positives, whatever it scores', async () => {
    // Two 'RDx' animals express two positives each and cover one another, so
    // by the score either is free. The first is kept as the stable's best.
    const pets = [
      await upload('Best', Gender.MALE, 'RDx'),
      await upload('Twin', Gender.FEMALE, 'RDx'),
      await upload('Dup1', Gender.MALE, 'DDx'),
      await upload('Dup2', Gender.FEMALE, 'DDx'),
      await upload('Dup3', Gender.MALE, 'DDx'),
      await upload('Dup4', Gender.FEMALE, 'DDx'),
    ];
    const kept = await safeCullSet({ species: 'BeeWasp', pets, slots: 2, pairs: 0 });
    expect(kept.protectedBest.map((p) => p.name)).toEqual(['Best']);
    expect(kept.releases.map((r) => r.pet.name)).not.toContain('Best');

    const open = await safeCullSet({ species: 'BeeWasp', pets, slots: 2, pairs: 0, protectBest: false });
    expect(open.protectedBest).toEqual([]);
  });

  it('never suggests a pet with no genome rows, and says so', async () => {
    const pets = [
      await upload('Ghost', Gender.MALE, 'DDx'),
      await upload('A', Gender.FEMALE, 'RDx'),
      await upload('B', Gender.MALE, 'DDx'),
      await upload('C', Gender.FEMALE, 'DDx'),
      await upload('D', Gender.MALE, 'DDx'),
    ];
    // Strip Ghost's projection and make the fallback re-population fail, as
    // a pet whose genome never parsed would look.
    const db = getDb();
    await db.execute('DELETE FROM pet_genes WHERE pet_id = $id', { id: pets[0].id });
    await db.execute('UPDATE pets SET genome_data = $g WHERE id = $id', { g: '{}', id: pets[0].id });

    const set = await safeCullSet({ species: 'BeeWasp', pets, slots: 2, pairs: 0, protectBest: false });
    expect(set.unscored.map((p) => p.name)).toEqual(['Ghost']);
    expect(set.releases.map((r) => r.pet.name)).not.toContain('Ghost');

    const { scores, unscored } = await scoreStable({ species: 'BeeWasp', pets });
    expect(unscored).toEqual([pets[0].id]);
    expect(scores.has(pets[0].id)).toBe(false);
  });

  it('clean mode lets a liability-heavy animal go before a free one', async () => {
    const pets = [
      // Homozygous for 01A1's negative and its only holder; sole carrier of
      // 01A2's positive. Costs 0.5, clears 1.
      await upload('Dirty', Gender.MALE, 'Dx?'),
      // Three interchangeable clean animals: cost 0, nothing to clear.
      await upload('Clean1', Gender.FEMALE, 'RR?'),
      await upload('Clean2', Gender.MALE, 'RR?'),
      await upload('Clean3', Gender.FEMALE, 'RR?'),
    ];
    const potential = await safeCullSet({ species: 'BeeWasp', pets, slots: 1, pairs: 0, protectBest: false });
    expect(potential.releases[0].pet.name).toBe('Clean1');
    expect(potential.totalCost).toBe(0);

    const clean = await safeCullSet({
      species: 'BeeWasp',
      pets,
      slots: 1,
      pairs: 0,
      protectBest: false,
      mode: 'clean',
    });
    expect(clean.releases[0].pet.name).toBe('Dirty');
    expect(clean.totalCost).toBe(0.5);
    expect(clean.totalCleared).toBe(1);
  });
});
