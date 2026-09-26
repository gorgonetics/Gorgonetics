/**
 * Breeding Assistant scoring engine.
 *
 * Composes the per-locus `offspringDistribution` primitive across every
 * (Male × Female) pair in the input set. The per-attribute positive
 * accumulation is done inline rather than via `positiveExpressionProbability`
 * because the UI needs the contribution split *per attribute*, not the
 * single aggregate probability that helper returns.
 *
 * Reads from the pre-projected `pet_genes` table — no genome JSON parse
 * on the hot path — via the shared `petLoci` utility, and from the
 * cached parsed-effect columns on the `genes` table.
 */

import type { AlleleDistribution, BreedingPairResult, ParentExpressedProfile, Pet } from '$lib/types/index.js';
import { Gender, GeneType } from '$lib/types/index.js';
import {
  type AttributeCoverage,
  type AttributeMagnitudes,
  coverageOf,
  EMPTY_MAGNITUDES,
  hasMagnitudes,
  magnitudeOf,
} from '$lib/utils/attributePoints.js';
import { type Expression, slotKey } from '$lib/utils/attributeStudy.js';
import {
  expectedImprovement,
  expectedReduction,
  expressedSign,
  negativeExpressionProbability,
  offspringDistribution,
  positiveExpressionProbability,
} from '$lib/utils/breedingGenetics.js';
import {
  type AlleleTally,
  type BenefitWeight,
  breedReachFor,
  expectedCapabilityGain,
  tallyAlleles,
  tallyFor,
} from '$lib/utils/geneticQuality.js';
import { loadAllPetLoci, type PetLoci, walkPairLoci } from '$lib/utils/petLoci.js';
import { capitalize } from '$lib/utils/string.js';
import { getAllAttributeNames, normalizeSpecies } from './configService.js';
import { getParsedGenesCached, isHorseBreedFiltered, type ParsedGeneRecord } from './geneService.js';

/**
 * The (capitalized) attribute each positive slot targets, or null when that
 * slot isn't a named positive — a slot counts only when its sign is `'+'` and
 * it names an attribute. The single source of truth for slot eligibility,
 * shared by `accumulatePositive` and `ownExpressedProfile` so a foal and its
 * parents are counted over the same loci.
 */
function positiveSlots(gd: ParsedGeneRecord): { dom: string | null; rec: string | null } {
  return {
    dom: gd.dominantSign === '+' && gd.dominantAttribute ? capitalize(gd.dominantAttribute) : null,
    rec: gd.recessiveSign === '+' && gd.recessiveAttribute ? capitalize(gd.recessiveAttribute) : null,
  };
}

/**
 * The attribute each slot names, whatever its sign.
 *
 * Deliberately not `positiveSlots`. That one is the eligibility rule for
 * counting — a slot counts when it is a *positive* naming an attribute —
 * and the foal and parent counts share it so they cannot drift. Points need the
 * other set: an attribute's expected change is what the foal gains minus
 * what it loses, so a points figure built from positive slots alone would
 * rank a pairing adding `+5` and `-6` above one adding `+4`. Two rules
 * because there are two questions, each written once.
 */
function attributeSlots(gd: ParsedGeneRecord): { dom: string | null; rec: string | null } {
  return {
    dom: gd.dominantAttribute ? capitalize(gd.dominantAttribute) : null,
    rec: gd.recessiveAttribute ? capitalize(gd.recessiveAttribute) : null,
  };
}

