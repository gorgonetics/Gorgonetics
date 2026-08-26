/**
 * Pure Mendelian-genetics math for the Breeding Assistant.
 *
 * No I/O, no Svelte, no DB access. Each function operates on a single
 * locus; the breeding service composes them across all loci of a pair.
 *
 * Allele convention (matches `GeneType` and the existing `getPetGeneStats`):
 *   - `D` homozygous dominant — passes D
 *   - `R` homozygous recessive — passes R
 *   - `x` mixed (heterozygous) — passes D 50%, R 50%
 *   - `?` unknown — offspring's allele at this locus is unknowable
 *
 * Expression: `D` and `x` express the dominant effect; `R` expresses the
 * recessive effect.
 */

import type { AlleleDistribution, OffspringOutcomeBuckets } from '$lib/types/index.js';
import { GeneType } from '$lib/types/index.js';

/**
 * Minimal parsed-gene shape this module needs. Defined locally to keep
 * the genetics utility independent of the service layer; structurally
 * compatible with `ParsedGeneRecord` from `geneService`.
 */
export interface GeneSignSummary {
  dominantSign: '+' | '-' | null;
  recessiveSign: '+' | '-' | null;
}

/**
 * Combination table for the six known-allele parent pairs (canonical
 * order D > x > R). Each entry is deep-frozen so a caller reaching
 * through the table directly cannot corrupt shared state; callers of
 * `offspringDistribution` always receive a fresh object via spread, so
 * downstream accumulation/mutation stays safe regardless.
 */
const COMBINATIONS: Readonly<Record<string, Readonly<AlleleDistribution>>> = Object.freeze({
  'D|D': Object.freeze({ D: 1, x: 0, R: 0, unknown: 0 }),
  'D|x': Object.freeze({ D: 0.5, x: 0.5, R: 0, unknown: 0 }),
  'D|R': Object.freeze({ D: 0, x: 1, R: 0, unknown: 0 }),
  'x|x': Object.freeze({ D: 0.25, x: 0.5, R: 0.25, unknown: 0 }),
  'x|R': Object.freeze({ D: 0, x: 0.5, R: 0.5, unknown: 0 }),
  'R|R': Object.freeze({ D: 0, x: 0, R: 1, unknown: 0 }),
});

const RANK: Record<string, number> = {
  [GeneType.DOMINANT]: 0,
  [GeneType.MIXED]: 1,
  [GeneType.RECESSIVE]: 2,
};

function canonicalKey(p1: GeneType, p2: GeneType): string {
  return RANK[p1] <= RANK[p2] ? `${p1}|${p2}` : `${p2}|${p1}`;
}

/**
 * Distribution of offspring gene types given two parent gene types.
 *
 * If either parent is `?`, the offspring's allele at this locus is
 * unknowable — all probability mass lands in `unknown`.
 */
export function offspringDistribution(p1: GeneType, p2: GeneType): AlleleDistribution {
  if (p1 === GeneType.UNKNOWN || p2 === GeneType.UNKNOWN) return { D: 0, x: 0, R: 0, unknown: 1 };
  const entry = COMBINATIONS[canonicalKey(p1, p2)];
  return entry ? { ...entry } : { D: 0, x: 0, R: 0, unknown: 1 };
}

/**
 * Probability the offspring expresses a positive-effect attribute at
 * this locus. `D` and `x` mass count toward the dominant sign; `R` mass
 * counts toward the recessive sign. Unknown mass contributes 0 by
 * construction. Returns 0 for genes with no positive sign or for an
 * undefined gene record (caller has no entry for this gene_id).
 */
export function positiveExpressionProbability(dist: AlleleDistribution, gene: GeneSignSummary | undefined): number {
  if (!gene) return 0;
  let p = 0;
  if (gene.dominantSign === '+') p += dist.D + dist.x;
  if (gene.recessiveSign === '+') p += dist.R;
  return p;
}

/**
 * Probability the offspring expresses a negative-effect attribute at this
 * locus. Mirror of `positiveExpressionProbability` for the `-` sign; used
 * by the trio view to flag pairings that surface a hidden downside.
 */
export function negativeExpressionProbability(dist: AlleleDistribution, gene: GeneSignSummary | undefined): number {
  if (!gene) return 0;
  let p = 0;
  if (gene.dominantSign === '-') p += dist.D + dist.x;
  if (gene.recessiveSign === '-') p += dist.R;
  return p;
}

/**
 * The effect sign a parent *expresses* at this locus given its allele.
 * `D`/`x` express the dominant effect; `R` expresses the recessive
 * effect; `?` (or a missing gene record) expresses nothing knowable.
 */
export function expressedSign(type: GeneType, gene: GeneSignSummary | undefined): '+' | '-' | null {
  if (!gene) return null;
  if (type === GeneType.DOMINANT || type === GeneType.MIXED) return gene.dominantSign;
  if (type === GeneType.RECESSIVE) return gene.recessiveSign;
  return null;
}

