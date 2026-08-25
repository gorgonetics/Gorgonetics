/**
 * Genetic Quality Score service — the DB-aware composition over
 * `utils/geneticQuality`.
 *
 * Reads the pre-projected `pet_genes` table via the shared `petLoci`
 * utility and the cached parsed-effect columns on `genes`, then hands both
 * to the pure scoring core. Mirrors `breedingService`'s split: no genetics
 * arithmetic lives here.
 *
 * Two entry points, because the score answers one question two ways (see
 * `docs/design/genetic-quality-score-v1.md`):
 *
 *  - `scoreStable` — per-animal irreplaceability, for the roster.
 *  - `safeCullSet` — the largest set of releases that costs nothing,
 *    computed sequentially because leave-one-out scores are not additive.
 *
 * **Nothing here is persisted.** Unlike `pets.positive_genes`, the score is
 * stable-relative: every add, release or stable toggle changes it. Writing
 * it to a column would guarantee a stale value.
 */

import type { Pet } from '$lib/types/index.js';
import {
  capabilityShare,
  type GeneticQualityResult,
  hasMeaningfulPopulation,
  type SafeCullResult,
  type ScoredGene,
  safeCullOrder,
  scoreGroup,
} from '$lib/utils/geneticQuality.js';
import { loadAllPetLoci, type PetLoci } from '$lib/utils/petLoci.js';
import { normalizeSpecies } from './configService.js';
import { getParsedGenesCached, isHorseBreedFiltered } from './geneService.js';

/**
 * `ParsedGeneRecord` already satisfies `ScoredGene` structurally; the alias
 * exists so the cast site is named and a future divergence surfaces here
 * rather than at every call.
 */
type ParsedGenes = Readonly<Record<string, ScoredGene>>;

async function loadInputs(
  species: string,
  pets: readonly Pet[],
): Promise<{ canonical: string; loci: Map<number, PetLoci>; genes: ParsedGenes; ids: number[] }> {
  const canonical = normalizeSpecies(species);
  const ids = pets.map((p) => p.id);
  const [loci, genes] = await Promise.all([loadAllPetLoci(ids), getParsedGenesCached(canonical)]);
  return { canonical, loci, genes, ids };
}

/**
 * Build the locus filter for a target offspring breed. Genes locked to a
 * different breed are excluded; breed-generic genes and Mixed targets pass
 * through, via the same `isHorseBreedFiltered` gate the rest of the app
 * uses so the two cannot disagree about which loci exist.
 *
 * Returns `undefined` for "all loci, every breed" — the default, because
 * offspring can be of a breed neither parent is, which makes a third
 * breed's allele live material rather than dead weight.
 */
function breedScope(canonical: string, offspringBreed: string | undefined) {
  if (!offspringBreed) return undefined;
  return (gene: ScoredGene) => !isHorseBreedFiltered(canonical, offspringBreed, gene.breed);
}

export interface ScoreStableOptions {
  /** Canonical or display species — passed through `normalizeSpecies`. */
  species: string;
  /**
   * The population to score, and the population scored *against*. The
   * caller is expected to pass one species' stabled animals; capability is
   * defined relative to exactly this set, so including unstabled animals
   * would credit the herd with alleles it cannot currently breed from.
   */
  pets: readonly Pet[];
  /**
   * Target offspring breed, scoping to breed-generic plus that breed's
   * loci. Omit for every locus.
   *
   * **Do not pass this for a cull decision** — use `safeCullSet`, which
   * cannot take it. A breed-scoped score reports an animal as expendable
   * when it is merely expendable *for that breed*.
   */
  offspringBreed?: string;
}

