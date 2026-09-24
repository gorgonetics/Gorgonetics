/**
 * Expected foal attributes for a breeding pair, from the study's measured
 * gene effects.
 *
 * An attribute is `base + Σ expressed effects`, and the study never learns
 * `base`. It does not need to here either, for the same reason the study
 * itself does not: a parent of the foal's breed shares the foal's base, so
 *
 *     E[foal] − parent = Σ over slots (P_foal(slot) − parent expresses slot) · m
 *
 * and the base cancels. With a measured `m` that term is a number; with an
 * unmeasured one it is a direction only, reported as the expected count of
 * unmeasured effects that move the value up or down. Anchored on each
 * parent of the breed whose attributes are readings; two anchors are
 * averaged. With none, only the measured genes' expected contribution is
 * known, and no absolute value is claimed.
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

/** A parent as an anchor: its breed, whether its attributes are readings, and the values. */
export interface AnchorParent {
  breed: string;
  measured: boolean;
  /** Lowercased attribute name -> value. */
  values: Record<string, number>;
}

export interface AnchorEstimate {
  /** The parent's observed value. */
  value: number;
  /** The foal's expected value, anchored on this parent. */
  expected: number;
}

export interface AttributeExpectation {
  /** Capitalised, as the breeding scorers and the UI name attributes. */
  attribute: string;
  /** Σ E[foal's measured points] over the breed's loci. */
  measuredMean: number;
  /** Spread of the measured points (independent loci, exclusive slots within one). */
  sd: number;
  father: AnchorEstimate | null;
  mother: AnchorEstimate | null;
  /** Mean of the anchor estimates, or null with no anchor. */
  expected: number | null;
  /**
   * Expected count of unmeasured effects moving the value up / down against
   * the anchor parent(s) — a direction with no size. Against no anchor, the
   * foal's expected unmeasured positives and negatives.
   */
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

/** Whether a parent can anchor the foal's breed: same breed, readings, and a breed that is one. */
export function canAnchor(parent: AnchorParent, offspringBreed: string, breedScoped: boolean): boolean {
  if (!parent.measured) return false;
  if (!breedScoped) return true;
  // Mixed has no single base: which breed-locked loci apply to it is unknowable.
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

export interface OffspringImpactInput {
  loci: Iterable<PairLocus>;
  parsed: Record<string, ParsedGeneRecord>;
  magnitudes: AttributeMagnitudes;
  father: AnchorParent;
  mother: AnchorParent;
  offspringBreed: string;
  /** Whether the species' loci and bases are breed-scoped (horses). */
  breedScoped: boolean;
  /** Attribute order for the output, capitalised. */
  attributes: readonly string[];
}

export function offspringAttributeExpectations(input: OffspringImpactInput): AttributeExpectation[] {
  const { parsed, magnitudes, father, mother, offspringBreed, breedScoped, attributes } = input;
  const anchorF = canAnchor(father, offspringBreed, breedScoped);
  const anchorM = canAnchor(mother, offspringBreed, breedScoped);

  const acc = new Map<
    string,
    {
      mean: number;
      variance: number;
      knownF: number;
      knownM: number;
      upF: number;
      downF: number;
      upM: number;
      downM: number;
      up: number;
      down: number;
    }
  >();
  const get = (attribute: string) => {
    let a = acc.get(attribute);
    if (!a) {
      a = { mean: 0, variance: 0, knownF: 0, knownM: 0, upF: 0, downF: 0, upM: 0, downM: 0, up: 0, down: 0 };
      acc.set(attribute, a);
    }
    return a;
  };

  for (const locus of input.loci) {
    const slots = slotsOf(parsed[locus.geneId], locus.geneId, magnitudes);
    // Within one locus the two slots are exclusive (a foal is D/x or R), so
    // same-attribute slots share one variance term: E[X²] − E[X]².
    const perAttribute = new Map<string, { m1: number; m2: number }>();
    for (const slot of slots) {
      const a = get(slot.attribute);
      const pFoal = foalExpresses(locus.dist, slot.expression);
      const pF = parentExpresses(locus.fatherType, slot.expression);
      const pM = parentExpresses(locus.motherType, slot.expression);
      if (slot.points !== undefined) {
        a.mean += pFoal * slot.points;
        a.knownF += pF * slot.points;
        a.knownM += pM * slot.points;
        const moments = perAttribute.get(slot.attribute) ?? { m1: 0, m2: 0 };
        moments.m1 += pFoal * slot.points;
        moments.m2 += pFoal * slot.points * slot.points;
        perAttribute.set(slot.attribute, moments);
      } else {
        const dir = slot.sign === '+' ? 1 : -1;
        const vsF = dir * (pFoal - pF);
        const vsM = dir * (pFoal - pM);
        a.upF += Math.max(0, vsF);
        a.downF += Math.max(0, -vsF);
        a.upM += Math.max(0, vsM);
        a.downM += Math.max(0, -vsM);
        if (dir > 0) a.up += pFoal;
        else a.down += pFoal;
      }
    }
    for (const [attribute, { m1, m2 }] of perAttribute) get(attribute).variance += m2 - m1 * m1;
  }

  const order = [...attributes];
  for (const attribute of acc.keys()) if (!order.includes(attribute)) order.push(attribute);

  return order.map((attribute) => {
    const a = acc.get(attribute) ?? get(attribute);
    const key = attribute.toLowerCase();
    const anchor = (ok: boolean, parent: AnchorParent, known: number): AnchorEstimate | null => {
      const value = parent.values[key];
      if (!ok || typeof value !== 'number') return null;
      return { value, expected: value + a.mean - known };
    };
    const f = anchor(anchorF, father, a.knownF);
    const m = anchor(anchorM, mother, a.knownM);
    const estimates = [f, m].filter((e): e is AnchorEstimate => e !== null);
    const expected = estimates.length ? estimates.reduce((s, e) => s + e.expected, 0) / estimates.length : null;
    // Unmeasured direction against the same anchors the estimate used.
    const n = (f ? 1 : 0) + (m ? 1 : 0);
    const unmeasuredUp = n ? ((f ? a.upF : 0) + (m ? a.upM : 0)) / n : a.up;
    const unmeasuredDown = n ? ((f ? a.downF : 0) + (m ? a.downM : 0)) / n : a.down;
    return {
      attribute,
      measuredMean: a.mean,
      sd: Math.sqrt(Math.max(0, a.variance)),
      father: f,
      mother: m,
      expected,
      unmeasuredUp,
      unmeasuredDown,
    };
  });
}

/** Expected measured points the foal gets at one locus, over every attribute, for the lens tint. */
export function locusExpectedPoints(
  locus: PairLocus,
  gd: ParsedGeneRecord | undefined,
  magnitudes: AttributeMagnitudes,
): { points: number; unmeasuredSign: '+' | '-' | null } {
  let points = 0;
  let unmeasured = 0;
  for (const slot of slotsOf(gd, locus.geneId, magnitudes)) {
    const p = foalExpresses(locus.dist, slot.expression);
    if (slot.points !== undefined) points += p * slot.points;
    else unmeasured += (slot.sign === '+' ? 1 : -1) * p;
  }
  return { points, unmeasuredSign: unmeasured > 0 ? '+' : unmeasured < 0 ? '-' : null };
}