export interface RankBreedingPairsOptions {
  /** Canonical or display species — passed through `normalizeSpecies`. */
  species: string;
  /**
   * Player-selected offspring breed. For horses, drives `isHorseBreedFiltered`
   * to skip breed-locked-to-other-breed loci. Optional / ignored for
   * species without breeds.
   */
  offspringBreed?: string;
  /**
   * What a benefit locked to a breed you are not breeding is worth against
   * a breed-generic one, for `evCapabilityGain`. Omit to derive
   * `1 / breedCount`.
   *
   * Only bites when no `offspringBreed` is committed — with one, the hard
   * filter has already dropped the other breeds and every surviving locus
   * weighs 1. Without one, it is the difference between "Reach new ground"
   * chasing the 677 breed-locked slots and chasing the 202 generic ones a
   * base animal is actually made of. See design doc §5a.
   */
  breedLockWeight?: number;
  /**
   * Pre-filtered candidate parents (caller is expected to pass only
   * stabled, same-species pets). The service splits by gender and ranks
   * every M × F pair; same-gender or empty inputs return [].
   */
  pets: Pet[];
  /**
   * Known effect sizes, from `attributeStudy` via
   * `attributeMagnitudesFor`. Supplied, the per-attribute figures are also
   * reported in points; omitted, the result carries counts alone and every
   * caller behaves exactly as before.
   *
   * Passed in rather than fetched here because the study is the expensive
   * half of it: the caller decides when to pay, and the trio view can score
   * one pair against the table the table view already loaded.
   */
  magnitudes?: AttributeMagnitudes;
}

/**
 * Add this locus's contribution to the per-attribute positive-expression
 * tally (`into`) and its variance, and return the locus's expected positive
 * count so the caller can keep the running total.
 *
 * Exported for the trio view, which attributes a pair's `+ genes` back to
 * individual loci. It calls this with scratch records it discards, keeping
 * one implementation of the slot math: a second copy would be free to drift
 * on which slots count, and the explanation would then contradict the column
 * it claims to explain.
 */
export function accumulatePositive(
  dist: AlleleDistribution,
  gd: ParsedGeneRecord,
  into: Record<string, number>,
  variance: Record<string, number>,
): number {
  const slots = positiveSlots(gd);
  let total = 0;
  let pDom = 0;
  let pRec = 0;
  if (slots.dom) {
    const p = dist.D + dist.x;
    if (p > 0) {
      pDom = p;
      into[slots.dom] = (into[slots.dom] ?? 0) + p;
      variance[slots.dom] = (variance[slots.dom] ?? 0) + p * (1 - p);
      total += p;
    }
  }
  if (slots.rec) {
    const p = dist.R;
    if (p > 0) {
      pRec = p;
      into[slots.rec] = (into[slots.rec] ?? 0) + p;
      variance[slots.rec] = (variance[slots.rec] ?? 0) + p * (1 - p);
      total += p;
    }
  }
  // No shipped gene template has both *positive* slots on one attribute
  // (checked across all horse and beewasp chromosomes), but gene tables are
  // user-editable, so the correction is applied rather than assumed away.
  if (slots.dom && slots.dom === slots.rec) exclusiveSlotCovariance(slots.dom, pDom, 1, pRec, 1, variance);
  return total;
}

/**
 * Correct one locus's per-attribute variance for its two slots being
 * mutually exclusive rather than independent.
 *
 * `D∨x` and `R` cannot both occur, so when both slots of a locus land on the
 * *same* attribute its contribution is `m_d·1[dom] + m_r·1[rec]` with the two
 * indicators disjoint. `Var(X) = E[X²] − E[X]²` then carries a
 * `−2·m_d·m_r·p_d·p_r` term that summing each slot's own `m²p(1−p)` misses.
 * Same-sign slots make that sum an overstatement, opposite-sign slots an
 * understatement.
 *
 * Not hypothetical: the shipped horse table declares `Enthusiasm-` dominant
 * against `Enthusiasm+` recessive on `01A4`, `01C3` and `01E2`, so points
 * scoring understates the spread on Enthusiasm without this.
 *
 * Slots on *different* attributes need nothing — each attribute's variance
 * then sees a single indicator, for which the Bernoulli variance is exact.
 */
function exclusiveSlotCovariance(
  attribute: string,
  pDom: number,
  mDom: number,
  pRec: number,
  mRec: number,
  variance: Record<string, number>,
): void {
  if (pDom <= 0 || pRec <= 0) return;
  variance[attribute] = (variance[attribute] ?? 0) - 2 * mDom * mRec * pDom * pRec;
}

/**
 * Square root of an accumulated variance, floored at zero.
 *
 * Every locus contributes a genuine (non-negative) variance, so the sum is
 * non-negative in exact arithmetic. `exclusiveSlotCovariance` subtracts,
 * though, and a total that lands at `-1e-17` through rounding would turn the
 * whole improvement integral into `NaN`.
 */
