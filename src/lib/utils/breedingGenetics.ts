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
 * order D > x > R). Each entry is read-only; callers receive a fresh
 * object so accumulation/mutation downstream is safe.
 */
const COMBINATIONS: Readonly<Record<string, AlleleDistribution>> = Object.freeze({
  'D|D': { D: 1, x: 0, R: 0, unknown: 0 },
  'D|x': { D: 0.5, x: 0.5, R: 0, unknown: 0 },
  'D|R': { D: 0, x: 1, R: 0, unknown: 0 },
  'x|x': { D: 0.25, x: 0.5, R: 0.25, unknown: 0 },
  'x|R': { D: 0, x: 0.5, R: 0.5, unknown: 0 },
  'R|R': { D: 0, x: 0, R: 1, unknown: 0 },
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
