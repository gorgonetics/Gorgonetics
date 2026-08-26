/**
 * Marginal-capability math for the Genetic Quality Score (see
 * `docs/design/genetic-quality-score-v1.md`).
 *
 * The one idea this module exists to enforce: **a parent is worth what it
 * can pass on, not what it expresses.** `positive_genes` counts expressed
 * effects, so a heterozygous `x` at a recessive-positive locus scores zero
 * — yet that `x` may be the only thing standing between you and the
 * positive. Scoring transmissible *alleles* instead of expressed *effects*
 * is the whole point.
 *
 * The score answers one question, asked two ways:
 *
 *  - **Culling** — "what does my stable lose if this animal goes?"
 *    `scorePet` removes the animal from its own population and measures the
 *    capability that drops out.
 *  - **Breeding** — "what would this pairing add?" `expectedCapabilityGain`
 *    runs the same capability function forward over a foal's genotype
 *    distribution.
 *
 * Same function, different subject, so the two rankings cannot disagree
 * about what a good allele is.
 *
 * A first attempt scored benefit potential *absolutely* — how many good
 * alleles an animal transmits, with a bonus for homozygosity. The design
 * doc records why that failed: summed over 855 signed loci it reproduces
 * `positive_genes` (Spearman 0.63 → 0.81 as the bonus rises) and ranks two
 * known-good breeding horses 15th and 24th of 31. A locked allele twenty
 * other animals also have locked is not worth what a locked allele nobody
 * else carries is worth. Capability is measured against the rest of the
 * herd for exactly that reason.
 *
 * This is **not** the rarity lens. `geneFrequency` reads pool frequency as
 * an estimate of a global property; nothing here claims anything about the
 * world. It asks only "can I already breed this outcome from animals I
 * own", which is a fact about one stable and is *supposed* to move when
 * the stable does.
 *
 * Pure functions over already-loaded loci. No DB, no Svelte.
 */

import type { AlleleDistribution } from '$lib/types/index.js';
import { GeneType } from '$lib/types/index.js';
import type { GeneSignSummary } from '$lib/utils/breedingGenetics.js';
import { type LocusTally, RARITY_THRESHOLDS, type RarityOptions, rarityBucket } from '$lib/utils/geneFrequency.js';
import type { PetLoci } from '$lib/utils/petLoci.js';

/** The two transmissible alleles. `x` carries one of each; `?` carries neither. */
export type Allele = typeof GeneType.DOMINANT | typeof GeneType.RECESSIVE;

/**
 * What a population can do at one benefit slot.
 *
 *  - `1.0` — some animal is homozygous for the good allele, so the outcome
 *    can be bred true.
 *  - `0.5` — only carriers exist. Reachable, but never reliably.
 *  - `0` — nobody carries it. Out of reach from this stable entirely.
 *
 * **The 2:1 ratio is the whole weighting model.** It says a locked allele
 * is worth exactly twice a carried one, which is the "locked breeds true"
 * intuition expressed as a capability rather than a tuned bonus. An earlier
 * revision had a `TIER_WEIGHT` table and a `LOCK_BONUS` calibrated against
 * a reference collection; both are gone, because this derives what they
 * were approximating and there is nothing left to fit.
 */
export function capability(homozygotes: number, carriers: number): number {
  if (homozygotes > 0) return 1;
  return carriers > 0 ? 0.5 : 0;
}

/**
 * How well the rest of the stable supplies a benefit slot, as a label.
 * Exactly `capability` computed with this animal removed — the names exist
 * for display and explanation, not for arithmetic.
 *
 *  - `sole` — no *other* animal carries the allele (capability 0).
 *  - `partial` — other carriers, none homozygous (capability 0.5).
 *  - `secured` — another animal is homozygous (capability 1).
 *
 * Named apart from `breedingService`'s `CoverageTier`
 * (`locked`/`partial`/`missing`) because that one describes a pool
 * *including* the animal and this one excludes it. `GAP_WEIGHT`'s inert
 * `missing` tier has no analogue: tiers are only computed for an allele
 * the animal itself carries, so "nothing carries it" cannot arise.
 */
export type SupplyTier = 'sole' | 'partial' | 'secured';

/** The capability each tier stands for. */
export const TIER_CAPABILITY: Readonly<Record<SupplyTier, number>> = Object.freeze({
  sole: 0,
  partial: 0.5,
  secured: 1,
});

