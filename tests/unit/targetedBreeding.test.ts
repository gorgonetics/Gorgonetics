import { describe, expect, it } from 'vitest';
import { GeneType } from '$lib/types/index.js';
import type { AttributeMagnitudes } from '$lib/utils/attributePoints.js';
import type { PetLoci } from '$lib/utils/petLoci.js';
import {
  bridgeOutlook,
  expectedFoals,
  idealMiddle,
  idealPartner,
  partnerOutlook,
  type SlotAttributes,
  wantedFrom,
} from '$lib/utils/targetedBreeding.js';

const { DOMINANT: D, MIXED: x, RECESSIVE: R, UNKNOWN: U } = GeneType;

const attributes = ['Temperament', 'Friendliness', 'Intelligence'];

const genes: Record<string, SlotAttributes> = {
  // Lifts Temperament when dominant, nothing when recessive.
  '01A1': { dominantAttribute: 'temperament', dominantSign: '+', recessiveAttribute: null, recessiveSign: null },
  // Temperament when dominant, Friendliness when recessive: the trade-off.
  '01A2': {
    dominantAttribute: 'temperament',
    dominantSign: '+',
    recessiveAttribute: 'friendliness',
    recessiveSign: '+',
  },
  // Temperament, size never measured.
  '01A3': { dominantAttribute: 'temperament', dominantSign: '+', recessiveAttribute: null, recessiveSign: null },
  // Costs Temperament when recessive; size never measured.
  '01A4': { dominantAttribute: null, dominantSign: null, recessiveAttribute: 'temperament', recessiveSign: '-' },
  // Costs Temperament when recessive, by 3.
  '01A5': { dominantAttribute: null, dominantSign: null, recessiveAttribute: 'temperament', recessiveSign: '-' },
};

const magnitudes: AttributeMagnitudes = {
  points: new Map([
    ['01A1:dominant', 5],
    ['01A2:dominant', 4],
    ['01A2:recessive', 3],
    ['01A5:recessive', -3],
  ]),
  coverage: new Map(),
};

const loci = (entries: Record<string, GeneType>): PetLoci => new Map(Object.entries(entries));

const outlook = (anchor: PetLoci, partner: PetLoci, over: { targets?: string[]; tolerance?: number } = {}) =>
  partnerOutlook(anchor, partner, genes, magnitudes, {
    attributes,
    targets: over.targets ?? ['Temperament'],
    tolerance: over.tolerance ?? 0,
  });

describe('partnerOutlook', () => {
  it('scores a partner that gives every foal a positive the anchor lacks', () => {
    const result = outlook(loci({ '01A1': R }), loci({ '01A1': D }));
    expect(result.expected.Temperament).toBe(5);
    expect(result.pTargets).toBe(1);
    expect(result.pSuccess).toBe(1);
    expect(result.levers).toEqual([
      { gene: '01A1', attribute: 'Temperament', anchor: R, partner: D, expected: 5, pChange: 1 },
    ]);
  });

  it('counts what a target gain costs elsewhere, within the tolerance', () => {
    const anchor = loci({ '01A2': R });
    const partner = loci({ '01A2': D });
    const strict = outlook(anchor, partner);
    expect(strict.expected).toMatchObject({ Temperament: 4, Friendliness: -3 });
    expect(strict.pTargets).toBe(1);
    expect(strict.pSuccess).toBe(0);
    expect(strict.pDrop.Friendliness).toBe(1);
    expect(outlook(anchor, partner, { tolerance: 3 }).pSuccess).toBe(1);
  });

  it('computes a segregating locus exactly', () => {
    const result = outlook(loci({ '01A1': R }), loci({ '01A1': x }));
    expect(result.expected.Temperament).toBe(2.5);
    expect(result.levers[0].pChange).toBe(0.5);
    expect(result.pTargets).toBe(0.5);
  });

  it('counts dropping a negative as an improvement', () => {
    const result = outlook(loci({ '01A5': R }), loci({ '01A5': D }));
    expect(result.expected.Temperament).toBe(3);
    expect(result.pTargets).toBe(1);
    expect(result.levers[0]).toMatchObject({ gene: '01A5', expected: 3 });
  });

  it('counts an unmeasured change by its declared direction, without guessing its size', () => {
    const gain = outlook(loci({ '01A3': R }), loci({ '01A3': D }));
    expect(gain.expected.Temperament).toBe(0);
    expect(gain.unmeasured.Temperament).toEqual({ better: 1, worse: 0 });
    expect(gain.pTargets).toBe(0);
    expect(gain.levers).toEqual([]);
    // Losing an unmeasured negative is better; gaining one is worse.
    expect(outlook(loci({ '01A4': R }), loci({ '01A4': D })).unmeasured.Temperament).toEqual({ better: 1, worse: 0 });
    expect(outlook(loci({ '01A4': x }), loci({ '01A4': x })).unmeasured.Temperament).toEqual({
      better: 0,
      worse: 0.25,
    });
  });

  it('skips loci either parent has hidden', () => {
    const result = outlook(loci({ '01A1': R }), loci({ '01A1': U }));
    expect(result.expected.Temperament).toBe(0);
    expect(result.levers).toEqual([]);
  });

  it('needs every target up at once', () => {
    const result = outlook(loci({ '01A1': R }), loci({ '01A1': D }), { targets: ['Temperament', 'Intelligence'] });
    expect(result.pTargets).toBe(0);
  });

  it('gives the same answer every time', () => {
    const anchor = loci({ '01A1': x, '01A2': x });
    const partner = loci({ '01A1': x, '01A2': x });
    expect(outlook(anchor, partner)).toEqual(outlook(anchor, partner));
  });
});

