import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '$lib/services/database.js';
import { computeRarityLookup, invalidateRarityCache } from '$lib/services/frequencyService.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';
import { GeneType, type Pet } from '$lib/types/index.js';
import { computeLocusFrequencies } from '$lib/utils/geneFrequency.js';
import { loadAllPetLoci } from '$lib/utils/petLoci.js';

const D = GeneType.DOMINANT;
const R = GeneType.RECESSIVE;

/** Three-locus genome (01A1..01A3) for one species. */
function genome(species: string, entity: string, genes: string): string {
  return `[Overview]
Format=1.0
Character=Tester
Entity=${entity}
Genome=${species}

[Genes]
1=${genes}
`;
}

async function upload(species: string, entity: string, genes: string): Promise<Pet> {
  const result = await petService.uploadPet(genome(species, entity, genes));
  const petId = (result as { pet_id?: number }).pet_id;
  if (!petId) throw new Error(`upload failed for ${entity}: ${JSON.stringify(result)}`);
  const pet = await petService.getPet(petId);
  if (!pet) throw new Error(`pet ${petId} not readable back after upload`);
  return pet;
}

describe('computeRarityLookup', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
    invalidateRarityCache();
  });

  it('scopes the baseline to one species — a beewasp cannot leak into a horse baseline', async () => {
    // Horses: both dominant at 01A1. Beewasps: both recessive at the same id.
    // If the species filter leaks, 01A1 stops reading as monomorphic-dominant.
    const horses = [await upload('Horse', 'H1', 'DDD'), await upload('Horse', 'H2', 'DDD')];
    const bees = [await upload('BeeWasp', 'B1', 'RRR'), await upload('BeeWasp', 'B2', 'RRR')];

    const lookup = await computeRarityLookup([...horses, ...bees], 'Horse');

    expect(lookup.petCount).toBe(2);
    expect(lookup.tally('01A1')).toEqual({ knownPets: 2, pureD: 2, pureR: 0, mixed: 0 });
    expect(lookup.frequency('01A1', D)).toBe(1);
    expect(lookup.frequency('01A1', R)).toBe(0);
    expect(lookup.carriers('01A1', R)).toBe(0);
  });

  it('accepts any casing/variant of the species name', async () => {
    await upload('Horse', 'H1', 'DDD');
    await upload('Horse', 'H2', 'DDD');
    const { items } = await petService.getAllPets();
    const lookup = await computeRarityLookup(items, 'horse');
    expect(lookup.petCount).toBe(2);
  });

  it('gates on minimum sample in ALLELES, not pets', async () => {
    const one = [await upload('Horse', 'Solo', 'DDD')];
    // One pet = 2 known alleles, below the default 4.
    const lookup = await computeRarityLookup(one, 'Horse');
    expect(lookup.measurable('01A1')).toBe(false);
    expect(lookup.bucketOf('01A1', D)).toBeNull();

    invalidateRarityCache();
    const relaxed = await computeRarityLookup(one, 'Horse', { minKnownAlleles: 2 });
    expect(relaxed.measurable('01A1')).toBe(true);
    expect(relaxed.bucketOf('01A1', D)).toBe(0);
  });

  it('treats an empty population as a real state, not an error', async () => {
    const lookup = await computeRarityLookup([], 'Horse');
    expect(lookup.petCount).toBe(0);
    expect(lookup.loci.size).toBe(0);
    expect(lookup.bucketOf('01A1', D)).toBeNull();
    expect(lookup.tally('01A1')).toEqual({ knownPets: 0, pureD: 0, pureR: 0, mixed: 0 });
  });

  it('reports an unseen locus as an all-zero tally rather than throwing', async () => {
    const pets = [await upload('Horse', 'H1', 'DDD'), await upload('Horse', 'H2', 'DRD')];
    const lookup = await computeRarityLookup(pets, 'Horse');
    expect(lookup.tally('99Z9')).toEqual({ knownPets: 0, pureD: 0, pureR: 0, mixed: 0 });
    expect(lookup.measurable('99Z9')).toBe(false);
  });

  it('counts a mixed pet toward both alleles', async () => {
    const pets = [await upload('Horse', 'H1', 'xDD'), await upload('Horse', 'H2', 'DDD')];
    const lookup = await computeRarityLookup(pets, 'Horse');
    // 01A1: one x + one D → 3 of 4 alleles dominant
    expect(lookup.frequency('01A1', D)).toBeCloseTo(0.75, 10);
    expect(lookup.carriers('01A1', R)).toBe(1);
    expect(lookup.carriers('01A1', D)).toBe(2);
  });
});