/**
 * Minimum stabled animals before the score means anything. In a one-animal
 * stable every slot tiers `sole` — true, useless, and it reads as a perfect
 * score. Mirrors `SOLE_CARRIER_MIN_PETS` in `geneFrequency`, same reason.
 */
export const MIN_POPULATION = 3;

/** A per-allele count at one locus, keyed by which allele carries it. */
export interface AlleleCounts {
  dom: number;
  rec: number;
}

/**
 * What one benefit slot is and which attribute it moves.
 *
 *  - `add` — the allele expresses a positive effect.
 *  - `clear` — the allele suppresses a negative effect the other allele
 *    would have expressed.
 *
 * `attribute` is the attribute the benefit lands on, which for a `clear` is
 * the attribute of the *negative being avoided* — not the one this allele
 * expresses. Getting that backwards silently mis-files half the
 * per-attribute breakdown at every chromosome-01 locus.
 */
export interface BenefitSlot {
  allele: Allele;
  kind: 'add' | 'clear';
  attribute: string | null;
}

/**
 * The gene metadata this module needs. Defined structurally so the utility
 * stays independent of the service layer; `ParsedGeneRecord` from
 * `geneService` satisfies it.
 */
export interface ScoredGene extends GeneSignSummary {
  dominantAttribute: string | null;
  recessiveAttribute: string | null;
  breed: string;
}

/**
 * Enumerate the good outcomes each allele at one locus could deliver.
 *
 * A `D` allele can **add a positive** (the dominant effect is good) or
 * **mask a negative** (the recessive effect is bad, and any `D` prevents
 * the homozygous-recessive genotype that would express it).
 *
 * An `R` allele can **add a positive** (the recessive effect is good) or
 * **be the half you need to escape a dominant negative** (only an `R/R`
 * offspring avoids it).
 *
 * Both can fire on the same allele. In the horse gene set that happens at
 * exactly 24 loci — the whole of chromosome 01, `Virility− / Temperament+`
 * — where `R` yields two slots and `D` yields none. Nowhere else in the
 * genome carries a double benefit.
 */
export function benefitSlots(gene: ScoredGene): BenefitSlot[] {
  const slots: BenefitSlot[] = [];
  if (gene.dominantSign === '+') {
    slots.push({ allele: GeneType.DOMINANT, kind: 'add', attribute: gene.dominantAttribute });
  }
  if (gene.recessiveSign === '-') {
    slots.push({ allele: GeneType.DOMINANT, kind: 'clear', attribute: gene.recessiveAttribute });
  }
  if (gene.recessiveSign === '+') {
    slots.push({ allele: GeneType.RECESSIVE, kind: 'add', attribute: gene.recessiveAttribute });
  }
  if (gene.dominantSign === '-') {
    slots.push({ allele: GeneType.RECESSIVE, kind: 'clear', attribute: gene.dominantAttribute });
  }
  return slots;
}

/**
 * Liability slots per allele: transmitting this allele can make an
 * offspring express a negative.
 *
 * Asymmetric with benefits on purpose. A transmitted `D` at a
 * dominant-negative locus **guarantees** expression, because `D` expresses
 * whenever present. A transmitted `R` at a recessive-negative locus only
 * bites if the other parent also passes `R`. Same count, different
 * severity — recorded here, not yet weighted (see the design doc §11).
 */
export function liabilityCounts(gene: GeneSignSummary): AlleleCounts {
  return {
    dom: gene.dominantSign === '-' ? 1 : 0,
    rec: gene.recessiveSign === '-' ? 1 : 0,
  };
}

/**
 * Probability this genotype passes `allele` to an offspring: 1 for the
 * matching homozygote, 0.5 for `x`, 0 otherwise. `?` passes nothing
 * knowable.
 */
export function transmissionProbability(type: GeneType, allele: Allele): number {
  if (type === GeneType.MIXED) return 0.5;
  return type === allele ? 1 : 0;
}

/** Does this genotype carry at least one copy of `allele`? */
export function carries(type: GeneType, allele: Allele): boolean {
  return type === GeneType.MIXED || type === allele;
}

/**
 * Per-locus homozygote and carrier counts over a population. Counts rather
 * than pre-divided frequencies because capability is a carrier question,
 * not a frequency question — the distinction that separates this module
 * from `geneFrequency`.
 */
export interface AlleleTally {
  /** Animals reading `D` — homozygous dominant, breeds true. */
  homD: number;
  /** Animals carrying at least one dominant allele (`D` or `x`). */
  carD: number;
  /** Animals reading `R` — homozygous recessive, breeds true. */
  homR: number;
  /** Animals carrying at least one recessive allele (`R` or `x`). */
  carR: number;
}