describe('idealPartner', () => {
  const options = { attributes, targets: ['Temperament'] };

  it('asks for the allele that keeps a recessive positive', () => {
    const recessivePlus: Record<string, SlotAttributes> = {
      '02D1': { dominantAttribute: null, dominantSign: null, recessiveAttribute: 'temperament', recessiveSign: '+' },
    };
    const sized: AttributeMagnitudes = { points: new Map([['02D1:recessive', 7]]), coverage: new Map() };
    const [need] = idealPartner(loci({ '02D1': R }), recessivePlus, sized, options);
    expect(need).toEqual({ gene: '02D1', anchor: R, best: R, byPartner: { D: -7, x: -3.5, R: 0 } });
  });

  it('lists only loci where the partner makes a difference, largest stake first', () => {
    const needs = idealPartner(loci({ '01A1': R, '01A2': D, '01A3': R, '01A5': R }), genes, magnitudes, options);
    // 01A2 is D: every foal expresses its dominant slot. 01A3 is unmeasured.
    // 01A5 is a negative the anchor carries: a D partner drops it.
    expect(needs.map((n) => [n.gene, n.best])).toEqual([
      ['01A1', D],
      ['01A5', D],
    ]);
  });
});

describe('bridgeOutlook', () => {
  const options = { attributes, targets: ['Temperament'], tolerance: 0 };
  const bridge = (anchor: PetLoci, sire: PetLoci, dam: PetLoci, wanted = new Map<string, Set<'D' | 'x' | 'R'>>()) =>
    bridgeOutlook(anchor, sire, dam, genes, magnitudes, options, wanted);

  it('averages over every middle foal when nothing is chosen for', () => {
    // Anchor carries 01A5's −3. Sire x × dam R: half the middle foals are x,
    // and half of the anchor's foals by an x drop the negative.
    const { outlook, keep, pQualify } = bridge(loci({ '01A5': R }), loci({ '01A5': x }), loci({ '01A5': R }));
    expect(outlook.expected.Temperament).toBe(0.75);
    expect(keep).toEqual([]);
    expect(pQualify).toBe(1);
  });

  it('keeps the middle foal that carries the wanted allele, and says how often one does', () => {
    const wanted = new Map([['01A5', new Set<'D' | 'x' | 'R'>(['D', 'x'])]]);
    const { outlook, keep, pQualify } = bridge(loci({ '01A5': R }), loci({ '01A5': x }), loci({ '01A5': R }), wanted);
    expect(keep).toEqual([{ gene: '01A5', allowed: ['D', 'x'], p: 0.5 }]);
    expect(pQualify).toBe(0.5);
    // The kept foal is x for sure, so half the anchor's foals drop the −3.
    expect(outlook.expected.Temperament).toBe(1.5);
    expect(outlook.levers[0]).toMatchObject({ gene: '01A5', partner: null, expected: 1.5, pChange: 0.5 });
  });

  it('sets no rule where the pair cannot deliver the allele, or always does', () => {
    const wanted = new Map([['01A5', new Set<'D' | 'x' | 'R'>(['D', 'x'])]]);
    expect(bridge(loci({ '01A5': R }), loci({ '01A5': R }), loci({ '01A5': R }), wanted).keep).toEqual([]);
    expect(bridge(loci({ '01A5': R }), loci({ '01A5': D }), loci({ '01A5': R }), wanted).keep).toEqual([]);
  });

  it('matches a direct partner when the middle foal is certain', () => {
    const route = bridge(loci({ '01A1': R }), loci({ '01A1': D }), loci({ '01A1': D })).outlook;
    const direct = partnerOutlook(loci({ '01A1': R }), loci({ '01A1': D }), genes, magnitudes, options);
    expect(route.expected).toEqual(direct.expected);
    expect(route.pSuccess).toBe(direct.pSuccess);
  });

  it('skips loci either grandparent has hidden', () => {
    expect(bridge(loci({ '01A5': R }), loci({ '01A5': U }), loci({ '01A5': R })).outlook.expected.Temperament).toBe(0);
  });
});

