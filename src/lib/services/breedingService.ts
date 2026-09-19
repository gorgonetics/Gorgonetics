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
  type AttributeMagnitudes,
  coverageOf,
  EMPTY_MAGNITUDES,
  hasMagnitudes,
  magnitudeOf,
} from '$lib/utils/attributePoints.js';
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
 * How well the candidate pool already covers a positive slot:
 * `locked` — some pet expresses it outright, `partial` — only carriers
 * exist, `missing` — nothing in the pool carries it.
 */
export type CoverageTier = 'locked' | 'partial' | 'missing';

/** Per-gene pool coverage, tracked separately for each positive slot. */
export interface SlotCoverage {
  /** Coverage of the dominant-positive slot (`dominantSign === '+'`). */
  dom: CoverageTier;
  /** Coverage of the recessive-positive slot (`recessiveSign === '+'`). */
  rec: CoverageTier;
}

export type PoolCoverage = Map<string, SlotCoverage>;

/**
 * Gap weight per tier — a missing positive is worth more than re-covering a
 * locked one. Mirrors PGBeeYiKeeper's coverage multipliers, adapted to the
 * horse two-slot model (see issue #358).
 */
export const GAP_WEIGHT: Record<CoverageTier, number> = { missing: 2.0, partial: 1.2, locked: 0.6 };

/**
 * The (capitalized) attribute each positive slot targets, or null when that
 * slot isn't a named positive — a slot counts only when its sign is `'+'` and
 * it names an attribute. The single source of truth for slot eligibility,
 * shared by `buildPoolCoverage` and `accumulatePositive` so coverage and
 * scoring can't drift on which loci count.
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
 * and coverage and scoring share it so they cannot drift. Points need the
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

/**
 * One pass over the whole candidate pool to classify, per gene, how well each
 * positive slot is already covered. A horse gene has up to two positive slots
 * (a dominant-positive and a recessive-positive, often on *different*
 * attributes), so coverage is tracked per slot, not per gene:
 *
 * - dominant-positive: `locked` if any pet is `D`, else `partial` if any `x`,
 *   else `missing` (all `R`/unknown).
 * - recessive-positive: `locked` if any pet is `R`, else `partial` if any `x`
 *   (carrier), else `missing` (all `D`/unknown).
 *
 * Only genes with at least one positive slot are tracked; breed-locked-to-
 * other-breed loci are excluded (same `isHorseBreedFiltered` gate as scoring),
 * so coverage and scoring agree on which loci exist.
 */
export function buildPoolCoverage(
  lociList: Iterable<PetLoci>,
  parsedGenes: Record<string, ParsedGeneRecord>,
  species: string,
  offspringBreed: string | undefined,
): PoolCoverage {
  const flags = new Map<string, { d: boolean; x: boolean; r: boolean }>();
  for (const loci of lociList) {
    for (const [geneId, type] of loci) {
      const gd = parsedGenes[geneId];
      if (!gd) continue;
      const slots = positiveSlots(gd);
      if (!slots.dom && !slots.rec) continue;
      if (isHorseBreedFiltered(species, offspringBreed, gd.breed)) continue;
      let f = flags.get(geneId);
      if (!f) {
        f = { d: false, x: false, r: false };
        flags.set(geneId, f);
      }
      if (type === GeneType.DOMINANT) f.d = true;
      else if (type === GeneType.MIXED) f.x = true;
      else if (type === GeneType.RECESSIVE) f.r = true;
      // UNKNOWN carries no positive allele → contributes no coverage.
    }
  }

  const coverage: PoolCoverage = new Map();
  for (const [geneId, f] of flags) {
    coverage.set(geneId, {
      dom: f.d ? 'locked' : f.x ? 'partial' : 'missing',
      rec: f.r ? 'locked' : f.x ? 'partial' : 'missing',
    });
  }
  return coverage;
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
 * tally (`into`). Returns the raw total plus the pool-gap-weighted total —
 * each slot's mass scaled by `GAP_WEIGHT` for its coverage tier — so the
 * caller keeps both running aggregates without re-summing the record. Only
 * the scalar weighted total is surfaced; the breakdown stays raw (the UI
 * sorts the weighted figure as a single "Pool gain" column).
 *
 * `cov` is this gene's pool coverage; absent (shouldn't happen for a locus
 * present in the pool) it defaults to the `missing` weight.
 *
 * Exported for the trio view, which attributes a pair's `Pool gain` back to
 * individual loci. It calls this with scratch records it discards, keeping
 * one implementation of the slot math: a second copy would be free to drift
 * on which slots count, and the explanation would then contradict the column
 * it claims to explain.
 */
