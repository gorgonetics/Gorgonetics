import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '$lib/services/database.js';
import { computeRarityLookup, invalidateRarityCache } from '$lib/services/frequencyService.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';
import { GeneType, type Pet } from '$lib/types/index.js';
import { computeLocusFrequencies, RARITY_BUCKET_NEVER, RARITY_BUCKET_SOLE } from '$lib/utils/geneFrequency.js';
import { loadAllPetLoci } from '$lib/utils/petLoci.js';
import { buildRarityCSS } from '$lib/utils/rarityCSS.js';
import { buildRarityTooltip } from '$lib/utils/rarityTooltip.js';

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

/**
 * A collection built while levelling Genetics holds pets revealed to different
 * depths, so one population yields a different denominator at every locus. The
 * fixtures have to construct that deliberately: the calibration collection has
 * no `?` genotypes at all, so nothing about it would exercise this.
 */
describe('uneven study depth within one population', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
    invalidateRarityCache();
  });

  /** Five horses, revealed to three different depths across four loci. */
  async function unevenStable(): Promise<Pet[]> {
    return [
      await upload('Horse', 'H1', 'DDDD'), // studied to the end
      await upload('Horse', 'H2', 'DxD?'),
      await upload('Horse', 'H3', 'DRD?'),
      await upload('Horse', 'H4', 'Dx??'), // studied shallowest
      await upload('Horse', 'H5', 'DD??'),
    ];
  }

  it('yields a different knownPets at different loci', async () => {
    const lookup = await computeRarityLookup(await unevenStable(), 'Horse');

    expect(lookup.petCount).toBe(5);
    expect(lookup.tally('01A1').knownPets).toBe(5);
    expect(lookup.tally('01A3').knownPets).toBe(3);
    expect(lookup.tally('01A4').knownPets).toBe(1);
  });

  it('counts the pets studied less deeply, so the legend can flag uneven coverage', async () => {
    // H1 has four readings, H2/H3 three, H4/H5 two — four pets short of the
    // deepest. Per-locus tallies cannot answer this: two pets each missing a
    // different locus and one missing both give identical tallies.
    const lookup = await computeRarityLookup(await unevenStable(), 'Horse');
    expect(lookup.partialPets).toBe(4);
  });

  it('reports no partial pets when the whole population was studied to the same depth', async () => {
    const even = [await upload('Horse', 'H1', 'DDDD'), await upload('Horse', 'H2', 'DxRD')];
    const lookup = await computeRarityLookup(even, 'Horse');
    expect(lookup.partialPets).toBe(0);
  });

  it('treats a population that stopped at the same shallow depth as even', async () => {
    // Every pet is missing the same two loci, so nothing about the baseline is
    // lopsided — there is no per-pet difference for the legend to warn about.
    const shallow = [await upload('Horse', 'H1', 'DD??'), await upload('Horse', 'H2', 'xR??')];
    const lookup = await computeRarityLookup(shallow, 'Horse');
    expect(lookup.partialPets).toBe(0);
    expect(lookup.tally('01A3').knownPets).toBe(0);
  });

  it('quotes the per-locus count in the tooltip, not the population size', async () => {
    const lookup = await computeRarityLookup(await unevenStable(), 'Horse');
    const effects = { dominant: 'Toughness+', recessive: 'Virility-' };

    // 5 pets in the population, 3 with a reading here. Quoting 5 would
    // misstate the evidence behind the colour.
    expect(buildRarityTooltip(lookup, '01A3', 'Horses', effects).subtitle).toBe('3 Horses studied at this locus');
    expect(buildRarityTooltip(lookup, '01A1', 'Horses', effects).subtitle).toBe('5 Horses studied at this locus');
  });

  it('renders the under-studied locus as missing data while its neighbours shade normally', async () => {
    const lookup = await computeRarityLookup(await unevenStable(), 'Horse');

    // 01A4 has one reading — 2 known alleles, under the 4-allele floor.
    expect(lookup.measurable('01A4')).toBe(false);
    expect(lookup.bucketOf('01A4', D)).toBeNull();
    expect(lookup.measurable('01A3')).toBe(true);

    const css = buildRarityCSS({
      cells: [
        { geneId: '01A2', type: GeneType.MIXED },
        { geneId: '01A3', type: D },
        { geneId: '01A4', type: D },
      ],
      lookup,
    });

    const rules = css
      .split('}')
      .filter((rule) => rule.trim())
      .map((rule) => {
        const [selector, declaration] = rule.split('{');
        return { selector, declaration };
      });
    const missing = rules.find((rule) => rule.declaration.includes('dashed'));
    const shaded = rules.filter((rule) => !rule.declaration.includes('dashed'));

    expect(missing?.selector, '01A4 was never listed as missing data').toContain('01A4');
    expect(shaded.some((rule) => rule.selector.includes('01A2'))).toBe(true);
    expect(shaded.some((rule) => rule.selector.includes('01A3'))).toBe(true);
    expect(shaded.every((rule) => !rule.selector.includes('01A4'))).toBe(true);
  });
});

/**
 * The never-seen step end to end (#368): an allele no pet of yours carries is
 * the top of the scale, because it is the one reading you cannot breed your way
 * to. Gated to ten known pets like the sole-carrier step.
 */
describe('alleles nobody in the population carries', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
    invalidateRarityCache();
  });

  /** `n` horses, all pure dominant at every locus. */
  async function monomorphic(n: number): Promise<Pet[]> {
    const pets: Pet[] = [];
    for (let i = 0; i < n; i++) pets.push(await upload('Horse', `H${i}`, 'DDD'));
    return pets;
  }

  it('reaches the top step once the baseline is big enough to say so', async () => {
    const lookup = await computeRarityLookup(await monomorphic(10), 'Horse');

    expect(lookup.carriers('01A1', R)).toBe(0);
    expect(lookup.frequency('01A1', R)).toBe(0);
    expect(lookup.bucketOf('01A1', R)).toBe(RARITY_BUCKET_NEVER);
    // The allele every pet has is the common centre, not scarce.
    expect(lookup.bucketOf('01A1', D)).toBe(0);
  });

  it('stays at the neutral centre on a baseline too small to claim it', async () => {
    // With three horses most loci are monomorphic; the loudest colour would
    // carpet the map and mean nothing.
    const lookup = await computeRarityLookup(await monomorphic(3), 'Horse');
    expect(lookup.carriers('01A1', R)).toBe(0);
    expect(lookup.bucketOf('01A1', R)).toBe(0);
  });

  it('drops back off the top step as soon as one pet carries the allele', async () => {
    const pets = await monomorphic(10);
    pets.push(await upload('Horse', 'Carrier', 'xDD'));
    const lookup = await computeRarityLookup(pets, 'Horse');

    expect(lookup.carriers('01A1', R)).toBe(1);
    expect(lookup.bucketOf('01A1', R)).toBe(RARITY_BUCKET_SOLE);
    expect(lookup.bucketOf('01A1', R)).toBeLessThan(RARITY_BUCKET_NEVER);
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