describe('the SQL aggregate agrees with the reference JS tally', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
    invalidateRarityCache();
  });

  /**
   * The aggregate runs as `GROUP BY` in SQLite in production but through a
   * hand-written branch in `InMemoryDatabase` here. That branch is exactly the
   * kind of emulation that drifts from real SQL — #433 was the same class of
   * bug — so pin it to `computeLocusFrequencies`, which is the reference the
   * pure unit tests already cover.
   */
  it('produces identical tallies to computeLocusFrequencies over the same pets', async () => {
    const genomes = ['DDD', 'DRx', 'xxR', 'RRD', 'D?R', 'xRD', '?xD'];
    const pets: Pet[] = [];
    for (const [i, g] of genomes.entries()) pets.push(await upload('Horse', `H${i}`, g));

    const viaSql = await computeRarityLookup(pets, 'Horse');

    const byPet = await loadAllPetLoci(pets.map((p) => p.id));
    const viaJs = computeLocusFrequencies(byPet.values());

    expect([...viaSql.loci.keys()].sort()).toEqual([...viaJs.keys()].sort());
    for (const [geneId, expected] of viaJs) {
      expect(viaSql.tally(geneId), `locus ${geneId}`).toEqual(expected);
    }
  });

  it('excludes ? from the denominator without a "?" literal in the SQL', async () => {
    // A '?' literal would be miscounted as a positional placeholder, so the
    // query has no `<> '?'` predicate — unknown rows simply match no CASE arm.
    const pets = [
      await upload('Horse', 'H1', 'D??'),
      await upload('Horse', 'H2', 'D??'),
      await upload('Horse', 'H3', 'RDD'),
    ];
    const lookup = await computeRarityLookup(pets, 'Horse');
    expect(lookup.tally('01A1')).toEqual({ knownPets: 3, pureD: 2, pureR: 1, mixed: 0 });
    // 01A2/01A3 are known only for H3 — the two '?' readings add nothing.
    expect(lookup.tally('01A2').knownPets).toBe(1);
  });

  it('drops a locus that is ? for every pet, rather than reporting an empty tally', async () => {
    const pets = [await upload('Horse', 'H1', 'D??'), await upload('Horse', 'H2', 'R??')];
    const lookup = await computeRarityLookup(pets, 'Horse');
    expect(lookup.loci.has('01A1')).toBe(true);
    expect(lookup.loci.has('01A2')).toBe(false);
    expect(lookup.measurable('01A2')).toBe(false);
  });
});

describe('baseline caching', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
    invalidateRarityCache();
  });

  it('reuses the baseline for the same id SET, not the same array identity', async () => {
    const a = await upload('Horse', 'H1', 'DDD');
    const b = await upload('Horse', 'H2', 'DRD');

    const first = await computeRarityLookup([a, b], 'Horse');
    // A background reload hands back fresh objects in a different order.
    const second = await computeRarityLookup([{ ...b }, { ...a }] as Pet[], 'Horse');

    expect(second).toBe(first);
  });

  it('recomputes when the population actually changes', async () => {
    const a = await upload('Horse', 'H1', 'DDD');
    const b = await upload('Horse', 'H2', 'DRD');

    const pair = await computeRarityLookup([a, b], 'Horse');
    const single = await computeRarityLookup([a], 'Horse');

    expect(single).not.toBe(pair);
    expect(single.petCount).toBe(1);
    expect(pair.petCount).toBe(2);
  });

  it('drops everything on invalidate, so an edited pet cannot serve a stale baseline', async () => {
    const a = await upload('Horse', 'H1', 'DDD');
    const b = await upload('Horse', 'H2', 'DRD');
    const first = await computeRarityLookup([a, b], 'Horse');

    invalidateRarityCache();
    const second = await computeRarityLookup([a, b], 'Horse');

    expect(second).not.toBe(first);
    expect(second.tally('01A1')).toEqual(first.tally('01A1'));
  });
});
