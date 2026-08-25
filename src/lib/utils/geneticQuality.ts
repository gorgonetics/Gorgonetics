/**
 * Benefit-potential math for the Genetic Quality Score (see
 * `docs/design/genetic-quality-score-v1.md`).
 *
 * The one idea this module exists to enforce: **a parent is worth what it
 * can pass on, not what it expresses.** `positive_genes` counts expressed
 * effects, so a heterozygous `x` at a recessive-positive locus scores zero
 * — yet that `x` is the only thing standing between you and the positive.
 * Scoring transmissible *alleles* instead of expressed *effects* is the
 * whole point.
 *
 * Two halves, deliberately separable:
 *
 *  1. **Benefit potential** (`benefitCounts` × `transmissionWeight`) — how
 *     many distinct good outcomes the allele this pet can transmit could
 *     deliver, scaled by how reliably it transmits it. Intrinsic to the
 *     pet; no population needed.
 *  2. **Supply tier** (`supplyTier`) — how well the *rest* of the stable
 *     already covers that same benefit. Leave-one-out, so a pet never
 *     tiers itself.
 *
 * Half 1 alone does not work, and the design doc records the measurement
 * that proves it: summed over 855 signed loci it reproduces
 * `positive_genes` (Spearman 0.63 → 0.81 as the lock bonus rises) and
 * ranks two known-good breeding horses 15th and 24th of 31. A locked
 * allele twenty other pets also have locked is not worth what a locked
 * allele nobody else carries is worth. Half 2 is that correction.
 *
 * This is **not** the rarity lens. `geneFrequency` reads pool frequency as
 * an estimate of a global property; the tiers here make no claim about the
 * world at all — only "can I already breed this outcome from animals I
 * own", which is a fact about one stable and is supposed to move when the
 * stable does.
 *
 * Pure functions over already-loaded loci. No DB, no Svelte.
 */

import { GeneType } from '$lib/types/index.js';
import type { GeneSignSummary } from '$lib/utils/breedingGenetics.js';
import type { PetLoci } from '$lib/utils/petLoci.js';

/** The two transmissible alleles. `x` carries one of each; `?` carries neither. */
export type Allele = typeof GeneType.DOMINANT | typeof GeneType.RECESSIVE;

/**
 * How well the rest of the stable already supplies a benefit slot. Named
 * apart from `breedingService`'s `CoverageTier` on purpose: that one
 * describes a whole candidate pool including the pet, this one excludes it.
 *
 *  - `sole` — no *other* pet carries the allele. Only this pet can supply it.
 *  - `partial` — other carriers exist, but none breeds it true.
 *  - `secured` — another pet is homozygous for it; the herd already has it.
 *
 * `GAP_WEIGHT`'s inert `missing` tier has no analogue here. Tiers are only
 * ever computed for an allele the pet itself carries, so "nothing carries
 * it" cannot arise.
 */
export type SupplyTier = 'sole' | 'partial' | 'secured';

/**
 * Weight per supply tier. Calibrated against a real 31-horse collection
 * rather than guessed — same method as `RARITY_THRESHOLDS`, and the
 * rationale is in the design doc §4.
 *
 * These values were chosen for **robustness, not fit**: they are the only
 * sweep row whose ranking survives the entire `LOCK_BONUS` range 0 → 1.
 * Shallower spreads (e.g. reusing `GAP_WEIGHT`'s 2/1.2/0.6) make the lock
 * bonus load-bearing — one known-good horse walks from 2nd to 22nd as the
 * bonus goes 0 → 1 — which would leave nobody able to tune it later
 * without silently inverting the result.
 *
 * `secured` is 0.25 and not 0: an allele the herd already locked still
 * transmits, so it is worth a little. Zeroing it collapses the score into
 * a bare sole-source count (top-vs-median spread jumps from 1.8 to 16.4).
 */
export const TIER_WEIGHT: Readonly<Record<SupplyTier, number>> = Object.freeze({
  sole: 4,
  partial: 1.5,
  secured: 0.25,
});

