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

import { Gender, type Pet } from '$lib/types/index.js';
import { computeLocusFrequencies } from '$lib/utils/geneFrequency.js';
import {
  type BenefitWeight,
  breedReachFor,
  type CapabilitySummary,
  capabilityShare,
  type GeneticQualityResult,
  hasMeaningfulPopulation,
  rareBenefitAlleles,
  type SafeCullResult,
  type ScoredGene,
  safeCullOrder,
  scoreGroup,
  capabilitySummary as summarise,
} from '$lib/utils/geneticQuality.js';
import { loadAllPetLoci, type PetLoci } from '$lib/utils/petLoci.js';
import { getAllAttributeNames, normalizeSpecies } from './configService.js';
import { getParsedGenesCached } from './geneService.js';

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
 * Smallest weight the cull path will apply to a breed-locked benefit.
 *
 * Design doc §5 in one constant. A weight of 0 is a legitimate request from
 * the breeding side — that foal really is one breed — but on the cull path
 * it reinstates the scoped score that offered up Roach, sole carrier of
 * three positives no other animal in the stable could ever supply. Clamping
 * rather than rejecting keeps one setting serving both paths.
 */
export const MIN_CULL_BREED_WEIGHT = 0.05;

/**
 * Exactly the weight `safeCullSet` prices in, floor and all.
 *
 * Exported so anything measuring the walk's cost against a capability total
 * uses the same units it does. Re-deriving the clamp at the call site is how
 * the two drift apart and an honest walk starts failing its own invariant.
 */
export function cullBenefitWeight(genes: ParsedGenes, focus?: string, lockWeight?: number): BenefitWeight | undefined {
  return breedReachFor(genes, focus, lockWeight, MIN_CULL_BREED_WEIGHT);
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
   * The breed being bred toward, valued at full weight alongside the
   * breed-generic loci. Omit for no commitment, where generic still leads
   * because it serves every target and a locked locus serves one.
   *
   * A weight, not a filter: other breeds' loci keep `breedLockWeight`, so
   * this never reports an animal as expendable on the strength of loci it
   * simply excluded. That is what lets `safeCullSet` take it too.
   */
  focusBreed?: string;
  /**
   * What a benefit locked to a non-focus breed is worth against a generic
   * one. Omit to derive `1 / breedCount` — 0.1 for horses.
   */
  breedLockWeight?: number;
}

export interface StableScores {
  /**
   * Per-animal result, keyed by pet id. Present for every input pet that has
   * genome rows; see `unscored` for the rest.
   */
  scores: Map<number, GeneticQualityResult>;
  /**
   * Pets with no `pet_genes` rows — nothing imported, or a genome that failed
   * to parse. Left out of `scores` rather than scored as empty, because an
   * empty genome reads as "contributes nothing", which is the vocabulary for
   * *redundant*, and a pet nobody has measured is not that.
   */
  unscored: number[];
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
    return { scores: new Map(), unscored: [], shares: new Map(), meaningful: false };
  }
  const { loci, genes, ids } = await loadInputs(opts.species, opts.pets);
  const scored = ids.filter((id) => loci.has(id));
  const scores = scoreGroup(loci, genes, scored, {
    weight: breedReachFor(genes, opts.focusBreed, opts.breedLockWeight),
  });
  return {
    scores,
    unscored: ids.filter((id) => !loci.has(id)),
    shares: capabilityShare(scores),
    meaningful: hasMeaningfulPopulation(scored.length),
  };
}

/**
 * Where the stable stands against what its allele pool could ever lock —
 * the readout that tells a breeder when "Reach new ground" has run out of
 * ground. Unstabled or benched animals must not be passed: the tally is
 * exactly the population handed in.
 */
