import { describe, expect, it } from 'vitest';
import type { ParsedGeneRecord } from '$lib/services/geneService.js';
import { GeneType } from '$lib/types/index.js';
import type { AttributeMagnitudes } from '$lib/utils/attributePoints.js';
import { comparable, locusOutlook, offspringAttributeOutlooks, type PairLocus } from '$lib/utils/offspringImpact.js';

const gene = (over: Partial<ParsedGeneRecord> = {}): ParsedGeneRecord => ({
  dominantAttribute: null,
  dominantSign: null,
  recessiveAttribute: 'toughness',
  recessiveSign: '+',
  breed: '',
  ...over,
});
const magnitudes = (points: Record<string, number>): AttributeMagnitudes => ({
  points: new Map(Object.entries(points)),
  coverage: new Map(),
});
const dist = (D: number, x: number, R: number, unknown = 0) => ({ D, x, R, unknown });
const parent = (breed: string, toughness: number | null = null) => ({
  breed,
  values: toughness === null ? null : { toughness },
});
// Two mixed parents: a quarter of foals are recessive.
const mixedCross = (geneId = '01A1'): PairLocus => ({
  geneId,
  fatherType: GeneType.MIXED,
  motherType: GeneType.MIXED,
  dist: dist(0.25, 0.5, 0.25),
});

describe('comparable', () => {
  it('needs the foal breed for a breed-scoped species, and nothing for a pooled one', () => {
    expect(comparable(parent('Kurbone'), 'Kurbone', true)).toBe(true);
    expect(comparable(parent('Paint'), 'Kurbone', true)).toBe(false);
    expect(comparable(parent('Mixed'), 'Mixed', true)).toBe(false);
    expect(comparable(parent('Wasp'), 'Bee', false)).toBe(true);
  });
});

describe('offspringAttributeOutlooks', () => {
  const base = {
    parsed: { '01A1': gene() },
    magnitudes: magnitudes({ '01A1:recessive': 4 }),
    offspringBreed: 'Kurbone',
    breedScoped: true,
    attributes: ['Toughness'],
  };

  it('keeps a recessive gain two mixed parents cannot show: 25% of foals beat both by its size', () => {
    const [t] = offspringAttributeOutlooks({
      ...base,
      loci: [mixedCross()],
      father: parent('Kurbone', 60),
      mother: parent('Kurbone', 55),
    });
    expect(t.distribution).toEqual([
      [0, 0.75],
      [4, 0.25],
    ]);
    // Neither parent expresses it, so both have 0 measured points here.
    expect(t.fatherPoints).toBe(0);
    expect(t.motherPoints).toBe(0);
    expect(t.pBeatsBoth).toBe(0.25);
    expect(t.pBelowBoth).toBe(0);
    expect(t.bestGain).toBe(4);
    expect(t.pBest).toBe(0.25);
    // Anchored on the better parent by measured points (a tie, father first).
    expect(t.bestValue).toBe(64);
  });

  it('combines loci, and compares with no readings at all', () => {
    const [t] = offspringAttributeOutlooks({
      ...base,
      parsed: { '01A1': gene(), '01A2': gene() },
      magnitudes: magnitudes({ '01A1:recessive': 4, '01A2:recessive': 2 }),
      loci: [mixedCross('01A1'), mixedCross('01A2')],
      father: parent('Kurbone'),
      mother: parent('Kurbone'),
    });
    expect(t.pBeatsBoth).toBeCloseTo(1 - 0.75 * 0.75);
    expect(t.bestGain).toBe(6);
    expect(t.pBest).toBeCloseTo(0.0625);
    expect(t.bestValue).toBeNull();
    expect(t.fatherValue).toBeNull();
  });

  it('counts a chance of falling below both when a positive both parents show can be lost', () => {
    // Both parents are x at a +4 dominant slot, so both express it; a quarter
    // of foals are recessive and lose it.
    const [t] = offspringAttributeOutlooks({
      ...base,
      parsed: {
        '01A1': gene({
          dominantAttribute: 'toughness',
          dominantSign: '+',
          recessiveAttribute: null,
          recessiveSign: null,
        }),
      },
      magnitudes: magnitudes({ '01A1:dominant': 4 }),
      loci: [mixedCross()],
      father: parent('Kurbone'),
      mother: parent('Kurbone'),
    });
    expect(t.fatherPoints).toBe(4);
    expect(t.pBeatsBoth).toBe(0);
    expect(t.pBelowBoth).toBe(0.25);
    expect(t.bestGain).toBe(0);
  });

  it('makes no comparison with a parent of another breed', () => {
    const [t] = offspringAttributeOutlooks({
      ...base,
      loci: [mixedCross()],
      father: parent('Paint', 60),
      mother: parent('Paint', 55),
    });
    expect(t.pBeatsBoth).toBeNull();
    expect(t.bestGain).toBeNull();
    expect(t.fatherPoints).toBeNull();
  });

  it('gives an unmeasured recessive gain a direction beyond both parents', () => {
    const [t] = offspringAttributeOutlooks({
      ...base,
      magnitudes: magnitudes({}),
      loci: [mixedCross()],
      father: parent('Kurbone'),
      mother: parent('Kurbone'),
    });
    expect(t.unmeasuredUp).toBe(0.25);
    expect(t.unmeasuredDown).toBe(0);
  });
});

describe('locusOutlook', () => {
  it('reports the upside over the better parent and the downside below the weaker one', () => {
    const gd = gene({ dominantAttribute: 'toughness', dominantSign: '-' });
    const o = locusOutlook(mixedCross(), gd, magnitudes({ '01A1:recessive': 4, '01A1:dominant': -3 }));
    // Both parents are x: express the dominant -3. The foal: -3 (75%) or +4 (25%).
    expect(o.upside).toBe(7);
    expect(o.pUp).toBe(0.25);
    expect(o.downside).toBe(0);
    expect(o.attributes[0]).toMatchObject({ attribute: 'Toughness', father: -3, mother: -3 });
  });
});
