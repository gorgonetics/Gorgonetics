/**
 * Clearing a chromosome: breeding toward an animal that holds the best
 * genotype at every generic locus of a chromosome — a base any breed can be
 * built on.
 *
 * ## The target
 *
 * At each locus the target is the homozygote that expresses the better slot,
 * read from the declared signs: a `+` beats nothing, nothing beats a `−`.
 * On horse chromosome 1 every gene is dominant `−`, recessive `+`, so the
 * target is `R` throughout. A locus whose slots are equally good has no
 * target. Only generic loci count: a breed-locked one is not part of a base
 * for every breed.
 *
 * ## Why this is simple arithmetic
 *
 * Success is one event — every locus on target — and loci are independent,
 * so its probability is a plain product, with no joint distribution to
 * build. A locus can only reach its target if both parents carry the
 * target allele: one parent homozygous for the other allele **blocks** it,
 * whatever the other parent is.
 *
 * Pure: no DB, no Svelte.
 */

import type { GeneType } from '$lib/types/index.js';
import { offspringDistribution } from '$lib/utils/breedingGenetics.js';
import { fromGeneId } from '$lib/utils/geneAnalysis.js';
import type { PetLoci } from '$lib/utils/petLoci.js';

export type Homozygote = 'D' | 'R';
type Genotype = 'D' | 'x' | 'R';
const GENOTYPES = ['D', 'x', 'R'] as const;

/** What the target needs from the gene table. */
export interface SlotSigns {
  dominantSign: '+' | '-' | null;
  recessiveSign: '+' | '-' | null;
  breed: string;
}

/** Per locus, the genotype to reach. */
export type Targets = ReadonlyMap<string, Homozygote>;

const worth = (sign: '+' | '-' | null) => (sign === '+' ? 1 : sign === '-' ? -1 : 0);

/** The target at every generic locus of `chromosome` (e.g. `01`) that has one. */
export function chromosomeTargets(
  genes: Readonly<Record<string, SlotSigns>>,
  chromosome: string,
): Map<string, Homozygote> {
  const targets = new Map<string, Homozygote>();
  for (const [gene, g] of Object.entries(genes)) {
    if (g.breed || fromGeneId(gene)?.chromosome !== chromosome) continue;
    const dominant = worth(g.dominantSign);
    const recessive = worth(g.recessiveSign);
    if (dominant !== recessive) targets.set(gene, recessive > dominant ? 'R' : 'D');
  }
  return new Map([...targets].sort(([a], [b]) => a.localeCompare(b)));
}

const known = (t: GeneType | undefined): t is Genotype => t === 'D' || t === 'x' || t === 'R';

export interface AnimalStatus {
  /** Loci at the target. */
  onTarget: number;
  /** Loci carrying one target allele (`x`). */
  carrier: number;
  /** Loci homozygous for the other allele: this animal blocks them in any foal. */
  blocked: string[];
  /** Loci this animal's genome does not show. */
  hidden: number;
}

/**
 * Alleles still to replace: two per locus homozygous the wrong way, one per
 * carrier. Zero is clear. The measure of progress, because a foal's
 * expected value is exactly the mean of its parents' — the gains come from
 * keeping the better foals, so the spread is what matters.
 */
export const allelesToGo = (s: AnimalStatus) => 2 * s.blocked.length + s.carrier;

export function animalStatus(loci: PetLoci, targets: Targets): AnimalStatus {
  const status: AnimalStatus = { onTarget: 0, carrier: 0, blocked: [], hidden: 0 };
  for (const [gene, target] of targets) {
    const t = loci.get(gene);
    if (!known(t)) status.hidden++;
    else if (t === target) status.onTarget++;
    else if (t === 'x') status.carrier++;
    else status.blocked.push(gene);
  }
  return status;
}

/** Foals bred, on average, until one is clear: `1 / pClear`. */
const foalsFor = (p: number) => (p > 0 ? 1 / p : Number.POSITIVE_INFINITY);

export interface PairClearing {
  /** P(the foal is on target at every locus). */
  pClear: number;
  /** P(the foal has exactly `k` alleles to go), by `k`. */
  toGo: number[];
  /** Expected loci on target in the foal. */
  expected: number;
  /** Loci no foal of the pair can reach: a parent is homozygous for the other allele. */
  blocked: string[];
  foals: number;
}