export async function capabilitySummary(opts: { species: string; pets: readonly Pet[] }): Promise<CapabilitySummary> {
  const { loci, genes } = await loadInputs(opts.species, opts.pets);
  return summarise(loci.values(), genes);
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
  /**
   * Pairs the player intends to breed once the slots are free. The walk
   * never releases an animal if that would leave fewer than this many of
   * its sex. Defaults to `slots`, capped at what the animals left could
   * pair at all: six slots freed for six pairs is pointless if five males
   * remain, while a seven-animal stable freeing four can only ever breed one
   * pair and must not be told nothing is releasable.
   */
  pairs?: number;
  /**
   * Keep the stable's best animal by expressed positives and its best by
   * attribute total, whatever they score. On by default.
   *
   * The score prices what an animal can pass on, and once a founder's
   * alleles are covered by its foals it reads as free — correctly, for
   * breeding. But the animal you ride is the phenotype, and simulated over
   * twelve runs of twenty rounds the stable's current best by expressed
   * positives was released in 17 of 240 rounds, touching 8 of the 12 runs.
   * Pinning is the design's answer; this applies it before the player has to
   * think of it.
   */
  protectBest?: boolean;
  /**
   * `potential` (default) releases the animal costing the least capability.
   * `clean` orders by capability lost net of the negatives it takes with it,
   * so a liability-heavy animal goes first even when it holds something —
   * cleanliness bought with potential. See `SafeCullOrderOptions.netLiability`.
   */
  mode?: 'potential' | 'clean';
  /**
   * The breed being bred toward. Ranks its loci and the breed-generic ones
   * above the other breeds' — it does **not** discard them.
   *
   * Safe here only because it arrives as a weight. The hard version of this
   * is what design doc §5 forbids, and `MIN_CULL_BREED_WEIGHT` clamps
   * `breedLockWeight` so no setting can turn it back into one.
   */
  focusBreed?: string;
  /** As `ScoreStableOptions.breedLockWeight`, clamped to `MIN_CULL_BREED_WEIGHT`. */
  breedLockWeight?: number;
}

