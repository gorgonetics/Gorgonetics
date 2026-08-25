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
import { computeLocusFrequencies } from '$lib/utils/geneFrequency.js';
import {
  capabilityShare,
  type GeneticQualityResult,
  hasMeaningfulPopulation,
  rareBenefitAlleles,
  type SafeCullResult,
  type ScoredGene,
  safeCullOrder,
  scoreGroup,
} from '$lib/utils/geneticQuality.js';
import { loadAllPetLoci, type PetLoci } from '$lib/utils/petLoci.js';
import { getAllAttributeNames, normalizeSpecies } from './configService.js';
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
  /**
   * How many slots to free. The game caps concurrent breeding, so the real
   * question is "I need six slots — which six?" rather than "what is free?".
   * Omit to stop at the first release that would cost capability.
   */
  slots?: number;
  /**
   * Extra animals to exempt, beyond the starred ones. Starred pets are
   * always pinned: a mount is kept for reasons no genome explains, and the
   * genetic measure has no view on riding at all.
   */
  pinned?: Iterable<number>;
}

export interface CullRelease {
  pet: Pet;
  /** Capability lost by releasing it at this point in the sequence. */
  cost: number;
  /** Negative-allele capability that leaves with it. */
  liabilityRemoved: number;
}

export interface SafeCullSet {
  /**
   * The chosen releases, **in order**. The order is load bearing: each
   * step's cost is measured against what remained, so the total holds only
   * if they go in this sequence.
   */
  releases: CullRelease[];
  /** Capability lost across the whole list. Zero when every release is free. */
  totalCost: number;
  /** True when nothing is given up. */
  allFree: boolean;
  /** The next release beyond the list and its cost, if the walk could continue. */
  next: { pet: Pet; cost: number } | null;
  /** Animals excluded from consideration — starred, plus any explicit pins. */
  pinned: Pet[];
}

/**
 * The two tie-break criteria, split around liability because liability is
 * itself leave-one-out and can only be measured inside the walk.
 *
 * Primary is the rare-benefit-allele count, ascending: the animal holding
 * the least rare useful material goes first. It outranks liability because
 * a released rare allele may be unrecoverable while a negative can be bred
 * out later.
 *
 * Secondary is the attribute total, ascending, and it sits *last*
 * deliberately. They are real in-game value
 * (a mount's speed, resilience and carrying capacity), but they are not a
 * reason to keep a genetically redundant animal: only one mount is needed,
 * and that one is pinned by starring it. Here they only ever separate
 * animals the genetic measure has already called equal, which is a
 * determinism device rather than a value axis.
 *
 * Rarity is counted on `geneFrequency`'s ordinal buckets, not raw frequency.
 * A continuous value resolves every tie it is handed, which would leave the
 * attribute term dead code.
 */
function buildTiebreaks(
  canonical: string,
  pets: readonly Pet[],
  loci: Map<number, PetLoci>,
  genes: ParsedGenes,
): { primary: Map<number, readonly number[]>; secondary: Map<number, readonly number[]> } {
  const empty: PetLoci = new Map();
  const frequencies = computeLocusFrequencies(pets.map((p) => loci.get(p.id) ?? empty));
  const attributes = getAllAttributeNames(canonical);
  const primary = new Map<number, readonly number[]>();
  const secondary = new Map<number, readonly number[]>();
  for (const pet of pets) {
    primary.set(pet.id, [rareBenefitAlleles(loci.get(pet.id) ?? empty, genes, frequencies)]);
    const row = pet as unknown as Record<string, unknown>;
    secondary.set(pet.id, [attributes.reduce((sum, key) => sum + (Number(row[key]) || 0), 0)]);
  }
  return { primary, secondary };
}

/**
 * Choose which animals to release, cheapest first.
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
  const empty: SafeCullSet = { releases: [], totalCost: 0, allFree: true, next: null, pinned: [] };
  if (opts.pets.length === 0) return empty;

  const { canonical, loci, genes, ids } = await loadInputs(opts.species, opts.pets);
  const byId = new Map(opts.pets.map((p) => [p.id, p]));

  // Starred animals are pinned. The score measures breeding contribution and
  // nothing else; a mount earns its slot for reasons it cannot see, so the
  // exemption is declared by the player rather than inferred from stats.
  const pinned = new Set<number>(opts.pinned ?? []);
  for (const p of opts.pets) if (p.starred) pinned.add(p.id);

  const { primary, secondary } = buildTiebreaks(canonical, opts.pets, loci, genes);
  const order: SafeCullResult = safeCullOrder(loci, genes, ids, {
    pinned,
    primaryTiebreak: primary,
    secondaryTiebreak: secondary,
    target: opts.slots,
  });

  const releases: CullRelease[] = [];
  for (const step of order.releases) {
    const pet = byId.get(step.id);
    if (pet) releases.push({ pet, cost: step.cost, liabilityRemoved: step.liabilityRemoved });
  }

  // The pure layer reports `nextCost` without its animal (it deals in ids);
  // re-derive which animal it was by scoring what would be left.
  let next: SafeCullSet['next'] = null;
  if (order.nextCost !== null) {
    const gone = new Set(order.releases.map((s) => s.id));
    const remaining = ids.filter((id) => !gone.has(id));
    const scored = scoreGroup(loci, genes, remaining);
    let cheapest: { pet: Pet; cost: number } | null = null;
    for (const id of remaining) {
      if (pinned.has(id)) continue;
      const cost = scored.get(id)?.atRiskCapability;
      const pet = byId.get(id);
      if (cost === undefined || !pet) continue;
      if (cheapest === null || cost < cheapest.cost) cheapest = { pet, cost };
    }
    next = cheapest;
  }

  return {
    releases,
    totalCost: order.totalCost,
    allFree: order.totalCost === 0,
    next,
    pinned: [...pinned].map((id) => byId.get(id)).filter((p): p is Pet => p !== undefined),
  };
}