/** Outcome of classifying a single locus for the trio view. */
export interface TrioLocusClassification {
  verdict: 'gain' | 'risk' | 'neutral';
  source: 'father' | 'mother' | 'both' | null;
  lockedIn: boolean;
  pPositive: number;
  pNegative: number;
}

/** Combine two per-parent carrier booleans into a `source` attribution. */
function attributeSource(fatherCarries: boolean, motherCarries: boolean): 'father' | 'mother' | 'both' | null {
  if (fatherCarries && motherCarries) return 'both';
  if (fatherCarries) return 'father';
  if (motherCarries) return 'mother';
  return null;
}

/** Does this allele carry a dominant allele (can pass D)? `D` and `x` do. */
function carriesDominant(type: GeneType): boolean {
  return type === GeneType.DOMINANT || type === GeneType.MIXED;
}

/** Does this allele carry a recessive allele (can pass R)? `R` and `x` do. */
function carriesRecessive(type: GeneType): boolean {
  return type === GeneType.RECESSIVE || type === GeneType.MIXED;
}

/**
 * Classify a locus for the trio (Father / Offspring / Mother) view.
 *
 * Priority — a cell carries a single verdict:
 *  1. `gain` (new positive): offspring can express a `+` neither parent
 *     expresses. Source = parent(s) carrying the `+` allele.
 *  2. `risk`: offspring can express a `-` neither parent expresses.
 *     Source = parent(s) carrying the `-` allele.
 *  3. `gain` (locked-in): both parents already express the same positive
 *     (they share the gene), so the offspring reliably inherits it —
 *     applies to a dominant positive (both `D`/`x` → offspring can be
 *     homozygous-dominant) and a recessive positive (both `R` → offspring
 *     is guaranteed homozygous-recessive). Source = `both`.
 *  4. `neutral`.
 */
export function classifyTrioLocus(
  fatherType: GeneType,
  motherType: GeneType,
  dist: AlleleDistribution,
  gene: GeneSignSummary | undefined,
): TrioLocusClassification {
  const pPositive = positiveExpressionProbability(dist, gene);
  const pNegative = negativeExpressionProbability(dist, gene);
  const base = { pPositive, pNegative };

  if (!gene) return { verdict: 'neutral', source: null, lockedIn: false, ...base };

  const fSign = expressedSign(fatherType, gene);
  const mSign = expressedSign(motherType, gene);
  const parentExpressesPositive = fSign === '+' || mSign === '+';
  const parentExpressesNegative = fSign === '-' || mSign === '-';

  // 1. New positive the parents don't show.
  if (pPositive > 0 && !parentExpressesPositive) {
    const fatherCarries =
      (gene.dominantSign === '+' && carriesDominant(fatherType)) ||
      (gene.recessiveSign === '+' && carriesRecessive(fatherType));
    const motherCarries =
      (gene.dominantSign === '+' && carriesDominant(motherType)) ||
      (gene.recessiveSign === '+' && carriesRecessive(motherType));
    return { verdict: 'gain', source: attributeSource(fatherCarries, motherCarries), lockedIn: false, ...base };
  }

  // 2. New negative the parents don't show.
  if (pNegative > 0 && !parentExpressesNegative) {
    const fatherCarries =
      (gene.dominantSign === '-' && carriesDominant(fatherType)) ||
      (gene.recessiveSign === '-' && carriesRecessive(fatherType));
    const motherCarries =
      (gene.dominantSign === '-' && carriesDominant(motherType)) ||
      (gene.recessiveSign === '-' && carriesRecessive(motherType));
    return { verdict: 'risk', source: attributeSource(fatherCarries, motherCarries), lockedIn: false, ...base };
  }

  // 3. Lock in a positive both parents express via the SAME allele, where the
  //    offspring can consolidate it toward homozygosity. Checked per allele so
  //    a both-positive gene paired D × R (offspring all heterozygous, no
  //    consolidation) is not mislabelled as locked-in.
  //    - dominant `+`: both parents carry the dominant allele (D/x) → offspring
  //      can be homozygous-dominant (dist.D > 0).
  //    - recessive `+`: both parents are R → offspring is guaranteed R.
  if (gene.dominantSign === '+' && carriesDominant(fatherType) && carriesDominant(motherType) && dist.D > 0) {
    return { verdict: 'gain', source: 'both', lockedIn: true, ...base };
  }
  if (gene.recessiveSign === '+' && fatherType === GeneType.RECESSIVE && motherType === GeneType.RECESSIVE) {
    return { verdict: 'gain', source: 'both', lockedIn: true, ...base };
  }

  return { verdict: 'neutral', source: null, lockedIn: false, ...base };
}