function stdDev(variance: number): number {
  return Math.sqrt(Math.max(0, variance));
}

/**
 * Add this locus's contribution to the per-attribute *points* tally.
 *
 * The counting twin of this is `accumulatePositive`; the two differ in
 * three ways, each forced:
 *
 *  - every declared slot participates, not only the positive ones (see
 *    `attributeSlots`);
 *  - a slot with no known magnitude contributes nothing at all, rather than
 *    an imputed one — the study does not estimate and neither does this;
 *  - the variance is `m²p(1-p)`, not `p(1-p)`, because the quantity is a
 *    sum of scaled Bernoullis rather than a plain count, plus the
 *    `exclusiveSlotCovariance` correction where both slots name the same
 *    attribute. Getting this wrong would not move the expected value, only
 *    the improvement integral that reads the spread, which is exactly the
 *    kind of error that hides.
 *
 * Exported alongside `accumulatePositive` so the trio view can attribute a
 * points column back to individual loci with the same arithmetic.
 */
export function accumulatePoints(
  dist: AlleleDistribution,
  geneId: string,
  gd: ParsedGeneRecord,
  magnitudes: AttributeMagnitudes,
  into: Record<string, number>,
  variance: Record<string, number>,
): void {
  const slots = attributeSlots(gd);
  let pDom = 0;
  let mDom = 0;
  let pRec = 0;
  let mRec = 0;
  if (slots.dom) {
    const magnitude = magnitudeOf(magnitudes, geneId, 'dominant');
    if (magnitude !== undefined) {
      // A mixed locus expresses exactly as a dominant one, which is why the
      // study solves no separate `x` magnitude.
      const p = dist.D + dist.x;
      pDom = p;
      mDom = magnitude;
      into[slots.dom] = (into[slots.dom] ?? 0) + p * magnitude;
      variance[slots.dom] = (variance[slots.dom] ?? 0) + magnitude * magnitude * p * (1 - p);
    }
  }
  if (slots.rec) {
    const magnitude = magnitudeOf(magnitudes, geneId, 'recessive');
    if (magnitude !== undefined) {
      const p = dist.R;
      pRec = p;
      mRec = magnitude;
      into[slots.rec] = (into[slots.rec] ?? 0) + p * magnitude;
      variance[slots.rec] = (variance[slots.rec] ?? 0) + magnitude * magnitude * p * (1 - p);
    }
  }
  // Only when the study knows *both* magnitudes: an unknown slot contributes
  // no mass, so there is nothing for the exclusivity to correct.
  if (slots.dom && slots.dom === slots.rec) exclusiveSlotCovariance(slots.dom, pDom, mDom, pRec, mRec, variance);
}

const EMPTY_PROFILE: Readonly<ParentExpressedProfile> = Object.freeze({
  positives: 0,
  negatives: 0,
  positivesByAttribute: {},
});

/**
 * What a parent itself expresses, on exactly the loci and breed scope the
 * offspring EV uses — the baseline every improvement measure is judged
 * against.
 *
 * One walk, three figures. Positives, negatives and the per-attribute split
 * share the same loop, the same breed gate and the same expression rule, so
 * splitting them into three functions meant three passes over ~1,600 loci per
 * animal and three copies of the `D`/`x` vs `R` branching that
 * `expressedSign` already encodes.
 */
