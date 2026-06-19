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

import type { AlleleDistribution } from '$lib/types/index.js';
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

  // 3. Lock in a positive both parents share (both express the same `+`),
  //    consolidating it in the offspring — dominant (both D/x) or
  //    recessive (both R).
  if (fSign === '+' && mSign === '+') {
    return { verdict: 'gain', source: 'both', lockedIn: true, ...base };
  }

  return { verdict: 'neutral', source: null, lockedIn: false, ...base };
}