const EMPTY_TALLY: Readonly<AlleleTally> = Object.freeze({ homD: 0, carD: 0, homR: 0, carR: 0 });

/**
 * Tally homozygotes and carriers at every locus across a population.
 *
 * `?` contributes nothing — not to a carrier count and not to a homozygote
 * count. It means the owner's Genetics level had not revealed that gene,
 * uniformly across the whole collection, so a locus nobody can read must
 * never tier as `sole`.
 *
 * Deliberately unscoped by breed: which loci get *scored* is the caller's
 * decision, but a tally is per-gene and does not change with the offspring
 * breed under consideration.
 */
export function tallyAlleles(byPet: Iterable<PetLoci>): Map<string, AlleleTally> {
  const out = new Map<string, AlleleTally>();
  for (const loci of byPet) {
    for (const [geneId, type] of loci) {
      if (type !== GeneType.DOMINANT && type !== GeneType.RECESSIVE && type !== GeneType.MIXED) continue;
      let tally = out.get(geneId);
      if (!tally) {
        tally = { homD: 0, carD: 0, homR: 0, carR: 0 };
        out.set(geneId, tally);
      }
      if (type === GeneType.DOMINANT) {
        tally.homD += 1;
        tally.carD += 1;
      } else if (type === GeneType.RECESSIVE) {
        tally.homR += 1;
        tally.carR += 1;
      } else {
        tally.carD += 1;
        tally.carR += 1;
      }
    }
  }
  return out;
}

/** The tally for a locus, or an all-zero tally if absent. */
export function tallyFor(tallies: Map<string, AlleleTally>, geneId: string): AlleleTally {
  return tallies.get(geneId) ?? EMPTY_TALLY;
}

/** Homozygote and carrier counts for one allele of a tally. */
function countsFor(tally: AlleleTally, allele: Allele): { hom: number; car: number } {
  return allele === GeneType.DOMINANT ? { hom: tally.homD, car: tally.carD } : { hom: tally.homR, car: tally.carR };
}

/**
 * How well the rest of the stable supplies `allele`, excluding the animal
 * whose genotype is `ownType`.
 *
 * Leave-one-out is the whole point: without it every carrier reads its own
 * allele back as coverage and a sole source looks no different from a
 * common allele. Callers must only ask about an allele the animal actually
 * carries — the counts are decremented on that assumption, and clamped so
 * a stale or unscoped tally cannot produce a negative.
 */
export function supplyTier(tally: AlleleTally, allele: Allele, ownType: GeneType): SupplyTier {
  const { hom, car } = countsFor(tally, allele);
  const otherHomozygotes = Math.max(0, hom - (ownType === allele ? 1 : 0));
  if (otherHomozygotes > 0) return 'secured';
  return Math.max(0, car - 1) > 0 ? 'partial' : 'sole';
}

/**
 * Capability this animal alone contributes at a slot it carries: 1 if it
 * breeds the allele true, 0.5 if it merely carries it.
 */
function ownCapability(ownType: GeneType, allele: Allele): number {
  return ownType === allele ? 1 : 0.5;
}

export interface ScorePetOptions {
  /**
   * Restrict scoring to loci this predicate accepts — used for the
   * offspring-breed filter. Omit to score every locus regardless of breed
   * lock, the default, because offspring can be of a breed neither parent
   * is, which makes a third breed's allele live material rather than dead
   * weight.
   */
  scopeToBreed?: (gene: ScoredGene) => boolean;
}

export interface GeneticQualityResult {
  /**
   * The headline: capability that would leave with this animal, in units of
   * benefit slots × reliability. Zero means everything it supplies is
   * available elsewhere — nothing is lost by letting it go.
   */
  atRiskCapability: number;
  /** Benefit slots no other animal carries at all. */
  soleSourceSlots: number;
  /** Benefit slots no other animal can breed true, though carriers exist. */
  soleLockSlots: number;
  /**
   * Negative-allele capability that would also leave — the upside of
   * culling. Reported beside the headline, never netted into it: a breeder
   * wants both numbers, and the house precedent is separate columns over
   * composites.
   */
  liabilityAtRisk: number;
  /**
   * `atRiskCapability` split by the attribute each benefit targets. Keys
   * are lowercase, as stored in the parsed effect columns; a benefit whose
   * gene names no attribute is omitted rather than bucketed under a
   * placeholder.
   */
  byAttribute: Record<string, number>;
}

