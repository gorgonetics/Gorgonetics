import { describe, expect, it } from 'vitest';
import { GeneType } from '$lib/types/index.js';
import {
  alleleCarriers,
  alleleFrequency,
  computeLocusFrequencies,
  isMeasurable,
  type LocusTally,
  RARITY_BUCKET_NEVER,
  RARITY_BUCKET_SOLE,
  RARITY_LEVELS,
  rarityBucket,
} from '$lib/utils/geneFrequency.js';
import type { PetLoci } from '$lib/utils/petLoci.js';

const D = GeneType.DOMINANT;
const R = GeneType.RECESSIVE;
const X = GeneType.MIXED;
const Q = GeneType.UNKNOWN;

/** Build a population where every pet has the same single locus `01A1`. */
function popAt(types: GeneType[], geneId = '01A1'): PetLoci[] {
  return types.map((t) => new Map([[geneId, t]]) as PetLoci);
}

/** Shorthand for a hand-written tally. */
function tally(knownPets: number, pureD: number, pureR: number, mixed: number): LocusTally {
  return { knownPets, pureD, pureR, mixed };
}

describe('computeLocusFrequencies — allele counting', () => {
  it('counts D as two dominant alleles, R as two recessive, x as one of each', () => {
    const t = computeLocusFrequencies(popAt([D, R, X])).get('01A1');
    expect(t).toEqual({ knownPets: 3, pureD: 1, pureR: 1, mixed: 1 });
    // D contributes 2, x contributes 1 → 3 of 6
    expect(alleleFrequency(t as LocusTally, D)).toBeCloseTo(0.5, 10);
    expect(alleleFrequency(t as LocusTally, R)).toBeCloseTo(0.5, 10);
  });

  it('excludes ? from the numerator AND the denominator', () => {
    const t = computeLocusFrequencies(popAt([D, D, Q, Q, Q])).get('01A1') as LocusTally;
    expect(t.knownPets).toBe(2);
    expect(alleleFrequency(t, D)).toBe(1);
  });

  it('drops a locus entirely when every reading is ?', () => {
    expect(computeLocusFrequencies(popAt([Q, Q, Q])).has('01A1')).toBe(false);
  });

  it('does not synthesise readings for loci a pet lacks', () => {
    const pets: PetLoci[] = [
      new Map([
        ['01A1', D],
        ['01A2', R],
      ]) as PetLoci,
      new Map([['01A1', R]]) as PetLoci,
    ];
    const out = computeLocusFrequencies(pets);
    expect(out.get('01A1')?.knownPets).toBe(2);
    expect(out.get('01A2')?.knownPets).toBe(1);
  });
});

describe('the confound genotype counting introduced', () => {
  // Both cases come straight from the design doc: counting D/R/x as three
  // peer values misreads these in opposite directions.
  it('20 mixed + 2 dominant: the recessive allele is common, not absent', () => {
    const t = computeLocusFrequencies(popAt([...Array(20).fill(X), D, D])).get('01A1') as LocusTally;
    // genotype counting would say R = 0% ("does not exist"); it is in 20 pets
    expect(alleleFrequency(t, R)).toBeCloseTo(20 / 44, 4);
    expect(alleleCarriers(t, R)).toBe(20);
    expect(rarityBucket(t, R)).toBe(0);
  });

  it('1 mixed + 21 dominant: the sole carrier is the loud cell', () => {
    const t = computeLocusFrequencies(popAt([X, ...Array(21).fill(D)])).get('01A1') as LocusTally;
    expect(alleleFrequency(t, R)).toBeCloseTo(1 / 44, 4);
    expect(alleleCarriers(t, R)).toBe(1);
    expect(rarityBucket(t, R)).toBe(RARITY_BUCKET_SOLE);
  });
});

