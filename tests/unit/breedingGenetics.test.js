import { describe, expect, it } from 'vitest';
import { offspringDistribution, positiveExpressionProbability } from '$lib/utils/breedingGenetics.js';

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