function emptyResult(): GeneticQualityResult {
  return { atRiskCapability: 0, soleSourceSlots: 0, soleLockSlots: 0, liabilityAtRisk: 0, byAttribute: {} };
}

/**
 * Score one animal by the capability that would leave with it.
 *
 * `tallies` must be built from a population that **includes** this animal —
 * the leave-one-out step subtracts it back out. Passing a tally that
 * already excludes it double-discounts and understates every slot.
 */
export function scorePet(
  loci: PetLoci,
  genes: Readonly<Record<string, ScoredGene>>,
  tallies: Map<string, AlleleTally>,
  opts: ScorePetOptions = {},
): GeneticQualityResult {
  const result = emptyResult();

  for (const [geneId, type] of loci) {
    if (type === GeneType.UNKNOWN) continue;
    const gene = genes[geneId];
    if (!gene) continue;
    if (opts.scopeToBreed && !opts.scopeToBreed(gene)) continue;

    const slots = benefitSlots(gene);
    const liabilities = liabilityCounts(gene);
    if (slots.length === 0 && liabilities.dom === 0 && liabilities.rec === 0) continue;

    const tally = tallyFor(tallies, geneId);

    for (const allele of [GeneType.DOMINANT, GeneType.RECESSIVE] as const) {
      if (!carries(type, allele)) continue;
      const tier = supplyTier(tally, allele, type);
      const without = TIER_CAPABILITY[tier];
      const delta = Math.max(0, ownCapability(type, allele) - without);
      if (delta === 0) continue;

      for (const slot of slots) {
        if (slot.allele !== allele) continue;
        const value = delta;
        result.atRiskCapability += value;
        if (tier === 'sole') result.soleSourceSlots += 1;
        else if (tier === 'partial' && type === allele) result.soleLockSlots += 1;
        if (slot.attribute) {
          result.byAttribute[slot.attribute] = (result.byAttribute[slot.attribute] ?? 0) + value;
        }
      }

      const liability = allele === GeneType.DOMINANT ? liabilities.dom : liabilities.rec;
      if (liability > 0) result.liabilityAtRisk += delta * liability;
    }
  }

  return result;
}

/**
 * Share of a stable's total at-risk capability held by each animal.
 *
 * The denominator that makes a percentage honest. "56% of your stable's
 * irreplaceable genetics" is a real quantity against a real total, unlike a
 * fraction of a perfect-genome ideal — which, being a constant, cannot
 * change any ranking and merely rescales the absolute score this module
 * exists to avoid.
 *
 * Returns 0 for every animal when nothing in the stable is irreplaceable.
 */
export function capabilityShare(results: Iterable<[number, GeneticQualityResult]>): Map<number, number> {
  const entries = [...results];
  const total = entries.reduce((sum, [, r]) => sum + r.atRiskCapability, 0);
  const out = new Map<number, number>();
  for (const [id, r] of entries) {
    out.set(id, total > 0 ? (100 * r.atRiskCapability) / total : 0);
  }
  return out;
}

/** Whether a population is large enough for the score to mean anything. */
export function hasMeaningfulPopulation(size: number): boolean {
  return size >= MIN_POPULATION;
}

/**
 * Score every animal in a group against that same group.
 *
 * The tally is built from exactly `ids`, which is what makes the score
 * relative to the group under consideration rather than to some wider
 * population. `safeCullOrder` relies on that: it re-scores a shrinking set
 * and needs each pass measured against what is actually left.
 *
 * Animals with no entry in `lociByPet` are scored as empty rather than
 * skipped, so a caller iterating the result never has to distinguish
 * "not imported" from "contributes nothing" — both read zero.
 */
export function scoreGroup(
  lociByPet: Map<number, PetLoci>,
  genes: Readonly<Record<string, ScoredGene>>,
  ids: readonly number[],
  opts: ScorePetOptions = {},
): Map<number, GeneticQualityResult> {
  const empty: PetLoci = new Map();
  const tallies = tallyAlleles(ids.map((id) => lociByPet.get(id) ?? empty));
  const out = new Map<number, GeneticQualityResult>();
  for (const id of ids) {
    out.set(id, scorePet(lociByPet.get(id) ?? empty, genes, tallies, opts));
  }
  return out;
}

/**
 * Rarity floor counted by `rareBenefitAlleles`: the first ordinal step below
 * the last frequency threshold in `geneFrequency`. Steps above it (sole
 * carrier, never seen) count too. Derived from `RARITY_THRESHOLDS` rather
 * than written as `3`, so recalibrating the lens cannot silently move what
 * "rare" means here.
 */