describe('complementarity', () => {
  it('p_D + p_R === 1 over random populations', () => {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let trial = 0; trial < 200; trial++) {
      const n = 1 + Math.floor(rand() * 40);
      const types = Array.from({ length: n }, () => {
        const r = rand();
        return r < 0.3 ? D : r < 0.6 ? R : r < 0.9 ? X : Q;
      });
      const t = computeLocusFrequencies(popAt(types)).get('01A1');
      if (!t) continue;
      expect(alleleFrequency(t, D) + alleleFrequency(t, R)).toBeCloseTo(1, 10);
    }
  });

  it('at most one allele at a locus can sit below 50%', () => {
    const t = computeLocusFrequencies(popAt([D, D, D, X, R])).get('01A1') as LocusTally;
    const below = [D, R].filter((a) => alleleFrequency(t, a) < 0.5);
    expect(below.length).toBeLessThanOrEqual(1);
  });
});

describe('minimum sample', () => {
  it('gates the degenerate case at 4 alleles (2 pets)', () => {
    expect(isMeasurable(tally(1, 1, 0, 0))).toBe(false);
    expect(isMeasurable(tally(2, 1, 1, 0))).toBe(true);
    expect(rarityBucket(tally(1, 1, 0, 0), D)).toBeNull();
  });

  it('is expressed in alleles, so the option is an allele count', () => {
    expect(isMeasurable(tally(2, 2, 0, 0), { minKnownAlleles: 6 })).toBe(false);
    expect(isMeasurable(tally(3, 3, 0, 0), { minKnownAlleles: 6 })).toBe(true);
  });
});

describe('rarityBucket — frequency bands', () => {
  it.each([
    [0.5, 0],
    [0.35, 0],
    [0.349, 1],
    [0.18, 1],
    [0.179, 2],
    [0.07, 2],
    [0.069, 3],
    [0.01, 3],
  ])('frequency %f lands in bucket %i', (freq, expected) => {
    // Build a tally with the wanted dominant frequency and >1 carrier so the
    // sole-carrier override cannot fire. (Push the frequency low enough at this
    // sample size and it rounds to a single carrier, which correctly lands in
    // bucket 4 instead — covered separately below.)
    const knownPets = 1000;
    const pureD = Math.round(freq * knownPets);
    const t = tally(knownPets, pureD, knownPets - pureD, 0);
    expect(rarityBucket(t, D)).toBe(expected);
  });

  it('is monotonic in frequency once carriers are held above 1', () => {
    const buckets = [0.6, 0.4, 0.3, 0.15, 0.1, 0.05, 0.01].map((freq) => {
      const pureD = Math.round(freq * 1000);
      return rarityBucket(tally(1000, pureD, 1000 - pureD, 0), D) as number;
    });
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i]).toBeGreaterThanOrEqual(buckets[i - 1]);
    }
  });
});

describe('rarityBucket — the sole-carrier step', () => {
  /** One mixed carrier of R among `n - 1` pure-D pets. */
  const soleCarrier = (n: number) => tally(n, n - 1, 0, 1);

  it('fires at every baseline size at or above the gate', () => {
    for (const n of [10, 20, 40]) {
      expect(rarityBucket(soleCarrier(n), R)).toBe(RARITY_BUCKET_SOLE);
    }
  });

  it('does not fire below the gate — it would get louder as the baseline shrinks', () => {
    for (const n of [3, 5, 9]) {
      expect(rarityBucket(soleCarrier(n), R)).not.toBe(RARITY_BUCKET_SOLE);
    }
  });

  it('falls back to the frequency bucket below the gate, never to missing data', () => {
    expect(rarityBucket(soleCarrier(5), R)).toBe(2); // 1/10 = 0.10 → notable
  });

  it('is unreachable as a frequency floor, which is why it counts carriers', () => {
    // The rejected `< 0.02` rule: a sole mixed carrier sits at 1/(2N), so it
    // only clears 0.02 above 25 pets — silently absent for most players.
    expect(1 / (2 * 10)).toBeGreaterThan(0.02);
    expect(1 / (2 * 20)).toBeGreaterThan(0.02);
    expect(1 / (2 * 40)).toBeLessThan(0.02);
  });

  it('ranks a pure and a mixed sole carrier together', () => {
    const pure = tally(20, 19, 1, 0); // one pure-R pet: 2 copies
    const mixed = tally(20, 19, 0, 1); // one mixed pet: 1 copy
    expect(alleleCarriers(pure, R)).toBe(1);
    expect(alleleCarriers(mixed, R)).toBe(1);
    expect(rarityBucket(pure, R)).toBe(rarityBucket(mixed, R));
    // ...even though by frequency alone the pure carrier reads as less rare
    expect(alleleFrequency(pure, R)).toBeGreaterThan(alleleFrequency(mixed, R));
  });

  it('fires symmetrically on the dominant arm', () => {
    expect(rarityBucket(tally(20, 1, 19, 0), D)).toBe(RARITY_BUCKET_SOLE);
  });

  it('deliberately breaks monotonicity in frequency', () => {
    const sole = tally(20, 19, 1, 0); // R at 2/40 = 0.05, one carrier → bucket 4
    const commoner = tally(1000, 970, 30, 0); // R at 0.03, many carriers → bucket 3
    expect(alleleFrequency(sole, R)).toBeGreaterThan(alleleFrequency(commoner, R));
    expect(rarityBucket(sole, R)).toBeGreaterThan(rarityBucket(commoner, R) as number);
  });
});

