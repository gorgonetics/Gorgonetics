import { describe, expect, it } from 'vitest';
import {
  classifyTrioLocus,
  expressedSign,
  negativeExpressionProbability,
  offspringDistribution,
  positiveExpressionProbability,
} from '$lib/utils/breedingGenetics.js';

const KNOWN_TYPES = ['D', 'R', 'x'];
const ALL_TYPES = [...KNOWN_TYPES, '?'];

describe('offspringDistribution', () => {
  it.each([
    ['D', 'D', { D: 1, x: 0, R: 0, unknown: 0 }],
    ['R', 'R', { D: 0, x: 0, R: 1, unknown: 0 }],
    ['D', 'R', { D: 0, x: 1, R: 0, unknown: 0 }],
    ['D', 'x', { D: 0.5, x: 0.5, R: 0, unknown: 0 }],
    ['R', 'x', { D: 0, x: 0.5, R: 0.5, unknown: 0 }],
    ['x', 'x', { D: 0.25, x: 0.5, R: 0.25, unknown: 0 }],
  ])('%s × %s yields the canonical Mendelian distribution', (a, b, expected) => {
    expect(offspringDistribution(a, b)).toEqual(expected);
  });

  it('is symmetric in its parents', () => {
    for (const a of KNOWN_TYPES) {
      for (const b of KNOWN_TYPES) {
        expect(offspringDistribution(a, b)).toEqual(offspringDistribution(b, a));
      }
    }
  });

  it('yields a full-unknown distribution whenever either parent is `?`', () => {
    const expected = { D: 0, x: 0, R: 0, unknown: 1 };
    for (const t of ALL_TYPES) {
      expect(offspringDistribution('?', t)).toEqual(expected);
      expect(offspringDistribution(t, '?')).toEqual(expected);
    }
  });

  it('returns a fresh object on every call (mutation does not leak across calls)', () => {
    const first = offspringDistribution('D', 'D');
    first.D = 999;
    const second = offspringDistribution('D', 'D');
    expect(second.D).toBe(1);
  });

  it('always sums to 1', () => {
    for (const a of ALL_TYPES) {
      for (const b of ALL_TYPES) {
        const d = offspringDistribution(a, b);
        expect(d.D + d.x + d.R + d.unknown).toBeCloseTo(1, 10);
      }
    }
  });
});

describe('positiveExpressionProbability', () => {
  const positiveDominant = { dominantSign: '+', recessiveSign: null };
  const positiveRecessive = { dominantSign: null, recessiveSign: '+' };
  const negativeDominant = { dominantSign: '-', recessiveSign: null };
  const bothPositive = { dominantSign: '+', recessiveSign: '+' };
  const bothNegative = { dominantSign: '-', recessiveSign: '-' };

  it('returns 0 when no gene record is provided', () => {
    expect(positiveExpressionProbability(offspringDistribution('D', 'D'), undefined)).toBe(0);
  });

  it('returns 0 for a gene with neither sign positive', () => {
    expect(positiveExpressionProbability(offspringDistribution('D', 'D'), bothNegative)).toBe(0);
    expect(positiveExpressionProbability(offspringDistribution('R', 'R'), bothNegative)).toBe(0);
    expect(positiveExpressionProbability(offspringDistribution('x', 'x'), bothNegative)).toBe(0);
  });

  it('counts D + x mass when only the dominant sign is positive', () => {
    // DD: D=1 → P=1
    expect(positiveExpressionProbability(offspringDistribution('D', 'D'), positiveDominant)).toBe(1);
    // DR: x=1 → P=1
    expect(positiveExpressionProbability(offspringDistribution('D', 'R'), positiveDominant)).toBe(1);
    // RR: R=1 → P=0
    expect(positiveExpressionProbability(offspringDistribution('R', 'R'), positiveDominant)).toBe(0);
    // Dx: D=.5 x=.5 → P=1
    expect(positiveExpressionProbability(offspringDistribution('D', 'x'), positiveDominant)).toBe(1);
    // Rx: x=.5 R=.5 → P=.5
    expect(positiveExpressionProbability(offspringDistribution('R', 'x'), positiveDominant)).toBe(0.5);
    // xx: D=.25 x=.5 R=.25 → P=.75
    expect(positiveExpressionProbability(offspringDistribution('x', 'x'), positiveDominant)).toBeCloseTo(0.75, 10);
  });

  it('counts only R mass when only the recessive sign is positive', () => {
    expect(positiveExpressionProbability(offspringDistribution('R', 'R'), positiveRecessive)).toBe(1);
    expect(positiveExpressionProbability(offspringDistribution('D', 'D'), positiveRecessive)).toBe(0);
    expect(positiveExpressionProbability(offspringDistribution('D', 'R'), positiveRecessive)).toBe(0);
    expect(positiveExpressionProbability(offspringDistribution('R', 'x'), positiveRecessive)).toBe(0.5);
    expect(positiveExpressionProbability(offspringDistribution('x', 'x'), positiveRecessive)).toBeCloseTo(0.25, 10);
  });

  it('sums both contributions when both signs are positive', () => {
    // Every known-allele case should give P = 1 - unknown.
    for (const a of KNOWN_TYPES) {
      for (const b of KNOWN_TYPES) {
        const dist = offspringDistribution(a, b);
        expect(positiveExpressionProbability(dist, bothPositive)).toBeCloseTo(1, 10);
      }
    }
  });

  it('contributes 0 when either parent is unknown, regardless of sign', () => {
    const dist = offspringDistribution('?', 'D');
    expect(positiveExpressionProbability(dist, positiveDominant)).toBe(0);
    expect(positiveExpressionProbability(dist, positiveRecessive)).toBe(0);
    expect(positiveExpressionProbability(dist, bothPositive)).toBe(0);
  });

  it('ignores negative dominant signs (they do not subtract from positive)', () => {
    // negativeDominant has dominantSign === '-', not '+', so it returns 0.
    expect(positiveExpressionProbability(offspringDistribution('D', 'D'), negativeDominant)).toBe(0);
  });
});

