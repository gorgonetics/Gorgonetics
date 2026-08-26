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

import type { AlleleDistribution, BreedingPairResult, Pet } from '$lib/types/index.js';
import { Gender, GeneType } from '$lib/types/index.js';
import {
  expectedImprovement,
  expectedReduction,
  expressedSign,
  negativeExpressionProbability,
  offspringDistribution,
  positiveExpressionProbability,
} from '$lib/utils/breedingGenetics.js';
import { type AlleleTally, expectedCapabilityGain, tallyAlleles, tallyFor } from '$lib/utils/geneticQuality.js';
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
   * Pre-filtered candidate parents (caller is expected to pass only
   * stabled, same-species pets). The service splits by gender and ranks
   * every M × F pair; same-gender or empty inputs return [].
   */
  pets: Pet[];
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
 */
function accumulatePositive(
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
 * What a parent itself expresses, on exactly the loci and breed scope the
 * offspring EV uses — the baseline every improvement measure is judged
 * against.
 *
 * `pets.positive_genes` cannot serve: it is scoped to the pet's *own* breed,
 * so comparing it against an offspring EV scoped to the target breed would
 * compare two different locus sets and manufacture improvement out of the
 * mismatch.
 *
 * One walk, three figures. Positives, negatives and the per-attribute split
 * share the same loop, the same breed gate and the same expression rule, so
 * splitting them into three functions meant three passes over ~1,600 loci per
 * animal and three copies of the `D`/`x` vs `R` branching that
 * `expressedSign` already encodes.
 */
interface ExpressedProfile {
  positives: number;
  negatives: number;
  /** Positive count keyed by the (capitalized) attribute it lands on. */
  positivesByAttribute: Record<string, number>;
}

const EMPTY_PROFILE: Readonly<ExpressedProfile> = Object.freeze({
  positives: 0,
  negatives: 0,
  positivesByAttribute: {},
});

function ownExpressedProfile(
  loci: PetLoci,
  parsedGenes: Record<string, ParsedGeneRecord>,
  species: string,
  offspringBreed: string | undefined,
): ExpressedProfile {
  const profile: ExpressedProfile = { positives: 0, negatives: 0, positivesByAttribute: {} };
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
  }
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
  ownProfiles: Map<number, ExpressedProfile>,
  offspringBreed: string | undefined,
  species: string,
  attrNames: readonly string[],
): BreedingPairResult {
  const evPositiveByAttribute = emptyAttributeBreakdown(attrNames);
  const attributeVariance = emptyAttributeBreakdown(attrNames);
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
      evCapabilityGain += expectedCapabilityGain(dist, gd, tallyFor(tallies, geneId));
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
  return {
    male,
    female,
    evMixed,
    evPositiveByAttribute,
    evPositiveTotal,
    evPositiveWeighted,
    evCapabilityGain,
    evPositiveImprovement: expectedImprovement(evPositiveTotal, sd, betterParentPositives),
    evPairUpgrade: expectedImprovement(evPositiveTotal, sd, weakerParentPositives),
    betterParentPositives,
    weakerParentPositives,
    evAttributeImprovement,
    evNegativeTotal,
    evLiabilityReduction: expectedReduction(evNegativeTotal, Math.sqrt(negativeVariance), cleanerParentNegatives),
    cleanerParentNegatives,
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
  // One pass per animal, not per pair: the baseline an offspring must beat.
  const ownProfiles = new Map<number, ExpressedProfile>();
  for (const [id, l] of petLociMap) {
    ownProfiles.set(id, ownExpressedProfile(l, parsedGenes, species, opts.offspringBreed));
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
        ),
      );
    }
  }

  return results;
}