/** One cross. Loci either parent hides are left out, as they are for every animal alike. */
export function pairClearing(a: PetLoci, b: PetLoci, targets: Targets): PairClearing {
  let pClear = 1;
  let expected = 0;
  const blocked: string[] = [];
  // Alleles to go is a sum of independent per-locus counts (0, 1 or 2), so
  // its distribution is an exact convolution.
  let toGo = [1];
  for (const [gene, target] of targets) {
    const ta = a.get(gene);
    const tb = b.get(gene);
    if (!known(ta) || !known(tb)) continue;
    const dist = offspringDistribution(ta, tb);
    const p = dist[target];
    if (p === 0) blocked.push(gene);
    pClear *= p;
    expected += p;
    const step = [p, dist.x, target === 'R' ? dist.D : dist.R];
    const next = new Array<number>(toGo.length + 2).fill(0);
    toGo.forEach((q, k) => {
      for (let d = 0; d < 3; d++) next[k + d] += q * step[d];
    });
    toGo = next;
  }
  return { pClear, toGo, expected, blocked, foals: foalsFor(pClear) };
}

/** A locus the middle foal is chosen on, and how often a foal of the first pair qualifies there. */
export interface ClearingRule {
  gene: string;
  allowed: Genotype[];
  p: number;
}

export interface BridgeClearing {
  /** What to keep the middle foal for; empty when any foal will do. */
  keep: ClearingRule[];
  /** Share of the first pair's foals meeting `keep`, gender aside. */
  pQualify: number;
  /** P(a foal of the kept middle foal and the partner is clear). */
  pClear: number;
  /** Foals bred in both steps, on average, until one is clear. */
  foals: number;
  /** Loci still blocked: the partner, or every foal of the first pair, blocks them. */
  blocked: string[];
}

/**
 * Two steps: breed `sire` × `dam`, keep a foal, breed it to `partner`.
 *
 * You read the middle foal's genome before keeping it, so it is chosen.
 * Three ways are tried and the one needing fewer foals in all is kept: any
 * foal; a foal blocking nothing the partner could clear; and the best foal
 * the pair can give at every locus. Stricter means fewer foals qualify but
 * more of their foals are clear. Gender is not modelled: counts are among
 * foals of the gender the partner needs.
 */
export function bridgeClearing(sire: PetLoci, dam: PetLoci, partner: PetLoci, targets: Targets): BridgeClearing {
  interface Locus {
    gene: string;
    middle: Record<Genotype, number>;
    /** P(clear at this locus | middle foal genotype). */
    clear: Record<Genotype, number>;
  }
  const loci: Locus[] = [];
  for (const [gene, target] of targets) {
    const s = sire.get(gene);
    const d = dam.get(gene);
    const c = partner.get(gene);
    if (!known(s) || !known(d) || !known(c)) continue;
    const m = offspringDistribution(s, d);
    loci.push({
      gene,
      middle: { D: m.D, x: m.x, R: m.R },
      clear: Object.fromEntries(GENOTYPES.map((t) => [t, offspringDistribution(t, c)[target]])) as Record<
        Genotype,
        number
      >,
    });
  }

  type Policy = (l: Locus) => Genotype[];
  const possible = (l: Locus) => GENOTYPES.filter((t) => l.middle[t] > 0);
  const policies: Policy[] = [
    possible,
    // No genotype that blocks a locus the partner could still clear.
    (l) => {
      const ok = possible(l).filter((t) => l.clear[t] > 0);
      return ok.length > 0 ? ok : possible(l);
    },
    (l) => {
      const top = Math.max(...possible(l).map((t) => l.clear[t]));
      return possible(l).filter((t) => l.clear[t] === top);
    },
  ];

  let best: BridgeClearing | null = null;
  for (const policy of policies) {
    const keep: ClearingRule[] = [];
    let pQualify = 1;
    let pClear = 1;
    const blocked: string[] = [];
    for (const l of loci) {
      const allowed = policy(l);
      const p = allowed.reduce((sum, t) => sum + l.middle[t], 0);
      if (allowed.length < possible(l).length) {
        keep.push({ gene: l.gene, allowed, p });
        pQualify *= p;
      }
      const clear = allowed.reduce((sum, t) => sum + l.middle[t] * l.clear[t], 0) / p;
      if (clear === 0) blocked.push(l.gene);
      pClear *= clear;
    }
    const foals = pClear > 0 && pQualify > 0 ? 1 / pQualify + 1 / pClear : Number.POSITIVE_INFINITY;
    if (!best || foals < best.foals || (foals === best.foals && pClear > best.pClear)) {
      best = { keep, pQualify, pClear, foals, blocked };
    }
  }
  return best as BridgeClearing;
}

/** The genotype a rule names, as the player reads it. */
export const ruleText = (r: ClearingRule) => `${r.gene} ${r.allowed.join(' or ')}`;

/** P(fewer than `k` alleles to go): a foal closer than an animal `k` away. */
export const closerThan = (toGo: readonly number[], k: number) =>
  toGo.slice(0, Math.max(0, k)).reduce((a, b) => a + b, 0);