export interface StableScores {
  /** Per-animal result, keyed by pet id. Every input id is present. */
  scores: Map<number, GeneticQualityResult>;
  /**
   * Percentage of the stable's total at-risk capability, keyed by pet id.
   * The honest 0–100: a real quantity over a real denominator.
   */
  shares: Map<number, number>;
  /**
   * False when the population is too small for the score to discriminate —
   * below the floor almost every slot tiers `sole`, so everything reads as
   * irreplaceable. The scores are still returned (the arithmetic is
   * correct); the flag tells the UI to suppress the column rather than
   * show a stable where every animal looks essential.
   */
  meaningful: boolean;
}

/**
 * Score a stable: what each animal holds that the others cannot supply.
 *
 * One `pet_genes` read and one tally pass for the whole set, then a scoring
 * pass per animal — O(pets × loci), roughly 60k operations for a 38-horse
 * stable.
 */
export async function scoreStable(opts: ScoreStableOptions): Promise<StableScores> {
  if (opts.pets.length === 0) {
    return { scores: new Map(), shares: new Map(), meaningful: false };
  }
  const { canonical, loci, genes, ids } = await loadInputs(opts.species, opts.pets);
  const scores = scoreGroup(loci, genes, ids, {
    scopeToBreed: breedScope(canonical, opts.offspringBreed),
  });
  return {
    scores,
    shares: capabilityShare(scores),
    meaningful: hasMeaningfulPopulation(opts.pets.length),
  };
}

export interface SafeCullOptions {
  /** Canonical or display species — passed through `normalizeSpecies`. */
  species: string;
  /** The stabled population. Releases are judged against this set only. */
  pets: readonly Pet[];
}

export interface SafeCullSet {
  /**
   * Animals releasable at no capability cost, **in release order**, each
   * paired with the liability that leaves with it. The order is load
   * bearing: the set is only free as a sequence, since each step is scored
   * against what remains.
   */
  releasable: { pet: Pet; liabilityRemoved: number }[];
  /**
   * The cheapest release beyond the free set, and what it would cost. Null
   * when the population floor ended the walk instead.
   */
  next: { pet: Pet; cost: number } | null;
}

/**
 * The largest set of animals that can be released without losing any
 * breeding capability.
 *
 * Deliberately **not** derivable from `scoreStable`: leave-one-out scores
 * are not additive, so selecting every zero-scoring animal from a sorted
 * column loses capability that each individual score reported as free.
 * This re-scores after every removal.
 *
 * Takes no `offspringBreed`. Releasing an animal is irreversible against
 * every breed you might later target — see the design doc §5, where a
 * breed-scoped cull recommends releasing the sole carrier of three
 * unrecoverable positives.
 */
export async function safeCullSet(opts: SafeCullOptions): Promise<SafeCullSet> {
  if (opts.pets.length === 0) return { releasable: [], next: null };
  const { loci, genes, ids } = await loadInputs(opts.species, opts.pets);
  const order: SafeCullResult = safeCullOrder(loci, genes, ids);

  const byId = new Map(opts.pets.map((p) => [p.id, p]));
  const releasable: SafeCullSet['releasable'] = [];
  for (const step of order.releasable) {
    const pet = byId.get(step.id);
    if (pet) releasable.push({ pet, liabilityRemoved: step.liabilityRemoved });
  }

  // `nextCost` is reported without its animal by the pure layer (it deals in
  // ids and has no Pet); re-derive which animal it was by scoring what is
  // left after the free releases.
  let next: SafeCullSet['next'] = null;
  if (order.nextCost !== null) {
    const released = new Set(order.releasable.map((s) => s.id));
    const remaining = ids.filter((id) => !released.has(id));
    const scored = scoreGroup(loci, genes, remaining);
    let cheapest: { pet: Pet; cost: number } | null = null;
    for (const id of remaining) {
      const cost = scored.get(id)?.atRiskCapability;
      const pet = byId.get(id);
      if (cost === undefined || !pet) continue;
      if (cheapest === null || cost < cheapest.cost) cheapest = { pet, cost };
    }
    next = cheapest;
  }

  return { releasable, next };
}