function ownExpressedProfile(
  loci: PetLoci,
  parsedGenes: Record<string, ParsedGeneRecord>,
  species: string,
  offspringBreed: string | undefined,
  magnitudes: AttributeMagnitudes,
): ParentExpressedProfile {
  const profile: ParentExpressedProfile = { positives: 0, negatives: 0, positivesByAttribute: {} };
  const points: Record<string, number> | null = hasMagnitudes(magnitudes) ? {} : null;
  for (const [geneId, type] of loci) {
    const gd = parsedGenes[geneId];
    if (!gd) continue;
    if (isHorseBreedFiltered(species, offspringBreed, gd.breed)) continue;
    const sign = expressedSign(type, gd);
    if (sign === '+') {
      profile.positives++;
      const slots = positiveSlots(gd);
      const attr = type === GeneType.RECESSIVE ? slots.rec : slots.dom;
      if (attr) profile.positivesByAttribute[attr] = (profile.positivesByAttribute[attr] ?? 0) + 1;
    } else if (sign === '-') {
      profile.negatives++;
    }
    // Points follow the same expression rule as the counts — `x` expresses
    // as dominant — but take the slot whatever its sign, and skip `?`,
    // which expresses nothing. Reading the slot off the type rather than
    // off `sign` keeps an unrevealed locus from being credited with the
    // dominant slot's magnitude.
    if (points && type !== GeneType.UNKNOWN) {
      const recessive = type === GeneType.RECESSIVE;
      const attr = recessive ? attributeSlots(gd).rec : attributeSlots(gd).dom;
      const magnitude = magnitudeOf(magnitudes, geneId, recessive ? 'recessive' : 'dominant');
      if (attr && magnitude !== undefined) points[attr] = (points[attr] ?? 0) + magnitude;
    }
  }
  if (points) profile.pointsByAttribute = points;
  return profile;
}

function emptyAttributeBreakdown(attrNames: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of attrNames) out[a] = 0;
  return out;
}

function scorePair(
  male: Pet,
  female: Pet,
  mLoci: PetLoci,
  fLoci: PetLoci,
  parsedGenes: Record<string, ParsedGeneRecord>,
  tallies: Map<string, AlleleTally>,
  ownProfiles: Map<number, ParentExpressedProfile>,
  offspringBreed: string | undefined,
  species: string,
  attrNames: readonly string[],
  weight: BenefitWeight | undefined,
  magnitudes: AttributeMagnitudes,
  pointAttributes: readonly string[],
): BreedingPairResult {
  const evPositiveByAttribute = emptyAttributeBreakdown(attrNames);
  const attributeVariance = emptyAttributeBreakdown(attrNames);
  // Only the attributes the study has measured *something* on. An attribute
  // with no findings would otherwise carry a row of zeroes that the
  // objectives would rank by, hiding the counts that are the best available
  // answer for it. Null when none qualify, so the fields are absent rather
  // than empty.
  const evPointsByAttribute = pointAttributes.length > 0 ? emptyAttributeBreakdown(pointAttributes) : null;
  const pointVariance = evPointsByAttribute ? emptyAttributeBreakdown(pointAttributes) : null;
  let evMixed = 0;
  let evUnknown = 0;
  let evPositiveTotal = 0;
  let evCapabilityGain = 0;
  // Variance of the offspring's positive count. Per-locus outcomes are
  // independent given the parents, so the count is Poisson-binomial and its
  // variance is the sum of p(1-p) — enough to say how likely the foal is to
  // clear a parent, not just where it lands on average.
  let positiveVariance = 0;
  let evNegativeTotal = 0;
  let negativeVariance = 0;
  let totalLoci = 0;

  walkPairLoci(mLoci, fLoci, (geneId, t1, t2) => {
    const gd = parsedGenes[geneId];
    if (isHorseBreedFiltered(species, offspringBreed, gd?.breed)) return;
    const dist = offspringDistribution(t1, t2);
    evMixed += dist.x;
    evUnknown += dist.unknown;
    totalLoci++;
    if (gd) {
      evPositiveTotal += accumulatePositive(dist, gd, evPositiveByAttribute, attributeVariance);
      if (evPointsByAttribute && pointVariance)
        accumulatePoints(dist, geneId, gd, magnitudes, evPointsByAttribute, pointVariance);
      // Breed reach: without a committed offspring breed every locus in the
      // genome is in play, and three-quarters of them belong to a breed this
      // foal will not be. Weighting keeps "Reach new ground" pointed at
      // material that stays useful whatever breed the player ends up on.
      evCapabilityGain += expectedCapabilityGain(dist, gd, tallyFor(tallies, geneId)) * (weight ? weight(gd) : 1);
      const pPos = positiveExpressionProbability(dist, gd);
      positiveVariance += pPos * (1 - pPos);
      const pNeg = negativeExpressionProbability(dist, gd);
      evNegativeTotal += pNeg;
      negativeVariance += pNeg * (1 - pNeg);
    }
  });

  const mProfile = ownProfiles.get(male.id) ?? EMPTY_PROFILE;
  const fProfile = ownProfiles.get(female.id) ?? EMPTY_PROFILE;
  const betterParentPositives = Math.max(mProfile.positives, fProfile.positives);
  const weakerParentPositives = Math.min(mProfile.positives, fProfile.positives);
  const sd = Math.sqrt(positiveVariance);
  const negativeSd = Math.sqrt(negativeVariance);
  const cleanerParentNegatives = Math.min(mProfile.negatives, fProfile.negatives);
  // Per-attribute improvement, each against the better parent *on that
  // attribute*. Targeting a weak trait is a strategy in its own right, and
  // the absolute per-attribute EV cannot express it — a pairing can lead on
  // Intelligence while being unable to improve on either parent's.
  const evAttributeImprovement: Record<string, number> = {};
  for (const attr of attrNames) {
    const baseline = Math.max(mProfile.positivesByAttribute[attr] ?? 0, fProfile.positivesByAttribute[attr] ?? 0);
    evAttributeImprovement[attr] = expectedImprovement(
      evPositiveByAttribute[attr] ?? 0,
      stdDev(attributeVariance[attr] ?? 0),
      baseline,
    );
  }
  // The same measure in points, where the corpus supports one. Baseline is
  // the better parent on that attribute, as above — a pairing that leads
  // the field on Intelligence while beating neither parent's is still the
  // local maximum, and points do not change that.
  let evAttributePointImprovement: Record<string, number> | undefined;
  if (evPointsByAttribute && pointVariance) {
    evAttributePointImprovement = {};
    for (const attr of pointAttributes) {
      const baseline = Math.max(mProfile.pointsByAttribute?.[attr] ?? 0, fProfile.pointsByAttribute?.[attr] ?? 0);
      evAttributePointImprovement[attr] = expectedImprovement(
        evPointsByAttribute[attr] ?? 0,
        stdDev(pointVariance[attr] ?? 0),
        baseline,
      );
    }
  }
  return {
    male,
    female,
    evMixed,
    evPositiveByAttribute,
    ...(evPointsByAttribute ? { evPointsByAttribute, evAttributePointImprovement } : {}),
    evPositiveTotal,
    evCapabilityGain,
    evPositiveImprovement: expectedImprovement(evPositiveTotal, sd, betterParentPositives),
    evPairUpgrade: expectedImprovement(evPositiveTotal, sd, weakerParentPositives),
    betterParentPositives,
    weakerParentPositives,
    evAttributeImprovement,
    evNegativeTotal,
    evLiabilityReduction: expectedReduction(evNegativeTotal, negativeSd, cleanerParentNegatives),
    cleanerParentNegatives,
    maleProfile: mProfile,
    femaleProfile: fProfile,
    positiveSd: sd,
    negativeSd,
    evUnknown,
    totalLoci,
  };
}