/**
 * Split the offspring's Punnett outcome at one locus into buckets describing
 * how each genotype compares with the parents (see `OffspringOutcomeBuckets`).
 * Pure per-locus; masses sum to 1.
 *
 * Two positive-change kinds are kept separate so the UI can toggle which it
 * treats as the highlighted gain:
 *  - `newPositive`: expresses a `+` neither parent expresses.
 *  - `clarifiedPositive`: keeps a `+` a parent has AND becomes homozygous while
 *    clearing a mixed parent — "Clarification". A homozygous outcome is only a
 *    clarification when a parent was mixed (`x`); D×D / R×R already breed true
 *    and D×R yields only mixed offspring (nothing cleared).
 */
export function offspringOutcomeBuckets(
  fatherType: GeneType,
  motherType: GeneType,
  dist: AlleleDistribution,
  gene: GeneSignSummary | undefined,
): OffspringOutcomeBuckets {
  const b: OffspringOutcomeBuckets = {
    newPositive: 0,
    clarifiedPositive: 0,
    keepPositive: 0,
    neutral: 0,
    keepNegative: 0,
    loss: 0,
    unknown: dist.unknown,
  };
  const solidMass = dist.D + dist.x + dist.R;
  if (!gene || solidMass <= 0) {
    b.neutral += solidMass;
    return b;
  }

  // Compare per allele, not by a global +/- sign: the dominant and recessive
  // alleles can affect different attributes, so "does a parent already show
  // this?" must ask about the SAME allele the offspring expresses. `D`/`x`
  // express the dominant effect (a parent shows it iff it carries a dominant
  // allele); `R` expresses the recessive effect (only an `R` parent shows it).
  const parentExpressesDominant = carriesDominant(fatherType) || carriesDominant(motherType);
  const parentExpressesRecessive = fatherType === GeneType.RECESSIVE || motherType === GeneType.RECESSIVE;
  // For a neutral outcome, "lost a positive" only needs *any* parent positive.
  const parentExpressesPositive = expressedSign(fatherType, gene) === '+' || expressedSign(motherType, gene) === '+';
  // A homozygous offspring clears heterozygosity only if a parent actually had it.
  const parentMixed = fatherType === GeneType.MIXED || motherType === GeneType.MIXED;

  const classify = (type: GeneType, mass: number) => {
    if (mass <= 0) return;
    const sign = expressedSign(type, gene);
    const homozygous = type === GeneType.DOMINANT || type === GeneType.RECESSIVE;
    // Does a parent already express this exact allele's effect?
    const parentSharesAllele = type === GeneType.RECESSIVE ? parentExpressesRecessive : parentExpressesDominant;
    if (sign === '+') {
      if (!parentSharesAllele) b.newPositive += mass;
      else if (homozygous && parentMixed) b.clarifiedPositive += mass;
      else b.keepPositive += mass;
    } else if (sign === '-') {
      if (!parentSharesAllele) b.loss += mass;
      else b.keepNegative += mass;
    } else {
      // Neutral expression: a loss only if a parent had a positive to lose.
      if (parentExpressesPositive) b.loss += mass;
      else b.neutral += mass;
    }
  };
  classify(GeneType.DOMINANT, dist.D);
  classify(GeneType.MIXED, dist.x);
  classify(GeneType.RECESSIVE, dist.R);
  return b;
}

/**
 * Standard normal CDF, Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7).
 *
 * Enough for ranking pairs: the offspring's positive-effect count is a sum
 * of hundreds of independent per-locus outcomes, so its Poisson-binomial
 * distribution is very close to normal well before the approximation's
 * error matters.
 */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/** Standard normal density. */
function normalPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

/**
 * Expected improvement over `baseline` — `E[max(0, offspring - baseline)]`.
 *
 * Weighs how *much* better, not just how often: a near-certain gain of one
 * is worth less than a likely gain of six. The same acquisition function
 * Bayesian optimisation uses, and for the same reason — it balances a safe
 * small step against a riskier large one instead of collapsing to whichever
 * is likelier, which is why a bare probability-of-improvement is not the
 * sort key.
 */
export function expectedImprovement(mean: number, sd: number, baseline: number): number {
  if (sd <= 0) return Math.max(0, mean - baseline);
  const z = (mean - baseline) / sd;
  return sd * normalPdf(z) + (mean - baseline) * normalCdf(z);
}

/**
 * `E[max(0, baseline - offspring)]` — expected *reduction* below a
 * baseline, for quantities where lower is better (negative effects).
 *
 * The mirror of `expectedImprovement`, and the same integral with the roles
 * of mean and baseline exchanged, so the two cannot drift apart.
 *
 * Exists because clearing liabilities is a breeding purpose in its own
 * right: a foal worse than both parents on positive count can still be the
 * right pairing if it drops a negative the line has been carrying.
 */
export function expectedReduction(mean: number, sd: number, baseline: number): number {
  return expectedImprovement(baseline, sd, mean);
}
