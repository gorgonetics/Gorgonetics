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
import { buildInClauseParams, getDb } from '$lib/services/database.js';
import { ensurePetGenesPopulated } from '$lib/services/petService.js';
import type { Pet } from '$lib/types/index.js';
import {
  type Allele,
  alleleCarriers,
  alleleFrequency,
  isMeasurable,
  type LocusTally,
  type RarityOptions,
  rarityBucket,
} from '$lib/utils/geneFrequency.js';

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

interface TallyRow {
  gene_id: string;
  pure_d: number;
  pure_r: number;
  mixed: number;
}

/**
 * Aggregate `pet_genes` into one row per locus, **in SQLite**.
 *
 * The alternative — reading one row per pet per locus and tallying in JS —
 * ships 58,312 rows across the IPC boundary for a 37-pet collection to
 * produce 1,576 tallies. This does the grouping in C inside the database
 * process and returns only the 1,576, a ~37× cut in payload.
 *
 * **The three `CASE WHEN`s do not scan the table three times.** Measured on
 * a real 37-horse collection (58,312 rows), this and a plain
 * `GROUP BY gene_id, gene_type` produce an identical query plan — one
 * `SEARCH … USING INDEX idx_pet_genes_pet` plus one temp B-tree — and
 * identical timing (9.7 ms vs 9.8 ms). SQL evaluates every aggregate in a
 * single pass per group; the `CASE WHEN`s are extra accumulators, not extra
 * traversals, and the sort dominates both. The two-column form was rejected
 * only because it returns 3,753 rows rather than 1,576 and then needs a
 * pivot loop in JS to rebuild each tally.
 *
 * For reference the raw row read is 15.3 ms in-process, so the database-side
 * saving is modest; the win that matters is not serialising 58k rows over IPC.
 *
 * **No `'?'` predicate, deliberately.** The obvious `AND gene_type <> '?'`
 * cannot be used: `resolveNamedParams` rewrites named params to positional
 * `?`, so a literal `'?'` in the SQL is miscounted as a placeholder. It is
 * not needed anyway — `?` rows match none of the three `CASE WHEN` arms and
 * so contribute 0 to every sum, which *is* the rule that unknown readings
 * count toward neither numerator nor denominator. `knownPets` is therefore
 * derived from the three sums rather than from `COUNT(*)`.
 */
async function loadLocusTallies(petIds: readonly number[]): Promise<Map<string, LocusTally>> {
  const out = new Map<string, LocusTally>();
  if (petIds.length === 0) return out;

  const { placeholders, params } = buildInClauseParams(petIds, 'pet');
  const rows = await getDb().select<TallyRow[]>(
    `SELECT gene_id,
            SUM(CASE WHEN gene_type = 'D' THEN 1 ELSE 0 END) AS pure_d,
            SUM(CASE WHEN gene_type = 'R' THEN 1 ELSE 0 END) AS pure_r,
            SUM(CASE WHEN gene_type = 'x' THEN 1 ELSE 0 END) AS mixed
     FROM pet_genes WHERE pet_id IN (${placeholders}) GROUP BY gene_id`,
    params,
  );

  for (const row of rows) {
    const pureD = Number(row.pure_d) || 0;
    const pureR = Number(row.pure_r) || 0;
    const mixed = Number(row.mixed) || 0;
    const knownPets = pureD + pureR + mixed;
    // A locus where every reading is `?` aggregates to all-zero. Drop it so
    // the map means the same thing as `computeLocusFrequencies` produces.
    if (knownPets === 0) continue;
    out.set(row.gene_id, { knownPets, pureD, pureR, mixed });
  }
  return out;
}

/**
 * Populate `pet_genes` for any pet that has no projected rows yet.
 *
 * Mirrors `loadAllPetLoci`'s inline populate-and-retry: a legacy pet
 * uploaded before the projection existed, and not yet reached by the
 * startup backfill, would otherwise contribute nothing to the baseline and
 * silently shrink the denominator. The aggregate query cannot see which
 * pets are missing (it groups by locus, not pet), so ask first — one cheap
 * query returning at most one row per pet.
 */
async function ensureProjected(petIds: readonly number[]): Promise<void> {
  const { placeholders, params } = buildInClauseParams(petIds, 'pet');
  const present = await getDb().select<{ pet_id: number }[]>(
    `SELECT DISTINCT pet_id FROM pet_genes WHERE pet_id IN (${placeholders})`,
    params,
  );
  const have = new Set(present.map((r) => r.pet_id));
  for (const id of petIds) {
    if (!have.has(id)) await ensurePetGenesPopulated(id);
  }
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

  await ensureProjected(petIds);
  const loci = await loadLocusTallies(petIds);
  return remember(cacheId, buildLookup(key, petIds.length, loci, opts));
}
