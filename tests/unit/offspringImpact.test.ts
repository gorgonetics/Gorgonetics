import { describe, expect, it } from 'vitest';
import type { ParsedGeneRecord } from '$lib/services/geneService.js';
import { GeneType } from '$lib/types/index.js';
import type { AttributeMagnitudes } from '$lib/utils/attributePoints.js';
import {
  canAnchor,
  locusExpectedPoints,
  offspringAttributeExpectations,
  type PairLocus,
} from '$lib/utils/offspringImpact.js';

const gene = (over: Partial<ParsedGeneRecord> = {}): ParsedGeneRecord => ({
  dominantAttribute: 'toughness',
  dominantSign: '+',
  recessiveAttribute: null,
  recessiveSign: null,
  breed: '',
  ...over,
});
const magnitudes = (points: Record<string, number>): AttributeMagnitudes => ({
  points: new Map(Object.entries(points)),
  coverage: new Map(),
});
const dist = (D: number, x: number, R: number, unknown = 0) => ({ D, x, R, unknown });
const parent = (breed: string, toughness: number, measured = true) => ({ breed, measured, values: { toughness } });

describe('canAnchor', () => {
  it('needs readings, and for a breed-scoped species the same, real breed', () => {
    expect(canAnchor(parent('Kurbone', 50), 'Kurbone', true)).toBe(true);
    expect(canAnchor(parent('Kurbone', 50, false), 'Kurbone', true)).toBe(false);
    expect(canAnchor(parent('Paint', 50), 'Kurbone', true)).toBe(false);
    expect(canAnchor(parent('Mixed', 50), 'Mixed', true)).toBe(false);
    expect(canAnchor(parent('', 50), '', true)).toBe(false);
    // Beewasps share one base, so any measured parent anchors.
    expect(canAnchor(parent('Wasp', 50), 'Bee', false)).toBe(true);
  });
});

describe('offspringAttributeExpectations', () => {
  // D x R cross at a +4 dominant locus: foal is x with certainty (p=1), so it
  // expresses the slot. Father (D) already does; mother (R) does not.
  const loci: PairLocus[] = [
    { geneId: '01A1', fatherType: GeneType.DOMINANT, motherType: GeneType.RECESSIVE, dist: dist(0, 1, 0) },
  ];
  const base = {
    loci,
    parsed: { '01A1': gene() },
    magnitudes: magnitudes({ '01A1:dominant': 4 }),
    offspringBreed: 'Kurbone',
    breedScoped: true,
    attributes: ['Toughness'],
  };

  it('anchors on each same-breed parent and averages', () => {
    const [t] = offspringAttributeExpectations({
      ...base,
      father: parent('Kurbone', 60),
      mother: parent('Kurbone', 52),
    });
    expect(t.measuredMean).toBe(4);
    // Father already expresses +4: foal = 60. Mother does not: foal = 52 + 4.
    expect(t.father).toEqual({ value: 60, expected: 60 });
    expect(t.mother).toEqual({ value: 52, expected: 56 });
    expect(t.expected).toBe(58);
    expect(t.sd).toBe(0);
  });

  it('claims no absolute value when no parent is of the foal breed', () => {
    const [t] = offspringAttributeExpectations({
      ...base,
      father: parent('Paint', 60),
      mother: parent('Paint', 52),
    });
    expect(t.expected).toBeNull();
    expect(t.measuredMean).toBe(4);
  });

  it('reports spread for an uncertain locus', () => {
    const [t] = offspringAttributeExpectations({
      ...base,
      loci: [{ geneId: '01A1', fatherType: GeneType.MIXED, motherType: GeneType.MIXED, dist: dist(0.25, 0.5, 0.25) }],
      father: parent('Kurbone', 60),
      mother: parent('Kurbone', 60),
    });
    // p = 0.75 of +4: mean 3, variance 16·0.75 − 9 = 3.
    expect(t.measuredMean).toBe(3);
    expect(t.sd).toBeCloseTo(Math.sqrt(3));
    // Both parents express it: the foal is expected one point lower.
    expect(t.expected).toBe(59);
  });

  it('gives unmeasured effects a direction against the anchors, never a size', () => {
    const [t] = offspringAttributeExpectations({
      ...base,
      magnitudes: magnitudes({}),
      father: parent('Kurbone', 60),
      mother: parent('Kurbone', 52),
    });
    expect(t.measuredMean).toBe(0);
    // Against the father (expresses): no change. Against the mother: +1 up.
    expect(t.unmeasuredUp).toBe(0.5);
    expect(t.unmeasuredDown).toBe(0);
    expect(t.expected).toBe(56);
  });
});

describe('locusExpectedPoints', () => {
  it('sums measured slots and signs the unmeasured ones', () => {
    const locus = { geneId: '01A1', fatherType: null, motherType: null, dist: dist(0.5, 0, 0.5) };
    const gd = gene({ recessiveAttribute: 'ferocity', recessiveSign: '-' });
    expect(locusExpectedPoints(locus, gd, magnitudes({ '01A1:dominant': 4 }))).toEqual({
      points: 2,
      unmeasuredSign: '-',
    });
  });
});