export interface CullRelease {
  pet: Pet;
  /** Capability lost by releasing it at this point in the sequence. */
  cost: number;
  /** The breed-generic part of `cost` — what no change of plan can recover. */
  genericCost: number;
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
  /** Negative-allele capability that leaves across the whole list. */
  totalCleared: number;
  /** The next release beyond the list and its cost, if the walk could continue. */
  next: { pet: Pet; cost: number } | null;
  /** Animals excluded from consideration — starred, plus any explicit pins. */
  pinned: Pet[];
  /** Kept as the stable's best by expressed positives or attribute total. */
  protectedBest: Pet[];
  /** Pets with no genome rows: never suggested, because "free" would be a guess. */
  unscored: Pet[];
  /** Males and females left after the listed releases, and the pairs they can form. */
  after: { males: number; females: number; pairs: number };
  /** Sexes the walk would not shrink further because they are at the pair floor. */
  atFloor: Gender[];
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
 * Takes `focusBreed` only as a weight. Releasing an animal is irreversible
 * against every breed you might later target — see the design doc §5, where
 * the *filtered* version of this recommended releasing the sole carrier of
 * three unrecoverable positives. Clamped at `MIN_CULL_BREED_WEIGHT` so no
 * locus can ever price at zero here.
 */
export async function safeCullSet(opts: SafeCullOptions): Promise<SafeCullSet> {
  const empty: SafeCullSet = {
    releases: [],
    totalCost: 0,
    totalCleared: 0,
    next: null,
    pinned: [],
    protectedBest: [],
    unscored: [],
    after: { males: 0, females: 0, pairs: 0 },
    atFloor: [],
  };
  if (opts.pets.length === 0) return empty;

  const { canonical, loci, genes, ids } = await loadInputs(opts.species, opts.pets);
  const byId = new Map(opts.pets.map((p) => [p.id, p]));
  const petsOf = (set: Iterable<number>) => [...set].map((id) => byId.get(id)).filter((p): p is Pet => p !== undefined);

  // Starred animals are pinned. The score measures breeding contribution and
  // nothing else; a mount earns its slot for reasons it cannot see, so the
  // exemption is declared by the player rather than inferred from stats.
  const pinned = new Set<number>(opts.pinned ?? []);
  for (const p of opts.pets) if (p.starred) pinned.add(p.id);

  // A pet with no genome rows would score zero and lead the list as "free".
  // Nothing is known about it, so it sits out and is reported as such.
  //
  // Dropped from the population outright rather than pinned. A pinned animal
  // still counts toward `MIN_POPULATION` — correctly, because its alleles stay
  // in the tally — but an unscored one contributes nothing to the tally, so
  // counting it would pad the floor with animals the measure cannot see. Nine
  // ghosts and three real horses would let the walk release all three and
  // leave a stable `scoreStable` then reports as not meaningful.
  const unscored = new Set<number>(ids.filter((id) => !loci.has(id)));
  const population = ids.filter((id) => !unscored.has(id));

  // Clamped, not rejected: the setting is shared with the roster, where 0 is
  // a legitimate "score this breed only".
  const weight = cullBenefitWeight(genes, opts.focusBreed, opts.breedLockWeight);

  const { primary, secondary } = buildTiebreaks(canonical, opts.pets, loci, genes);
  const protectedBest = new Set<number>();
  if (opts.protectBest ?? true) {
    const scorable = opts.pets.filter((p) => loci.has(p.id));
    // Strictly the best: when every animal ties there is no "best" to keep.
    // Co-maximal animals resolve by id, matching `safeCullOrder`'s final
    // tie-break — otherwise which animal is protected, and so which the walk
    // may release, would follow whatever order the roster happened to load in.
    const top = (value: (p: Pet) => number): Pet | null => {
      let best: Pet | null = null;
      let tied = true;
      for (const p of scorable) {
        if (best === null) best = p;
        else if (value(p) > value(best) || (value(p) === value(best) && p.id < best.id)) {
          if (value(p) !== value(best)) tied = false;
          best = p;
        } else if (value(p) !== value(best)) tied = false;
      }
      return tied ? null : best;
    };
    const byPositives = top((p) => p.positive_genes ?? 0);
    const byAttributes = top((p) => secondary.get(p.id)?.[0] ?? 0);
    for (const p of [byPositives, byAttributes]) if (p && !pinned.has(p.id)) protectedBest.add(p.id);
  }

  const sex = new Map<number, string>(opts.pets.map((p) => [p.id, p.gender]));
  const slots = opts.slots ?? 0;
  const floor = Math.max(0, opts.pairs ?? Math.min(slots, Math.floor((population.length - slots) / 2)));
  const excluded = new Set<number>([...pinned, ...protectedBest]);
  const order: SafeCullResult = safeCullOrder(loci, genes, population, {
    pinned: excluded,
    primaryTiebreak: primary,
    secondaryTiebreak: secondary,
    groupFloor: floor > 0 ? { group: sex, min: floor } : undefined,
    netLiability: opts.mode === 'clean',
    target: opts.slots,
    weight,
  });

  // `totalCost` comes from the walk, so the two totals must be summed over the
  // same steps — a step whose pet is missing from `byId` would otherwise count
  // toward the cost and not the clears.
  const releases: CullRelease[] = [];
  let totalCost = 0;
  let totalCleared = 0;
  for (const step of order.releases) {
    const pet = byId.get(step.id);
    if (!pet) continue;
    releases.push({
      pet,
      cost: step.cost,
      genericCost: step.genericCost,
      liabilityRemoved: step.liabilityRemoved,
    });
    totalCost += step.cost;
    totalCleared += step.liabilityRemoved;
  }

  // The walk names its own next pick, so its tie-breaks are honoured rather
  // than re-derived here.
  const nextPet = order.next ? byId.get(order.next.id) : undefined;
  const next = order.next && nextPet ? { pet: nextPet, cost: order.next.cost } : null;

  const released = new Set(order.releases.map((s) => s.id));
  const kept = opts.pets.filter((p) => !released.has(p.id));
  const males = kept.filter((p) => p.gender === Gender.MALE).length;
  const females = kept.filter((p) => p.gender === Gender.FEMALE).length;
  // Only a sex the floor actually held back. A sex with no members was never
  // constrained by it, and saying "no more males are suggested, so the pairs
  // stay possible" about a stable that has none reads as nonsense — and worse,
  // pre-empts the true reason the list is short.
  // Judged on what is left, not on the population the walk started from: an
  // animal already released is not a candidate the floor is holding back, so
  // counting it would blame the floor for what pinning actually caused.
  const releasable = (g: Gender) => kept.some((p) => p.gender === g && !excluded.has(p.id) && !unscored.has(p.id));
  const atFloor: Gender[] = [];
  if (floor > 0) {
    for (const [g, n] of [
      [Gender.MALE, males],
      [Gender.FEMALE, females],
    ] as const) {
      if (n > 0 && n <= floor && releasable(g)) atFloor.push(g);
    }
  }

  return {
    releases,
    totalCost,
    totalCleared,
    next,
    pinned: petsOf(pinned),
    protectedBest: petsOf(protectedBest),
    unscored: petsOf(unscored),
    after: { males, females, pairs: Math.min(males, females) },
    atFloor,
  };
}