/**
 * Restrict a magnitude table to the loci a given offspring breed can inherit.
 *
 * `attributeMagnitudesFor` reports coverage over the whole gene table,
 * because the study solves every breed at once. Scoring does not: a
 * committed offspring breed drops every breed-locked-to-another-breed locus
 * through `isHorseBreedFiltered`. Left unscoped, the two disagree in the
 * worst way — an attribute whose only measured slots belong to a breed the
 * player is not breeding still qualifies for a points column, which then
 * reads zero for every pair while its header advertises "1 of 9 measured".
 * The count column it displaced was the better answer.
 *
 * Scoping rebuilds both halves from the surviving loci, so coverage and
 * scoring are the same set by construction. Idempotent: re-scoping an
 * already-scoped table to the same breed is a no-op, which is what lets the
 * ranking apply it defensively without the caller having to know whether it
 * was already done.
 *
 * Private: callers outside this module hold no parsed gene table, so they
 * reach it through `magnitudesForBreed`.
 */
function scopeMagnitudesToBreed(
  magnitudes: AttributeMagnitudes,
  parsedGenes: Record<string, ParsedGeneRecord>,
  species: string,
  offspringBreed: string | undefined,
): AttributeMagnitudes {
  if (!hasMagnitudes(magnitudes)) return magnitudes;
  const points = new Map<string, number>();
  const coverage = new Map<string, AttributeCoverage>();
  for (const [geneId, gd] of Object.entries(parsedGenes)) {
    if (isHorseBreedFiltered(species, offspringBreed, gd.breed)) continue;
    const slots = attributeSlots(gd);
    for (const [expression, attribute] of [
      ['dominant', slots.dom],
      ['recessive', slots.rec],
    ] as Array<[Expression, string | null]>) {
      if (!attribute) continue;
      const magnitude = magnitudeOf(magnitudes, geneId, expression);
      const seen = coverage.get(attribute) ?? { known: 0, total: 0 };
      coverage.set(attribute, {
        known: seen.known + (magnitude === undefined ? 0 : 1),
        total: seen.total + 1,
      });
      if (magnitude !== undefined) points.set(slotKey({ gene: geneId, expression }), magnitude);
    }
  }
  return { points, coverage };
}

