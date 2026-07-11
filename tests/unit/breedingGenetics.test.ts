import { describe, expect, it } from 'vitest';
import type { GeneType } from '$lib/types/index.js';
import type { GeneSignSummary } from '$lib/utils/breedingGenetics.js';
import {
  classifyTrioLocus,
  expressedSign,
  negativeExpressionProbability,
  offspringDistribution,
  offspringOutcomeBuckets,
  positiveExpressionProbability,
} from '$lib/utils/breedingGenetics.js';

const KNOWN_TYPES: GeneType[] = ['D', 'R', 'x'];
const ALL_TYPES: GeneType[] = [...KNOWN_TYPES, '?'];

describe('offspringDistribution', () => {
  it.each([
    ['D', 'D', { D: 1, x: 0, R: 0, unknown: 0 }],
    ['R', 'R', { D: 0, x: 0, R: 1, unknown: 0 }],
    ['D', 'R', { D: 0, x: 1, R: 0, unknown: 0 }],
    ['D', 'x', { D: 0.5, x: 0.5, R: 0, unknown: 0 }],
    ['R', 'x', { D: 0, x: 0.5, R: 0.5, unknown: 0 }],
    ['x', 'x', { D: 0.25, x: 0.5, R: 0.25, unknown: 0 }],
  ])('%s × %s yields the canonical Mendelian distribution', (a, b, expected) => {
    expect(offspringDistribution(a as GeneType, b as GeneType)).toEqual(expected);
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
  const positiveDominant: GeneSignSummary = { dominantSign: '+', recessiveSign: null };
  const positiveRecessive: GeneSignSummary = { dominantSign: null, recessiveSign: '+' };
  const negativeDominant: GeneSignSummary = { dominantSign: '-', recessiveSign: null };
  const bothPositive: GeneSignSummary = { dominantSign: '+', recessiveSign: '+' };
  const bothNegative: GeneSignSummary = { dominantSign: '-', recessiveSign: '-' };

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
  const negativeDominant: GeneSignSummary = { dominantSign: '-', recessiveSign: null };
  const negativeRecessive: GeneSignSummary = { dominantSign: null, recessiveSign: '-' };
  const positiveDominant: GeneSignSummary = { dominantSign: '+', recessiveSign: null };

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
  const gene: GeneSignSummary = { dominantSign: '+', recessiveSign: '-' };

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
  const recPositive: GeneSignSummary = { dominantSign: null, recessiveSign: '+' };
  const recNegative: GeneSignSummary = { dominantSign: null, recessiveSign: '-' };
  const domPositive: GeneSignSummary = { dominantSign: '+', recessiveSign: null };
  const bothPositive: GeneSignSummary = { dominantSign: '+', recessiveSign: '+' };

  const classify = (f: GeneType, m: GeneType, gene: GeneSignSummary | undefined) =>
    classifyTrioLocus(f, m, offspringDistribution(f, m), gene);

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

  it('locks in a dominant positive both parents express (x × D), attributed to both', () => {
    // Both already express +, and the offspring can be homozygous-dominant.
    const c = classify('x', 'D', domPositive);
    expect(c.verdict).toBe('gain');
    expect(c.lockedIn).toBe(true);
    expect(c.source).toBe('both');
  });

  it('locks in a dominant positive when both parents are homozygous-dominant (D × D)', () => {
    const c = classify('D', 'D', domPositive);
    expect(c.verdict).toBe('gain');
    expect(c.lockedIn).toBe(true);
    expect(c.source).toBe('both');
  });

  it('locks in a recessive positive both parents express (R × R)', () => {
    const c = classify('R', 'R', recPositive);
    expect(c.verdict).toBe('gain');
    expect(c.lockedIn).toBe(true);
    expect(c.source).toBe('both');
    expect(c.pPositive).toBe(1);
  });

  it('does not lock in when both positives come from different alleles with no consolidation (D × R)', () => {
    // Both parents express a `+` (father dominant, mother recessive), but the
    // offspring is all heterozygous — nothing is consolidated toward homozygosity.
    const c = classify('D', 'R', bothPositive);
    expect(c.verdict).toBe('neutral');
    expect(c.lockedIn).toBe(false);
  });

  it('still locks in a both-positive gene when the dominant allele can consolidate (D × x)', () => {
    const c = classify('D', 'x', bothPositive);
    expect(c.verdict).toBe('gain');
    expect(c.lockedIn).toBe(true);
    expect(c.source).toBe('both');
  });

  it('handles a carrier gene (recessive +, dominant -) like horse chromosome 1', () => {
    // The good trait shows only when homozygous-recessive; the dominant allele
    // expresses the harmful version.
    const carrier: GeneSignSummary = { dominantSign: '-', recessiveSign: '+' };

    // Carrier × carrier: both parents show the harmful dominant, but the cross
    // can surface the beneficial recessive (25%) neither parent expresses.
    const xx = classify('x', 'x', carrier);
    expect(xx.verdict).toBe('gain');
    expect(xx.source).toBe('both');
    expect(xx.lockedIn).toBe(false);
    expect(xx.pPositive).toBeCloseTo(0.25, 10);
    expect(xx.pNegative).toBeCloseTo(0.75, 10);

    // Both recessive: the beneficial trait is locked in (offspring guaranteed RR).
    const rr = classify('R', 'R', carrier);
    expect(rr.verdict).toBe('gain');
    expect(rr.lockedIn).toBe(true);

    // Both dominant / dominant×carrier: offspring still expresses the harmful
    // dominant the parents already show — nothing new.
    expect(classify('D', 'D', carrier).verdict).toBe('neutral');
    expect(classify('D', 'x', carrier).verdict).toBe('neutral');
  });

  it('returns neutral for an unknown parent and for a missing gene record', () => {
    expect(classify('?', 'D', domPositive).verdict).toBe('neutral');
    expect(classify('x', 'x', undefined).verdict).toBe('neutral');
    expect(classify('x', 'x', undefined).source).toBeNull();
  });
});

describe('offspringOutcomeBuckets', () => {
  const domPositive: GeneSignSummary = { dominantSign: '+', recessiveSign: null };
  const recPositive: GeneSignSummary = { dominantSign: null, recessiveSign: '+' };
  const recNegative: GeneSignSummary = { dominantSign: null, recessiveSign: '-' };
  const domNegative: GeneSignSummary = { dominantSign: '-', recessiveSign: null };
  const b = (f: GeneType, m: GeneType, gene: GeneSignSummary | undefined) =>
    offspringOutcomeBuckets(f, m, offspringDistribution(f, m), gene);

  it('splits a two mixed-positive parents cross into clarify / keep / loss (no new gain)', () => {
    // x × x, dominant +: both parents express + (mixed). Offspring D consolidates
    // to homozygous (clarification), x keeps it mixed, R drops the positive.
    expect(b('x', 'x', domPositive)).toEqual({
      newPositive: 0,
      clarifiedPositive: 0.25,
      keepPositive: 0.5,
      neutral: 0,
      keepNegative: 0,
      loss: 0.25,
      unknown: 0,
    });
  });

  it('flags a positive neither parent expresses as a new gain', () => {
    // x × x, recessive +: parents express the (neutral) dominant, so neither shows
    // the +. The 25% homozygous-recessive offspring is a brand-new positive.
    expect(b('x', 'x', recPositive)).toMatchObject({ newPositive: 0.25, neutral: 0.75, clarifiedPositive: 0 });
  });

  it('compares per allele, so a recessive positive is new even when parents show the (different) dominant positive', () => {
    // dominant + and recessive + target different attributes. x × x parents show
    // only the dominant one; the 25% homozygous-recessive offspring gains the
    // recessive positive neither parent expresses — a new gain, not a clarify.
    const bothPositive: GeneSignSummary = { dominantSign: '+', recessiveSign: '+' };
    expect(b('x', 'x', bothPositive)).toEqual({
      newPositive: 0.25,
      clarifiedPositive: 0.25,
      keepPositive: 0.5,
      neutral: 0,
      keepNegative: 0,
      loss: 0,
      unknown: 0,
    });
    // negative mirror: the recessive negative is a new loss, not a kept negative.
    const bothNegative: GeneSignSummary = { dominantSign: '-', recessiveSign: '-' };
    expect(b('x', 'x', bothNegative)).toMatchObject({ keepNegative: 0.75, loss: 0.25 });
  });

  it('does not call a homozygous outcome a clarification when nothing was mixed', () => {
    // D × D, dominant +: already homozygous in both parents → pure keep, fixed.
    expect(b('D', 'D', domPositive)).toEqual({
      newPositive: 0,
      clarifiedPositive: 0,
      keepPositive: 1,
      neutral: 0,
      keepNegative: 0,
      loss: 0,
      unknown: 0,
    });
  });

  it('flags a negative neither parent expresses as a loss, an existing one as keep-negative', () => {
    expect(b('x', 'x', recNegative)).toMatchObject({ loss: 0.25, neutral: 0.75 });
    // both parents express the dominant negative → the offspring only keeps it.
    expect(b('x', 'x', domNegative)).toMatchObject({ keepNegative: 0.75, neutral: 0.25, loss: 0 });
  });

  it('treats losing a parent-expressed positive as a loss', () => {
    // D(+dominant) × R: offspring all mixed x → still expresses +, kept, no loss.
    // R × x on a recessive-positive: the x offspring drops the recessive +.
    expect(b('R', 'x', recPositive)).toMatchObject({ loss: 0.5 });
  });

  it('routes all mass to unknown when a parent allele is unknowable', () => {
    expect(b('?', 'x', domPositive)).toEqual({
      newPositive: 0,
      clarifiedPositive: 0,
      keepPositive: 0,
      neutral: 0,
      keepNegative: 0,
      loss: 0,
      unknown: 1,
    });
  });

  it('treats a locus with no gene record as fully neutral', () => {
    expect(b('x', 'x', undefined)).toMatchObject({ neutral: 1 });
  });

  it('produces masses that sum to 1', () => {
    for (const f of ALL_TYPES) {
      for (const m of ALL_TYPES) {
        const out = b(f, m, domPositive);
        const sum = Object.values(out).reduce((s, v) => s + v, 0);
        expect(sum).toBeCloseTo(1, 10);
      }
    }
  });
});
