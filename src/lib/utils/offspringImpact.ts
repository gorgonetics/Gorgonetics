/**
 * What a breeding pair's foal can do to each attribute, from the study's
 * measured gene effects.
 *
 * An attribute is `base + Σ expressed effects`, and the study never learns
 * `base`. A parent of the foal's breed shares it, so against that parent
 *
 *     foal − parent = X − K_parent
 *
 * where `X` is the foal's measured points and `K_parent` the points that
 * parent expresses — the base cancels, and no attribute reading is needed to
 * compare. `X` is a distribution, not a number: two mixed parents give a
 * 25% chance of a recessive foal, and when the recessive slot is `+m` that is
 * a quarter of foals beating both parents by `m`. A mean would report it as
 * `+m/4` for everyone, which is the case this module exists to keep visible,
 * so it reports probabilities and a best case rather than an expectation.
 *
 * Unmeasured slots have no size, only a declared direction; they are
 * reported as the expected count of effects the foal gains beyond both
 * parents, up or down.
 *
 * Pure. No DB, no Svelte.
 */

import type { ParsedGeneRecord } from '$lib/services/geneService.js';
import { type AlleleDistribution, GeneType } from '$lib/types/index.js';
import { type AttributeMagnitudes, magnitudeOf } from '$lib/utils/attributePoints.js';
import type { Expression } from '$lib/utils/attributeStudy.js';
import { capitalize } from '$lib/utils/string.js';

/** One locus of the pair, as the trio has it. */
export interface PairLocus {
  geneId: string;
  fatherType: GeneType | null;
  motherType: GeneType | null;
  /** The foal's allele distribution at this locus. */
  dist: AlleleDistribution;
}

/** A parent: its breed, and its attribute readings when it has any. */
export interface PairParent {
  breed: string;
  /** Lowercased attribute name -> value; only when the values are readings. */
  values: Record<string, number> | null;
}

export interface AttributeOutlook {
  /** Capitalised, as the breeding scorers and the UI name attributes. */
  attribute: string;
  /** The foal's measured points: [points, probability], ascending. */
  distribution: Array<[number, number]>;
  /** Measured points each parent expresses, or null when it cannot be compared (another breed). */
  fatherPoints: number | null;
  motherPoints: number | null;
  /** Readings, for display and the absolute best case. */
  fatherValue: number | null;
  motherValue: number | null;
  /** P(foal above / below every comparable parent), null with none. */
  pBeatsBoth: number | null;
  pBelowBoth: number | null;
  /** Largest gain over the better comparable parent, and its probability; null with none. */
  bestGain: number | null;
  pBest: number;
  /** The foal's value in that best case, when a comparable parent has readings. */
  bestValue: number | null;
  /** Expected count of unmeasured effects the foal gains beyond both parents, up / down. */
  unmeasuredUp: number;
  unmeasuredDown: number;
}

/** Probability the foal expresses a slot. `x` expresses as dominant; unknown mass expresses nothing knowable. */
export function foalExpresses(dist: AlleleDistribution, expression: Expression): number {
  return expression === 'dominant' ? dist.D + dist.x : dist.R;
}

/** Whether a parent with this allele expresses the slot. */
export function parentExpresses(type: GeneType | null, expression: Expression): number {
  if (expression === 'dominant') return type === GeneType.DOMINANT || type === GeneType.MIXED ? 1 : 0;
  return type === GeneType.RECESSIVE ? 1 : 0;
}

/**
 * Whether a parent shares the foal's base, so the two can be compared. For
 * a breed-scoped species that is the same, real breed: Mixed has no single
 * base, since which breed-locked loci apply to it is unknowable.
 */
export function comparable(parent: PairParent, offspringBreed: string, breedScoped: boolean): boolean {
  if (!breedScoped) return true;
  return !!offspringBreed && offspringBreed !== 'Mixed' && parent.breed === offspringBreed;
}

interface Slot {
  attribute: string;
  sign: '+' | '-';
  expression: Expression;
  points: number | undefined;
}

function slotsOf(gd: ParsedGeneRecord | undefined, geneId: string, magnitudes: AttributeMagnitudes): Slot[] {
  if (!gd) return [];
  const out: Slot[] = [];
  const add = (attribute: string | null, sign: '+' | '-' | null, expression: Expression) => {
    if (!attribute || !sign) return;
    out.push({
      attribute: capitalize(attribute),
      sign,
      expression,
      points: magnitudeOf(magnitudes, geneId, expression),
    });
  };
  add(gd.dominantAttribute, gd.dominantSign, 'dominant');
  add(gd.recessiveAttribute, gd.recessiveSign, 'recessive');
  return out;
}