/**
 * `scopeMagnitudesToBreed` for callers that hold no parsed gene table — the
 * UI, which needs the same coverage figures the ranking used in order to
 * label the columns it renders.
 */
export async function magnitudesForBreed(
  magnitudes: AttributeMagnitudes,
  species: string,
  offspringBreed: string | undefined,
): Promise<AttributeMagnitudes> {
  if (!hasMagnitudes(magnitudes)) return magnitudes;
  const normalized = normalizeSpecies(species);
  const parsedGenes = await getParsedGenesCached(normalized);
  return scopeMagnitudesToBreed(magnitudes, parsedGenes, normalized, offspringBreed);
}

/**
 * Rank every (Male × Female) pair in the candidate set by their expected
 * offspring scores. Returns results in deterministic male-then-female
 * input order; the UI is responsible for sorting by whichever column
 * the player picks.
 */
export async function rankBreedingPairs(opts: RankBreedingPairsOptions): Promise<BreedingPairResult[]> {
  const males = opts.pets.filter((p) => p.gender === Gender.MALE);
  const females = opts.pets.filter((p) => p.gender === Gender.FEMALE);
  if (males.length === 0 || females.length === 0) return [];

  const species = normalizeSpecies(opts.species);
  const ids = [...males.map((p) => p.id), ...females.map((p) => p.id)];
  const [petLociMap, parsedGenes] = await Promise.all([loadAllPetLoci(ids), getParsedGenesCached(species)]);

  const attrNames = getAllAttributeNames(species).map(capitalize);
  const empty: PetLoci = new Map();
  const results: BreedingPairResult[] = [];

  // Capability is measured against the whole candidate pool, parents
  // included: a pairing that only reproduces what the stable already breeds
  // true must score nothing, and that has to fall out of the arithmetic.
  const tallies = tallyAlleles(petLociMap.values());
  // The focus is whatever breed the player committed to; with none, generic
  // loci simply outweigh the breed-locked ones.
  const weight = breedReachFor(parsedGenes, opts.offspringBreed, opts.breedLockWeight);
  // One pass per animal, not per pair: the baseline an offspring must beat.
  // Scoped to the committed breed first, so the slots the study claims to
  // know are the slots this ranking can actually score.
  const magnitudes = scopeMagnitudesToBreed(
    opts.magnitudes ?? EMPTY_MAGNITUDES,
    parsedGenes,
    species,
    opts.offspringBreed,
  );
  // Which attributes are scorable in points at all, settled once for the
  // whole ranking: every pair must be scored over the same slot set or the
  // column is not a comparison.
  const pointAttributes = attrNames.filter((attr) => coverageOf(magnitudes, attr).known > 0);
  const ownProfiles = new Map<number, ParentExpressedProfile>();
  for (const [id, l] of petLociMap) {
    ownProfiles.set(id, ownExpressedProfile(l, parsedGenes, species, opts.offspringBreed, magnitudes));
  }

  for (const m of males) {
    const mLoci = petLociMap.get(m.id) ?? empty;
    for (const f of females) {
      const fLoci = petLociMap.get(f.id) ?? empty;
      results.push(
        scorePair(
          m,
          f,
          mLoci,
          fLoci,
          parsedGenes,
          tallies,
          ownProfiles,
          opts.offspringBreed,
          species,
          attrNames,
          weight,
          magnitudes,
          pointAttributes,
        ),
      );
    }
  }

  return results;
}