describe('negativeExpressionProbability', () => {
  const negativeDominant = { dominantSign: '-', recessiveSign: null };
  const negativeRecessive = { dominantSign: null, recessiveSign: '-' };
  const positiveDominant = { dominantSign: '+', recessiveSign: null };

  it('mirrors the positive helper for the `-` sign', () => {
    // xx: D=.25 x=.5 R=.25 → dominant `-` mass = .75
    expect(negativeExpressionProbability(offspringDistribution('x', 'x'), negativeDominant)).toBeCloseTo(0.75, 10);
    // xx recessive `-` → R mass = .25
    expect(negativeExpressionProbability(offspringDistribution('x', 'x'), negativeRecessive)).toBeCloseTo(0.25, 10);
  });

  it('returns 0 for positive-signed or missing genes', () => {
    expect(negativeExpressionProbability(offspringDistribution('D', 'D'), positiveDominant)).toBe(0);
    expect(negativeExpressionProbability(offspringDistribution('D', 'D'), undefined)).toBe(0);
  });
});

describe('expressedSign', () => {
  const gene = { dominantSign: '+', recessiveSign: '-' };

  it('reads the dominant sign for D and x, recessive for R, nothing for ?', () => {
    expect(expressedSign('D', gene)).toBe('+');
    expect(expressedSign('x', gene)).toBe('+');
    expect(expressedSign('R', gene)).toBe('-');
    expect(expressedSign('?', gene)).toBeNull();
  });

  it('returns null without a gene record', () => {
    expect(expressedSign('D', undefined)).toBeNull();
  });
});

describe('classifyTrioLocus', () => {
  const recPositive = { dominantSign: null, recessiveSign: '+' };
  const recNegative = { dominantSign: null, recessiveSign: '-' };
  const domPositive = { dominantSign: '+', recessiveSign: null };

  const classify = (f, m, gene) => classifyTrioLocus(f, m, offspringDistribution(f, m), gene);

  it('flags a new recessive positive neither parent expresses (x × x) as a gain from both', () => {
    const c = classify('x', 'x', recPositive);
    expect(c.verdict).toBe('gain');
    expect(c.source).toBe('both');
    expect(c.lockedIn).toBe(false);
    expect(c.pPositive).toBeCloseTo(0.25, 10);
  });

  it('does not flag a gain when a parent already expresses the positive', () => {
    // Father R expresses the recessive +, so the offspring positive is not new.
    const c = classify('R', 'x', recPositive);
    expect(c.verdict).toBe('neutral');
  });

  it('flags a new recessive negative neither parent expresses (x × x) as a risk', () => {
    const c = classify('x', 'x', recNegative);
    expect(c.verdict).toBe('risk');
    expect(c.source).toBe('both');
    expect(c.pNegative).toBeCloseTo(0.25, 10);
  });

  it('flags locking in a heterozygous dominant positive as a gain, attributed to the het parent', () => {
    // Father x, mother D — both already express +, but offspring can be DD.
    const c = classify('x', 'D', domPositive);
    expect(c.verdict).toBe('gain');
    expect(c.lockedIn).toBe(true);
    expect(c.source).toBe('father');
  });

  it('returns neutral when both parents are already homozygous-dominant positive', () => {
    const c = classify('D', 'D', domPositive);
    expect(c.verdict).toBe('neutral');
    expect(c.lockedIn).toBe(false);
  });

  it('returns neutral for an unknown parent and for a missing gene record', () => {
    expect(classify('?', 'D', domPositive).verdict).toBe('neutral');
    expect(classify('x', 'x', undefined).verdict).toBe('neutral');
    expect(classify('x', 'x', undefined).source).toBeNull();
  });
});