/**
 * Extra credit for transmitting an allele with certainty. A homozygote
 * always passes its allele and breeds true, which is worth more than twice
 * a heterozygote's coin flip — hence a bonus on top of the linear
 * probability rather than a rescaling of it.
 *
 * Kept small. The design doc records why: applied to the *absolute* score
 * this term rewards the homozygous inbred core of a stable and buries the
 * outcrossed carriers the score exists to find. It is safe here only
 * because `TIER_WEIGHT` makes it marginal.
 */
export const LOCK_BONUS = 0.25;

/**
 * Minimum stabled pets before the score is meaningful. In a one-pet stable
 * every slot tiers `sole` (nothing else can supply anything), which is
 * true, useless, and reads as a perfect score. Mirrors
 * `SOLE_CARRIER_MIN_PETS` in `geneFrequency` and for the same reason.
 */
export const MIN_POPULATION = 3;

/** Distinct benefits each allele at one locus could deliver. */
export interface BenefitCounts {
  /** Benefits carried by the dominant allele. */
  dom: number;
  /** Benefits carried by the recessive allele. */
  rec: number;
}

/**
 * What one benefit slot is and which attribute it moves.
 *
 *  - `add` — the allele expresses a positive effect.
 *  - `clear` — the allele suppresses a negative effect the other allele
 *    would have expressed.
 *
 * `attribute` is the attribute the benefit lands on, which for a `clear`
 * is the attribute of the *negative being avoided* — not the one this
 * allele expresses. Getting that backwards silently mis-files half the
 * per-attribute breakdown at every chromosome-01 locus.
 */