/** Keys for a points distribution: magnitudes are whole numbers, but sums of floats need a stable key. */
const key = (points: number) => Math.round(points * 1e6) / 1e6;

/** Convolve a distribution with one locus's outcomes (each [points, probability], summing to 1). */
function convolve(dist: Map<number, number>, outcomes: Array<[number, number]>): Map<number, number> {
  const next = new Map<number, number>();
  for (const [value, p] of dist) {
    for (const [points, q] of outcomes) {
      if (q <= 0) continue;
      const k = key(value + points);
      next.set(k, (next.get(k) ?? 0) + p * q);
    }
  }
  return next;
}

export interface OffspringImpactInput {
  loci: Iterable<PairLocus>;
  parsed: Record<string, ParsedGeneRecord>;
  magnitudes: AttributeMagnitudes;
  father: PairParent;
  mother: PairParent;
  offspringBreed: string;
  /** Whether the species' loci and bases are breed-scoped (horses). */
  breedScoped: boolean;
  /** Attribute order for the output, capitalised. */
  attributes: readonly string[];
}

export function offspringAttributeOutlooks(input: OffspringImpactInput): AttributeOutlook[] {
  const { parsed, magnitudes, father, mother, offspringBreed, breedScoped, attributes } = input;
  const fatherComparable = comparable(father, offspringBreed, breedScoped);
  const motherComparable = comparable(mother, offspringBreed, breedScoped);

  interface Acc {
    dist: Map<number, number>;
    kF: number;
    kM: number;
    up: number;
    down: number;
  }
  const acc = new Map<string, Acc>();
  const get = (attribute: string): Acc => {
    let a = acc.get(attribute);
    if (!a) {
      a = { dist: new Map([[0, 1]]), kF: 0, kM: 0, up: 0, down: 0 };
      acc.set(attribute, a);
    }
    return a;
  };

  for (const locus of input.loci) {
    // The two slots of a locus are exclusive (a foal is D/x or R), so a
    // locus contributes one outcome per slot plus "neither", per attribute.
    const outcomes = new Map<string, Array<[number, number]>>();
    for (const slot of slotsOf(parsed[locus.geneId], locus.geneId, magnitudes)) {
      const a = get(slot.attribute);
      const pFoal = foalExpresses(locus.dist, slot.expression);
      const pF = parentExpresses(locus.fatherType, slot.expression);
      const pM = parentExpresses(locus.motherType, slot.expression);
      if (slot.points !== undefined) {
        a.kF += pF * slot.points;
        a.kM += pM * slot.points;
        const list = outcomes.get(slot.attribute) ?? [];
        list.push([slot.points, pFoal]);
        outcomes.set(slot.attribute, list);
        continue;
      }
      // Unmeasured: the chance of expressing it beyond what either parent
      // does (a gain in its declared direction), or of dropping one both
      // parents have (a loss against its direction).
      const gained = Math.max(0, pFoal - Math.max(pF, pM));
      const dropped = Math.max(0, Math.min(pF, pM) - pFoal);
      if (slot.sign === '+') {
        a.up += gained;
        a.down += dropped;
      } else {
        a.down += gained;
        a.up += dropped;
      }
    }
    for (const [attribute, list] of outcomes) {
      const expressed = list.reduce((s, [, p]) => s + p, 0);
      get(attribute).dist = convolve(get(attribute).dist, [...list, [0, Math.max(0, 1 - expressed)]]);
    }
  }

  const order = [...attributes];
  for (const attribute of acc.keys()) if (!order.includes(attribute)) order.push(attribute);

  return order.map((attribute) => {
    const a = acc.get(attribute) ?? get(attribute);
    const distribution = [...a.dist.entries()].filter(([, p]) => p > 1e-12).sort((x, y) => x[0] - y[0]);
    const lowerKey = attribute.toLowerCase();
    const readingOf = (parent: PairParent) => {
      const v = parent.values?.[lowerKey];
      return typeof v === 'number' ? v : null;
    };
    const fatherPoints = fatherComparable ? a.kF : null;
    const motherPoints = motherComparable ? a.kM : null;
    const parentPoints = [fatherPoints, motherPoints].filter((k): k is number => k !== null);

    let pBeatsBoth: number | null = null;
    let pBelowBoth: number | null = null;
    let bestGain: number | null = null;
    let pBest = 0;
    let bestValue: number | null = null;
    if (parentPoints.length > 0) {
      const top = Math.max(...parentPoints);
      const bottom = Math.min(...parentPoints);
      const eps = 1e-9;
      pBeatsBoth = distribution.filter(([v]) => v > top + eps).reduce((s, [, p]) => s + p, 0);
      pBelowBoth = distribution.filter(([v]) => v < bottom - eps).reduce((s, [, p]) => s + p, 0);
      const [maxPoints, pMax] = distribution[distribution.length - 1] ?? [0, 1];
      bestGain = maxPoints - top;
      pBest = pMax;
      // Absolute best case, anchored on the better comparable parent when it
      // has readings: its value plus the foal's lead over it.
      const betterIsFather = fatherPoints !== null && fatherPoints === top;
      const anchor = betterIsFather ? readingOf(father) : readingOf(mother);
      if (anchor !== null) bestValue = anchor + bestGain;
    }

    return {
      attribute,
      distribution,
      fatherPoints,
      motherPoints,
      fatherValue: readingOf(father),
      motherValue: readingOf(mother),
      pBeatsBoth,
      pBelowBoth,
      bestGain,
      pBest,
      bestValue,
      unmeasuredUp: a.up,
      unmeasuredDown: a.down,
    };
  });
}

