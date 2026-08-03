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
import type { Pet } from '$lib/types/index.js';
import {
  type Allele,
  alleleCarriers,
  alleleFrequency,
  computeLocusFrequencies,
  isMeasurable,
  type LocusTally,
  type RarityOptions,
  rarityBucket,
} from '$lib/utils/geneFrequency.js';
import { loadAllPetLoci } from '$lib/utils/petLoci.js';

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
 * Cache key for a baseline.
 *
 * Keyed on the **sorted id set**, not array identity: a background reload
 * of the pet list produces a fresh array with the same members, and
 * recomputing on that would re-read `pet_genes` every time the store
 * settles. Sorting also makes "stabled" and "all" collapse to the same
 * key when every pet happens to be stabled, which is correct — the
 * baseline really is identical.
 */
function cacheKey(species: string, petIds: readonly number[]): string {
  return `${species}|${[...petIds].sort((a, b) => a - b).join(',')}`;
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
  loci: Map<string, LocusTally>,
  opts: RarityOptions,
): RarityLookup {
  const tally = (geneId: string): LocusTally => loci.get(geneId) ?? EMPTY_TALLY;
  return {
    species,
    petCount,
    loci,
    tally,
    bucketOf: (geneId, allele) => rarityBucket(tally(geneId), allele, opts),
    frequency: (geneId, allele) => alleleFrequency(tally(geneId), allele),
    carriers: (geneId, allele) => alleleCarriers(tally(geneId), allele),
    measurable: (geneId) => isMeasurable(tally(geneId), opts),
  };
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
 * Reads `pet_genes` once for the whole population via `loadAllPetLoci`.
 */
export async function computeRarityLookup(
  pets: readonly Pet[],
  species: string,
  opts: RarityOptions = {},
): Promise<RarityLookup> {
  const key = normalizeSpecies(species);
  const petIds = pets.filter((p) => normalizeSpecies(p.species) === key).map((p) => p.id);

  const cacheId = cacheKey(key, petIds);
  const cached = cache.get(cacheId);
  if (cached) return cached;

  // An empty population is a real state (no pets of this species yet), not
  // an error — every locus simply reads as missing data.
  if (petIds.length === 0) {
    return remember(cacheId, buildLookup(key, 0, new Map(), opts));
  }

  const byPet = await loadAllPetLoci(petIds);
  const loci = computeLocusFrequencies(byPet.values());
  return remember(cacheId, buildLookup(key, petIds.length, loci, opts));
}