describe('wantedFrom', () => {
  it('wants the genotypes that lift the targets, at gain loci only', () => {
    const wanted = wantedFrom([
      { gene: '08B3', anchor: R, best: 'D', byPartner: { D: 6, x: 3, R: 0 } },
      { gene: '14A2', anchor: R, best: 'R', byPartner: { D: -9, x: -4.5, R: 0 } },
    ]);
    expect([...wanted]).toEqual([['08B3', new Set(['D', 'x'])]]);
  });
});

describe('idealMiddle', () => {
  const needs = [
    { gene: '08B3', anchor: R, best: 'D' as const, byPartner: { D: 6, x: 3, R: 0 } },
    { gene: '14A2', anchor: R, best: 'R' as const, byPartner: { D: -9, x: -4.5, R: 0 } },
  ];

  it('asks for the best genotype the pair can give at every locus that matters', () => {
    // x × R gives x or R at both: the best of those is x at 08B3, R at 14A2.
    const wanted = idealMiddle(loci({ '08B3': x, '14A2': x }), loci({ '08B3': R, '14A2': R }), needs);
    expect([...wanted]).toEqual([
      ['08B3', new Set(['x'])],
      ['14A2', new Set(['R'])],
    ]);
  });

  it('sets no rule where every foal of the pair is the same', () => {
    expect([...idealMiddle(loci({ '08B3': R, '14A2': D }), loci({ '08B3': R, '14A2': R }), needs)]).toEqual([]);
  });
});

describe('expectedFoals', () => {
  it('waits for a success from a direct partner', () => {
    expect(expectedFoals(0.25)).toBe(4);
    expect(expectedFoals(0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('adds the wait for a middle foal worth keeping, which is at least one foal', () => {
    expect(expectedFoals(0.5, 0.25)).toBe(6);
    expect(expectedFoals(0.5, 1)).toBe(3);
    expect(expectedFoals(0.5, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('joint probabilities', () => {
  // Brute force over every combination of foal genotypes, as a reference:
  // each foal's change per attribute is added up directly from the slots.
  const enumerate = (anchor: PetLoci, partner: PetLoci, tolerance: number) => {
    const slotOf = (gene: string, t: GeneType): [string, number] | null => {
      const g = genes[gene];
      const dominant = t !== R;
      const attr = dominant ? g.dominantAttribute : g.recessiveAttribute;
      if (!attr) return null;
      return [attr, magnitudes.points.get(`${gene}:${dominant ? 'dominant' : 'recessive'}`) ?? 0];
    };
    const genesIn = [...anchor.keys()];
    const alleles = (t: GeneType) => (t === D ? 'DD' : t === R ? 'RR' : 'DR');
    let success = 0;
    const visit = (i: number, p: number, change: Record<string, number>) => {
      if (i === genesIn.length) {
        const up = (change.temperament ?? 0) > 0;
        const kept = ['friendliness', 'intelligence'].every((a) => (change[a] ?? 0) >= -tolerance);
        if (up && kept) success += p;
        return;
      }
      const gene = genesIn[i];
      const from = slotOf(gene, anchor.get(gene) as GeneType);
      for (const a1 of alleles(anchor.get(gene) as GeneType)) {
        for (const a2 of alleles(partner.get(gene) as GeneType)) {
          const foal: GeneType = a1 === a2 ? (a1 === 'D' ? D : R) : x;
          const to = slotOf(gene, foal);
          const next = { ...change };
          if (from) next[from[0]] = (next[from[0]] ?? 0) - from[1];
          if (to) next[to[0]] = (next[to[0]] ?? 0) + to[1];
          visit(i + 1, p / 4, next);
        }
      }
    };
    visit(0, 1, {});
    return success;
  };

  it('matches brute force when one locus trades one attribute for another', () => {
    // 01A2 lifts Temperament when dominant and Friendliness when recessive.
    // Half the foals drop the anchor's 01A5 −3; half swap 01A2's recessive
    // Friendliness +3 for its dominant Temperament +4. Kept within 0 points
    // only the first helps (1/4); within 3, either does (3/4).
    const anchor = loci({ '01A2': R, '01A5': R });
    const partner = loci({ '01A2': x, '01A5': x });
    for (const tolerance of [0, 3]) {
      const o = partnerOutlook(anchor, partner, genes, magnitudes, { attributes, targets: ['Temperament'], tolerance });
      const reference = enumerate(anchor, partner, tolerance);
      // A case where neither answer is trivial.
      expect(reference).toBeGreaterThan(0);
      expect(reference).toBeLessThan(1);
      expect(o.pSuccess).toBeCloseTo(reference, 10);
      expect(o.pSuccess).toBe(tolerance === 0 ? 0.25 : 0.75);
      expect(o.pSuccess).toBeLessThanOrEqual(o.pSuccessBound);
    }
  });

  it('skips the joint figure on request, reporting its bound instead', () => {
    const anchor = loci({ '01A1': x, '01A2': x });
    const o = partnerOutlook(anchor, anchor, genes, magnitudes, {
      attributes,
      targets: ['Temperament'],
      tolerance: 0,
      joint: false,
    });
    expect(o.pSuccess).toBe(o.pSuccessBound);
  });
});
