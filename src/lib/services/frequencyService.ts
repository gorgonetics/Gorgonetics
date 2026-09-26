/**
 * Baseline builder for the gene rarity lens (#368).
 *
 * Turns a population of pets into a per-locus allele tally the view layer
 * can query by gene id. Owns the DB read, the species scoping and the
 * cache; all the arithmetic lives in `utils/geneFrequency.js`.
 *
 * See `docs/design/gene-rarity-lens-v1.md` §5.
 */

import { normalizeSpecies } from '$lib/services/configService.js';
import { GeneType, type Pet } from '$lib/types/index.js';
import {
  type Allele,
  alleleCarriers,
  alleleFrequency,
  computeLocusFrequencies,
  DEFAULT_MIN_KNOWN_ALLELES,
  isMeasurable,
  type LocusTally,
  type RarityOptions,
  rarityBucket,
  SOLE_CARRIER_MIN_PETS,
} from '$lib/utils/geneFrequency.js';
import { loadAllPetLoci, type PetLoci } from '$lib/utils/petLoci.js';

const EMPTY_TALLY: LocusTally = Object.freeze({
  knownPets: 0,
  pureD: 0,
  pureR: 0,
  mixed: 0,
});

/**
 * A computed baseline. Read-only and cheap to query — the whole point is
 * that the stylesheet builder can walk ~1600 gene ids without touching
 * the DB again.
 */
export interface RarityLookup {
  /** Canonical species key this baseline was built for. */
  readonly species: string;
  /** Pets of this species in the population (the *population* size). */
  readonly petCount: number;
  /**
   * Pets studied less deeply than the deepest-studied pet in the population.
   *
   * Exists so the legend can say *why* "across 30 Horses" is not the whole
   * truth: with these pets present the denominator varies per locus, and no
   * single figure in the legend can be right for every cell (§6). Measured
   * against the deepest pet rather than against the species' full locus count,
   * because that is what the projection can answer without a second notion of
   * "complete" — and a collection where every pet stops at the same depth has
   * even coverage, which is the thing being flagged.
   */
  readonly partialPets: number;
  /**
   * Per-locus tallies. Absent gene ids mean no pet in the population had
   * a known reading there.
   */
  readonly loci: ReadonlyMap<string, LocusTally>;
  /** Tally for a locus, or an all-zero tally when unseen. */
  tally(geneId: string): LocusTally;
  /** `0`–`4`, or `null` when the locus is below the minimum sample. */
  bucketOf(geneId: string, allele: Allele): number | null;
  /** Allele frequency in `[0, 1]`. Gate on `measurable` before trusting it. */
  frequency(geneId: string, allele: Allele): number;
  /** Pets carrying ≥1 copy. A mixed pet counts toward both alleles. */
  carriers(geneId: string, allele: Allele): number;
  /** Whether the locus has enough known alleles to be scored at all. */
  measurable(geneId: string): boolean;
}

/**
 * Which of your pets a baseline is measured over. `community` is deferred — it
 * needs a precomputed aggregate rather than fetching every shared genome.
 */
export type RarityTier = 'stabled' | 'all';

/**
 * Resolve a tier to the pets it means.
 *
 * Both surfaces that offer the toggle (the per-pet lens and the genome map) go
 * through this, so "Stabled" cannot come to mean one thing on one surface and
 * something else on the other — they would then score against different
 * populations while showing the same label. Species scoping happens later, in
 * `computeRarityLookup`.
 */
export function petsForTier(tier: RarityTier, pets: readonly Pet[]): readonly Pet[] {
  return tier === 'stabled' ? pets.filter((pet) => pet.stabled) : pets;
}

/**
 * Cache key for a baseline.
 *
 * Keyed on the **sorted id set**, not array identity: a background reload
 * of the pet list produces a fresh array with the same members, and
 * recomputing on that would re-read every pet's loci every time the store
 * settles. Sorting also makes "stabled" and "all" collapse to the same
 * key when every pet happens to be stabled, which is correct — the
 * baseline really is identical.
 */
function cacheKey(species: string, petIds: readonly number[], opts: RarityOptions): string {
  // The options are part of the key because `buildLookup` closes over them:
  // `bucketOf` and `measurable` answer differently under different thresholds, so
  // a key that ignored them would serve the first caller's thresholds to every
  // later caller for the same population — silently reporting loci as unscorable
  // for one caller because another had asked with a stricter floor.
  const minKnown = opts.minKnownAlleles ?? DEFAULT_MIN_KNOWN_ALLELES;
  const soleMin = opts.soleCarrierMinPets ?? SOLE_CARRIER_MIN_PETS;
  return `${species}|${minKnown}|${soleMin}|${[...petIds].sort((a, b) => a - b).join(',')}`;
}