export interface BenefitSlot {
  allele: Allele;
  kind: 'add' | 'clear';
  attribute: string | null;
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
 * How many distinct good outcomes each allele could deliver at one locus.
 * The scalar summary of `benefitSlots`, kept for the tier/weight tests and
 * because it states the rule in one line.
 */
export function benefitCounts(gene: GeneSignSummary): BenefitCounts {
  return {
    dom: (gene.dominantSign === '+' ? 1 : 0) + (gene.recessiveSign === '-' ? 1 : 0),
    rec: (gene.recessiveSign === '+' ? 1 : 0) + (gene.dominantSign === '-' ? 1 : 0),
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

/**
 * Transmission probability with the certainty bonus applied. Superlinear
 * at `p === 1` by construction — see `LOCK_BONUS`.
 */
export function transmissionWeight(type: GeneType, allele: Allele, lockBonus = LOCK_BONUS): number {
  const p = transmissionProbability(type, allele);
  return p === 1 ? 1 + lockBonus : p;
}

/**
 * Per-locus homozygote and carrier counts over a population. Stores counts
 * rather than pre-divided frequencies because the tiers are carrier
 * questions, not frequency questions — the distinction that separates this
 * module from `geneFrequency`.
 */
export interface AlleleTally {
  /** Pets reading `D` — homozygous dominant, breeds true. */
  homD: number;
  /** Pets carrying at least one dominant allele (`D` or `x`). */
  carD: number;
  /** Pets reading `R` — homozygous recessive, breeds true. */
  homR: number;
  /** Pets carrying at least one recessive allele (`R` or `x`). */
  carR: number;
}

const EMPTY_TALLY: Readonly<AlleleTally> = Object.freeze({ homD: 0, carD: 0, homR: 0, carR: 0 });

/**
 * Tally homozygotes and carriers at every locus across a population.
 *
 * `?` contributes nothing — not to a carrier count and not to a
 * homozygote count. It means the owner's Genetics level had not revealed
 * that gene, uniformly across the whole collection, so a locus nobody can
 * read must never tier as `sole`.
 *
 * Deliberately unscoped by breed: which loci get *scored* is a scoping
 * decision made by the caller, but a tally is per-gene and does not change
 * with the offspring breed under consideration.
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

/**
 * How well the rest of the stable supplies `allele`, excluding the pet
 * whose genotype is `ownType`.
 *
 * Leave-one-out is the whole point: without it every carrier reads its own
 * allele back as `partial` coverage and a sole source looks no different
 * from a common allele. Callers must only ask about an allele the pet
 * actually carries — the counts are decremented on that assumption, and
 * clamped so a stale or unscoped tally cannot produce a negative.
 */
export function supplyTier(tally: AlleleTally, allele: Allele, ownType: GeneType): SupplyTier {
  const dominant = allele === GeneType.DOMINANT;
  const ownIsHomozygous = ownType === allele;
  const others = Math.max(0, (dominant ? tally.homD : tally.homR) - (ownIsHomozygous ? 1 : 0));
  if (others > 0) return 'secured';
  const otherCarriers = Math.max(0, (dominant ? tally.carD : tally.carR) - 1);
  return otherCarriers > 0 ? 'partial' : 'sole';
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

export interface ScorePetOptions {
  /** Tunable for the calibration tests; defaults to the calibrated constant. */
  lockBonus?: number;
  /** Tunable for the calibration tests; defaults to the calibrated weights. */
  tierWeight?: Readonly<Record<SupplyTier, number>>;
  /**
   * Restrict scoring to loci that are breed-generic or locked to this
   * breed. Omit to score every locus regardless of breed lock — the
   * default, because offspring can be of a breed neither parent is, which
   * makes a third breed's allele live material rather than dead weight.
   */
  scopeToBreed?: (gene: ScoredGene) => boolean;
}

export interface GeneticQualityResult {
  /** The headline: summed benefit potential, tier-weighted. */
  score: number;
  /** Benefit slots only this pet can supply (`sole` tier). */
  soleSourceSlots: number;
  /** Benefit slots this pet transmits with certainty (homozygous). */
  lockedSlots: number;
  /** Benefit slots this pet transmits at 50% (heterozygous). */
  carriedSlots: number;
  /**
   * Score split by the attribute each benefit targets. Attribute keys are
   * lowercase, as stored in the parsed effect columns; a benefit whose
   * gene names no attribute is omitted rather than bucketed under a
   * placeholder.
   */
  byAttribute: Record<string, number>;
}

function emptyResult(): GeneticQualityResult {
  return { score: 0, soleSourceSlots: 0, lockedSlots: 0, carriedSlots: 0, byAttribute: {} };
}

/**
 * Score one pet's transmissible benefit potential against a population
 * tally.
 *
 * `tallies` must be built from a population that **includes** this pet —
 * `supplyTier` subtracts it back out. Passing a tally that excludes the
 * pet double-discounts it and understates every tier.
 */
export function scorePet(
  loci: PetLoci,
  genes: Readonly<Record<string, ScoredGene>>,
  tallies: Map<string, AlleleTally>,
  opts: ScorePetOptions = {},
): GeneticQualityResult {
  const lockBonus = opts.lockBonus ?? LOCK_BONUS;
  const tierWeight = opts.tierWeight ?? TIER_WEIGHT;
  const result = emptyResult();

  for (const [geneId, type] of loci) {
    if (type === GeneType.UNKNOWN) continue;
    const gene = genes[geneId];
    if (!gene) continue;
    if (opts.scopeToBreed && !opts.scopeToBreed(gene)) continue;

    const slots = benefitSlots(gene);
    if (slots.length === 0) continue;

    for (const slot of slots) {
      const p = transmissionProbability(type, slot.allele);
      if (p === 0) continue;

      const tier = supplyTier(tallyFor(tallies, geneId), slot.allele, type);
      const weight = (p === 1 ? 1 + lockBonus : p) * tierWeight[tier];
      result.score += weight;
      if (tier === 'sole') result.soleSourceSlots += 1;
      if (p === 1) result.lockedSlots += 1;
      else result.carriedSlots += 1;

      if (slot.attribute) {
        result.byAttribute[slot.attribute] = (result.byAttribute[slot.attribute] ?? 0) + weight;
      }
    }
  }

  return result;
}
