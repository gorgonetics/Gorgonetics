import { describe, expect, it } from 'vitest';
import type { BreedingPairResult, Pet } from '$lib/types/index.js';
import { buildBatches } from '$lib/utils/breedingPlan.js';

const pet = (id: number, gender: 'Male' | 'Female'): Pet =>
  ({ id, name: `P${id}`, gender, species: 'Horse', breed: '', tags: [], stabled: true }) as unknown as Pet;

const pair = (maleId: number, femaleId: number): BreedingPairResult => ({
  male: pet(maleId, 'Male'),
  female: pet(femaleId, 'Female'),
  evMixed: 0,
  evPositiveByAttribute: {},
  evPositiveTotal: 0,
  evPositiveWeighted: 0,
  evUnknown: 0,
  totalLoci: 0,
});

describe('buildBatches', () => {
  it('returns no batches when spots <= 0', () => {
    expect(buildBatches([pair(1, 2)], 0)).toEqual([]);
  });

  it('takes the top-ranked disjoint pairs, skipping any that reuse an animal', () => {
    // Ranked best-first. Male 1 and female 2 are reused by lower pairs, which
    // must be skipped so the plan stays disjoint.
    const ranked = [pair(1, 2), pair(1, 3), pair(4, 2), pair(5, 6)];
    const batches = buildBatches(ranked, 4);
    expect(batches).toHaveLength(1);
    expect(batches[0].map((p) => [p.male.id, p.female.id])).toEqual([
      [1, 2],
      [5, 6],
    ]);
  });

  it('chunks the disjoint matching into groups of `spots`, best first', () => {
    const ranked = [pair(1, 10), pair(2, 20), pair(3, 30), pair(4, 40), pair(5, 50)];
    const batches = buildBatches(ranked, 2);
    expect(batches.map((b) => b.length)).toEqual([2, 2, 1]);
    expect(batches[0].map((p) => p.male.id)).toEqual([1, 2]);
    expect(batches[2].map((p) => p.male.id)).toEqual([5]);
  });

  it('does not reuse an animal across batches (global disjointness)', () => {
    const ranked = [pair(1, 10), pair(2, 20), pair(1, 30), pair(3, 20)];
    const flat = buildBatches(ranked, 1).flat();
    const males = flat.map((p) => p.male.id);
    const females = flat.map((p) => p.female.id);
    expect(new Set(males).size).toBe(males.length);
    expect(new Set(females).size).toBe(females.length);
  });

  it('preserves the ranked order within the plan', () => {
    const ranked = [pair(3, 30), pair(1, 10), pair(2, 20)];
    const batches = buildBatches(ranked, 5);
    expect(batches[0].map((p) => p.male.id)).toEqual([3, 1, 2]);
  });

  it('floors fractional spot counts', () => {
    const ranked = [pair(1, 10), pair(2, 20), pair(3, 30)];
    const batches = buildBatches(ranked, 2.9);
    expect(batches.map((b) => b.length)).toEqual([2, 1]);
  });
});