/**
 * Small bounded cache. The population toggle flips between two
 * populations and the user flips back and forth, so holding a handful of
 * recent baselines avoids a re-read per toggle; the cap stops a long
 * session from pinning every population it ever saw.
 */
const MAX_CACHED = 4;
const cache = new Map<string, RarityLookup>();

function remember(key: string, lookup: RarityLookup): RarityLookup {
  cache.set(key, lookup);
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return lookup;
}

/** Drop every cached baseline. Call when pets are added, edited or removed. */
export function invalidateRarityCache(): void {
  cache.clear();
}

function buildLookup(
  species: string,
  petCount: number,
  partialPets: number,
  loci: Map<string, LocusTally>,
  opts: RarityOptions,
): RarityLookup {
  const tally = (geneId: string): LocusTally => loci.get(geneId) ?? EMPTY_TALLY;
  return {
    species,
    petCount,
    partialPets,
    loci,
    tally,
    bucketOf: (geneId, allele) => rarityBucket(tally(geneId), allele, opts),
    frequency: (geneId, allele) => alleleFrequency(tally(geneId), allele),
    carriers: (geneId, allele) => alleleCarriers(tally(geneId), allele),
    measurable: (geneId) => isMeasurable(tally(geneId), opts),
  };
}

/**
 * Count the pets studied less deeply than the deepest-studied one.
 *
 * Per pet, not per locus: two pets each missing a different locus and one pet
 * missing both produce identical per-locus tallies. `?` is not a reading, so
 * it does not count as known.
 */
function partialPetCount(lociByPet: ReadonlyMap<number, PetLoci>): number {
  const known = [...lociByPet.values()].map((loci) => {
    let count = 0;
    for (const type of loci.values()) if (type !== GeneType.UNKNOWN) count++;
    return count;
  });
  const deepest = Math.max(...known);
  return known.filter((count) => count < deepest).length;
}

/**
 * Build (or reuse) the rarity baseline for one species over `pets`.
 *
 * **Species scoping is not optional.** Gene ids are only comparable
 * within a species — `01A1` names a different gene on a horse than on a
 * beewasp — so a mixed-species population must never pool. Pets whose
 * `normalizeSpecies` does not match are dropped before the DB read, which
 * also keeps the `IN (…)` list to the pets that can contribute.
 *
 * Reads the loci of the whole population once via `loadAllPetLoci`.
 */
export async function computeRarityLookup(
  pets: readonly Pet[],
  species: string,
  opts: RarityOptions = {},
): Promise<RarityLookup> {
  const key = normalizeSpecies(species);
  const petIds = pets.filter((p) => normalizeSpecies(p.species) === key).map((p) => p.id);

  const cacheId = cacheKey(key, petIds, opts);
  const cached = cache.get(cacheId);
  if (cached) return cached;

  // An empty population is a real state (no pets of this species yet), not
  // an error — every locus simply reads as missing data.
  if (petIds.length === 0) {
    return remember(cacheId, buildLookup(key, 0, 0, new Map(), opts));
  }

  // The population is the pets that can actually be measured, so the legend's
  // count and the frequencies' denominator are the same set. Keyed on the
  // *requested* ids, though — projecting first would cost a DB round trip on
  // every cache hit — so recovery from a transient write failure comes from
  // `invalidateRarityCache`, which `appState.loadPets` calls.
  //
  // `loadAllPetLoci` omits a pet with no usable genome (malformed, or a
  // failed write). Counting it in the population would divide by a pet that
  // is not in the numerator: every frequency reads low, and a recessive only
  // that pet carries reads as *never seen* — telling the player to go capture
  // an allele they already own.
  const lociByPet = await loadAllPetLoci(petIds);
  for (const id of petIds)
    if (!lociByPet.has(id)) console.warn(`rarity baseline: pet ${id} has no usable genome and is excluded`);
  if (lociByPet.size === 0) {
    return remember(cacheId, buildLookup(key, 0, 0, new Map(), opts));
  }
  // Counted in JS from each pet's decoded loci (#554). The SQL `GROUP BY`
  // this replaced existed only to avoid shipping one `pet_genes` row per pet
  // per locus across the IPC boundary; with one loci string per pet there is
  // nothing large to ship.
  const loci = computeLocusFrequencies(lociByPet.values());
  return remember(cacheId, buildLookup(key, lociByPet.size, partialPetCount(lociByPet), loci, opts));
}