const RARE_BUCKET_FLOOR = RARITY_THRESHOLDS.length;

/**
 * Benefit alleles this animal carries that are rare in the population.
 *
 * Deliberately delegates to `geneFrequency.rarityBucket` rather than
 * recomputing: rarity already has one definition in this app, including its
 * sample-size gates, and a second one would drift.
 *
 * **Counted on the ordinal scale, not the raw frequency, and that is the
 * point.** A continuous rarity value resolves every tie it is given, which
 * leaves any criterion behind it dead code. Bucketing collapses the near-
 * identical members of a sibling cluster back into genuine ties, so a later
 * criterion can decide between them.
 *
 * Restricted to benefit-bearing alleles. Rarity over every locus is
 * dominated by the ~520 unsigned ones and ranks animals by how genetically
 * unusual they are rather than by how much rare *useful* material they hold.
 */
export function rareBenefitAlleles(
  loci: PetLoci,
  genes: Readonly<Record<string, ScoredGene>>,
  frequencies: Map<string, LocusTally>,
  opts: RarityOptions = {},
): number {
  let count = 0;
  for (const [geneId, type] of loci) {
    if (type === GeneType.UNKNOWN) continue;
    const gene = genes[geneId];
    if (!gene) continue;
    const tally = frequencies.get(geneId);
    if (!tally) continue;
    for (const slot of benefitSlots(gene)) {
      if (!carries(type, slot.allele)) continue;
      const bucket = rarityBucket(tally, slot.allele, opts);
      if (bucket !== null && bucket >= RARE_BUCKET_FLOOR) count += 1;
    }
  }
  return count;
}

/** One animal's position in the greedy release order. */
export interface CullStep {
  id: number;
  /** Capability lost by releasing it at this point in the sequence. */
  cost: number;
  /** Liability that leaves with it — the tie-break among free releases. */
  liabilityRemoved: number;
}

export interface SafeCullOrderOptions {
  /**
   * Animals excluded from release outright, whatever they score. The
   * genetic measure has no view on why an animal is wanted — a mount is
   * kept for reasons no genome explains — so the exemption is declared, not
   * inferred.
   */
  pinned?: ReadonlySet<number>;
  /**
   * Compared **before** liability, ascending. Lower is released first.
   * The service supplies rare-benefit-allele counts.
   *
   * Rarity outranks liability deliberately: a rare beneficial allele, once
   * released, may be unrecoverable, whereas a negative allele can be bred
   * out later. Irreversible loss beats a temporary cost. Measured on the
   * reference stable, liability-first fires exactly once in nine — and
   * fires on the animal holding the most rare material.
   */
  primaryTiebreak?: ReadonlyMap<number, readonly number[]>;
  /**
   * Compared **after** liability, ascending. The service supplies the
   * attribute total, which only ever separates animals the genetic measure
   * has already called equal — a determinism device, not a value axis. A
   * mount is kept by pinning it, not by out-scoring the genome.
   */
  secondaryTiebreak?: ReadonlyMap<number, readonly number[]>;
}

/**
 * Two tuples rather than one because liability is **not** precomputable:
 * `liabilityAtRisk` is itself leave-one-out, so it changes as the herd
 * shrinks and can only be measured inside the walk. That forces the
 * caller's criteria to be split around it.
 */