export function accumulatePositive(
  dist: AlleleDistribution,
  gd: ParsedGeneRecord,
  cov: SlotCoverage | undefined,
  into: Record<string, number>,
  variance: Record<string, number>,
): { total: number; weighted: number } {
  // Per-attribute variance sums p(1-p) per slot, which assumes the two slots
  // are not both positive on the *same* attribute. Were they, their masses
  // would be mutually exclusive and sum to a deterministic 1, so summing each
  // slot's variance would overstate it. No such locus exists in any shipped
  // gene template (checked across all horse and beewasp chromosomes), and
  // gene tables are user-editable, so this is an assumption rather than an
  // invariant — revisit if the templates ever gain one.
  const slots = positiveSlots(gd);
  let total = 0;
  let weighted = 0;
  if (slots.dom) {
    const p = dist.D + dist.x;
    if (p > 0) {
      into[slots.dom] = (into[slots.dom] ?? 0) + p;
      variance[slots.dom] = (variance[slots.dom] ?? 0) + p * (1 - p);
      total += p;
      weighted += p * GAP_WEIGHT[cov?.dom ?? 'missing'];
    }
  }
  if (slots.rec) {
    const p = dist.R;
    if (p > 0) {
      into[slots.rec] = (into[slots.rec] ?? 0) + p;
      variance[slots.rec] = (variance[slots.rec] ?? 0) + p * (1 - p);
      total += p;
      weighted += p * GAP_WEIGHT[cov?.rec ?? 'missing'];
    }
  }
  return { total, weighted };
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
 *    sum of scaled Bernoullis rather than a plain count. Getting this wrong
 *    would not move the expected value, only the improvement integral that
 *    reads the spread, which is exactly the kind of error that hides.
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
  if (slots.dom) {
    const magnitude = magnitudeOf(magnitudes, geneId, 'dominant');
    if (magnitude !== undefined) {
      // A mixed locus expresses exactly as a dominant one, which is why the
      // study solves no separate `x` magnitude.
      const p = dist.D + dist.x;
      into[slots.dom] = (into[slots.dom] ?? 0) + p * magnitude;
      variance[slots.dom] = (variance[slots.dom] ?? 0) + magnitude * magnitude * p * (1 - p);
    }
  }
  if (slots.rec) {
    const magnitude = magnitudeOf(magnitudes, geneId, 'recessive');
    if (magnitude !== undefined) {
      const p = dist.R;
      into[slots.rec] = (into[slots.rec] ?? 0) + p * magnitude;
      variance[slots.rec] = (variance[slots.rec] ?? 0) + magnitude * magnitude * p * (1 - p);
    }
  }
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
  coverage: PoolCoverage,
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
  let evPositiveWeighted = 0;
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
      const { total, weighted } = accumulatePositive(
        dist,
        gd,
        coverage.get(geneId),
        evPositiveByAttribute,
        attributeVariance,
      );
      evPositiveTotal += total;
      evPositiveWeighted += weighted;
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
      Math.sqrt(attributeVariance[attr] ?? 0),
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
        Math.sqrt(pointVariance[attr] ?? 0),
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
    evPositiveWeighted,
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

  // Pool coverage is computed once over the whole candidate set, then shared
  // across every pair — the gap weights describe the pool, not the pair.
  const coverage = buildPoolCoverage(petLociMap.values(), parsedGenes, species, opts.offspringBreed);
  // Capability is measured against the whole candidate pool, parents
  // included: a pairing that only reproduces what the stable already breeds
  // true must score nothing, and that has to fall out of the arithmetic.
  const tallies = tallyAlleles(petLociMap.values());
  // The focus is whatever breed the player committed to; with none, generic
  // loci simply outweigh the breed-locked ones.
  const weight = breedReachFor(parsedGenes, opts.offspringBreed, opts.breedLockWeight);
  // One pass per animal, not per pair: the baseline an offspring must beat.
  const magnitudes = opts.magnitudes ?? EMPTY_MAGNITUDES;
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
          coverage,
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