/** What one locus can do to the foal against its parents, for the lens tint and tooltip. */
export interface LocusOutlook {
  /** Largest gain over the better parent at this locus, on any attribute, and its probability. */
  upside: number;
  pUp: number;
  /** Largest loss below the weaker parent at this locus, and its probability. */
  downside: number;
  pDown: number;
  /** Direction of any unmeasured change beyond the parents, when nothing measured moves. */
  unmeasuredSign: '+' | '-' | null;
  /** Per-attribute outcomes, for the tooltip: [points, probability] plus each parent's points. */
  attributes: Array<{ attribute: string; outcomes: Array<[number, number]>; father: number; mother: number }>;
}

export function locusOutlook(
  locus: PairLocus,
  gd: ParsedGeneRecord | undefined,
  magnitudes: AttributeMagnitudes,
): LocusOutlook {
  const byAttribute = new Map<string, { outcomes: Array<[number, number]>; father: number; mother: number }>();
  let unmeasured = 0;
  for (const slot of slotsOf(gd, locus.geneId, magnitudes)) {
    const pFoal = foalExpresses(locus.dist, slot.expression);
    const pF = parentExpresses(locus.fatherType, slot.expression);
    const pM = parentExpresses(locus.motherType, slot.expression);
    if (slot.points === undefined) {
      const change = Math.max(0, pFoal - Math.max(pF, pM)) - Math.max(0, Math.min(pF, pM) - pFoal);
      unmeasured += (slot.sign === '+' ? 1 : -1) * change;
      continue;
    }
    const entry = byAttribute.get(slot.attribute) ?? { outcomes: [], father: 0, mother: 0 };
    entry.outcomes.push([slot.points, pFoal]);
    entry.father += pF * slot.points;
    entry.mother += pM * slot.points;
    byAttribute.set(slot.attribute, entry);
  }
  const out: LocusOutlook = { upside: 0, pUp: 0, downside: 0, pDown: 0, unmeasuredSign: null, attributes: [] };
  for (const [attribute, entry] of byAttribute) {
    const expressed = entry.outcomes.reduce((s, [, p]) => s + p, 0);
    const outcomes = [...entry.outcomes, [0, Math.max(0, 1 - expressed)] as [number, number]].filter(
      ([, p]) => p > 1e-12,
    );
    out.attributes.push({ attribute, outcomes, father: entry.father, mother: entry.mother });
    const top = Math.max(entry.father, entry.mother);
    const bottom = Math.min(entry.father, entry.mother);
    for (const [points, p] of outcomes) {
      if (points - top > out.upside + 1e-9) {
        out.upside = points - top;
        out.pUp = p;
      }
      if (bottom - points > out.downside + 1e-9) {
        out.downside = bottom - points;
        out.pDown = p;
      }
    }
  }
  if (out.upside === 0 && out.downside === 0)
    out.unmeasuredSign = unmeasured > 1e-9 ? '+' : unmeasured < -1e-9 ? '-' : null;
  return out;
}