/**
 * Monomorphic loci — the never-seen step.
 *
 * These used to render at the neutral centre on the argument that a settled
 * locus has nothing to act on. That holds only if your own stock is the whole
 * world; wild pets carry alleles nobody local has, so "never seen" is the most
 * actionable reading before a capture, and it now takes the top step.
 */
describe('monomorphic loci', () => {
  it('leaves the absent allele at frequency 0 with no carriers', () => {
    const t = computeLocusFrequencies(popAt([D, D, D, D])).get('01A1') as LocusTally;
    expect(alleleFrequency(t, R)).toBe(0);
    expect(alleleCarriers(t, R)).toBe(0);
  });

  it('ranks an allele nobody carries above a sole carrier', () => {
    const never = tally(30, 30, 0, 0);
    const sole = tally(30, 29, 0, 1);
    expect(rarityBucket(never, R)).toBe(RARITY_BUCKET_NEVER);
    expect(rarityBucket(sole, R)).toBe(RARITY_BUCKET_SOLE);
    expect(rarityBucket(never, R)).toBeGreaterThan(rarityBucket(sole, R) as number);
  });

  it('is the top of the scale, so no bucket sits beyond it', () => {
    expect(RARITY_BUCKET_NEVER).toBe(RARITY_LEVELS - 1);
  });

  it('fires symmetrically on the dominant arm', () => {
    expect(rarityBucket(tally(30, 0, 30, 0), D)).toBe(RARITY_BUCKET_NEVER);
  });

  it('is gated like the sole-carrier step — "nobody has it" is trivial at N=3', () => {
    // Ungated this gets louder as the baseline shrinks, which is the mirror of
    // the problem the gate exists to fix: with three pets most loci are
    // monomorphic, so the loudest colour would carpet the map.
    for (const n of [10, 20, 40]) {
      expect(rarityBucket(tally(n, n, 0, 0), R)).toBe(RARITY_BUCKET_NEVER);
    }
    for (const n of [2, 3, 5, 9]) {
      expect(rarityBucket(tally(n, n, 0, 0), R)).not.toBe(RARITY_BUCKET_NEVER);
    }
  });

  it('falls back to the neutral centre below the gate, not to missing data', () => {
    // Below the gate the locus is still measured — it just makes no claim about
    // scarcity, and neutral is the honest reading for "no evidence either way".
    expect(rarityBucket(tally(5, 5, 0, 0), R)).toBe(0);
    expect(rarityBucket(tally(5, 5, 0, 0), R)).not.toBeNull();
  });

  it('stays below minKnown as missing data rather than never-seen', () => {
    // One pet, 2 known alleles: under the 4-allele floor, so the locus is not
    // scored at all. "Never seen" would be a claim the sample cannot support.
    expect(rarityBucket(tally(1, 1, 0, 0), R)).toBeNull();
  });

  it('is unreachable for the allele a pet actually carries', () => {
    // The per-pet lens only consults the arms its cell holds, and the pet is in
    // its own denominator — so its own allele always has at least one carrier.
    const withPet = computeLocusFrequencies(popAt([X, D, D, D, D, D, D, D, D, D])).get('01A1') as LocusTally;
    expect(alleleCarriers(withPet, R)).toBe(1);
    expect(rarityBucket(withPet, R)).toBe(RARITY_BUCKET_SOLE);
  });
});