/** Lexicographic ascending compare of two tie-break tuples. */
function compareTiebreak(a: readonly number[], b: readonly number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface SafeCullResult {
  /**
   * The chosen releases **in order**. Order is load bearing: each step's
   * cost is measured against what remained at that point, so the set is
   * only this cheap if released as this sequence.
   *
   * With a `target`, the list is that long (or shorter if the population
   * floor intervened) and may contain steps that cost something. Without
   * one, it stops at the first release that would cost anything.
   */
  releases: CullStep[];
  /** Capability lost across the whole list. */
  totalCost: number;
  /**
   * What the next release beyond the list would cost, or `null` when the
   * population floor ended the walk. Lets the UI say "a seventh would cost
   * 0.5" rather than the list just stopping.
   */
  nextCost: number | null;
}

/**
 * Choose which animals to release, greedily, cheapest first.
 *
 * The real question is "the game lets me breed six pairs, so I must free
 * six slots — which six, and what does it cost me?" With `target` set the
 * walk returns exactly that many (subject to the floor) even when some cost
 * something; without it, it stops at the first release that would.
 *
 * **Why this exists rather than sorting by `scorePet`:** leave-one-out is
 * not additive. Where two animals are the only carriers of an allele, each
 * scores zero — the other covers it — yet releasing both loses the allele.
 * Selecting the bottom N from a sorted column is exactly that mistake; on
 * the reference stable it costs 0.5 capability that the individual scores
 * all reported as free. Re-scoring after each removal is what makes the
 * answer honest, and it is why the result is an ordered list rather than a
 * set.
 *
 * Takes no breed scope, deliberately. A breeding plan commits to one
 * pairing and may be scoped to the breed it targets; releasing an animal is
 * irreversible against every breed you might later target, so a cull must
 * be judged over all loci. See the design doc §5 — a breed-scoped cull
 * score recommends releasing the sole carrier of unrecoverable positives.
 *
 * Stops at `MIN_POPULATION`: below it every slot tiers `sole` and the
 * measure stops discriminating, so it must not keep authorising releases.
 */
export function safeCullOrder(
  lociByPet: Map<number, PetLoci>,
  genes: Readonly<Record<string, ScoredGene>>,
  ids: readonly number[],
  opts: SafeCullOrderOptions & { target?: number } = {},
): SafeCullResult {
  const pinned = opts.pinned ?? new Set<number>();
  const primary = opts.primaryTiebreak;
  const secondary = opts.secondaryTiebreak;
  const target = opts.target;
  const remaining = [...ids];
  const releases: CullStep[] = [];
  let totalCost = 0;

  const pick = (): CullStep | null => {
    const scored = scoreGroup(lociByPet, genes, remaining);
    let best: CullStep | null = null;
    for (const id of remaining) {
      if (pinned.has(id)) continue;
      const r = scored.get(id);
      if (!r) continue;
      const step: CullStep = { id, cost: r.atRiskCapability, liabilityRemoved: r.liabilityAtRisk };
      if (best === null) {
        best = step;
        continue;
      }
      // Cheapest first; then the caller's primary criterion (rarity); then
      // the animal whose departure clears the most negatives; then the
      // secondary criterion (attributes); then id, so the walk is
      // deterministic rather than dependent on input order.
      const cmpPrimary = primary ? compareTiebreak(primary.get(step.id) ?? [], primary.get(best.id) ?? []) : 0;
      const cmpSecondary = secondary ? compareTiebreak(secondary.get(step.id) ?? [], secondary.get(best.id) ?? []) : 0;
      const better =
        step.cost !== best.cost
          ? step.cost < best.cost
          : cmpPrimary !== 0
            ? cmpPrimary < 0
            : step.liabilityRemoved !== best.liabilityRemoved
              ? step.liabilityRemoved > best.liabilityRemoved
              : cmpSecondary !== 0
                ? cmpSecondary < 0
                : step.id < best.id;
      if (better) best = step;
    }
    return best;
  };

  while (remaining.length > MIN_POPULATION) {
    if (target !== undefined && releases.length >= target) break;
    const best = pick();
    if (best === null) break;
    // Without a target, stop before paying anything.
    if (target === undefined && best.cost > 0) return { releases, totalCost, nextCost: best.cost };
    releases.push(best);
    totalCost += best.cost;
    remaining.splice(remaining.indexOf(best.id), 1);
  }

  const next = remaining.length > MIN_POPULATION ? pick() : null;
  return { releases, totalCost, nextCost: next ? next.cost : null };
}

/**
 * Capability a foal is expected to add at one locus, given its genotype
 * distribution and what the stable can already do.
 *
 * The breeding-side counterpart of `scorePet`, running the same capability
 * function forward instead of backward. Because a foal can only realise
 * capability its parents actually supply, an allele nobody carries can
 * never be credited — which is precisely the `missing`-tier problem that
 * made `GAP_WEIGHT`'s top tier inert in the Breeding Assistant.
 *
 * `tally` must cover the whole stable, parents included: a pairing that
 * merely reproduces what the herd already breeds true adds nothing, and
 * that has to fall out of the arithmetic rather than be special-cased.
 */
export function expectedCapabilityGain(dist: AlleleDistribution, gene: ScoredGene, tally: AlleleTally): number {
  let gain = 0;
  for (const slot of benefitSlots(gene)) {
    const { hom, car } = countsFor(tally, slot.allele);
    const base = capability(hom, car);
    if (base >= 1) continue;
    const pHomozygous = slot.allele === GeneType.DOMINANT ? dist.D : dist.R;
    gain += pHomozygous * (1 - base) + dist.x * Math.max(0, 0.5 - base);
  }
  return gain;
}
