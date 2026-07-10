import { describe, expect, it } from 'vitest';
import type { BreedingPairResult, Pet } from '$lib/types/index.js';
import { suggestPlans } from '$lib/utils/breedingPlan.js';

const pet = (id: number, gender: 'Male' | 'Female'): Pet =>
  ({ id, name: `P${id}`, gender, species: 'Horse', breed: '', tags: [], stabled: true }) as unknown as Pet;

// `weighted` is the default plan objective (pool gain).
const pair = (maleId: number, femaleId: number, weighted: number): BreedingPairResult => ({
  male: pet(maleId, 'Male'),
  female: pet(femaleId, 'Female'),
  evMixed: 0,
  evPositiveByAttribute: {},
  evPositiveTotal: 0,
  evPositiveWeighted: weighted,
  evUnknown: 0,
  totalLoci: 0,
});

const key = (p: SuggestedPlanPair) => `${p.male.id}x${p.female.id}`;
type SuggestedPlanPair = BreedingPairResult;

describe('suggestPlans', () => {
  it('returns nothing when slots <= 0 or there are no pairs', () => {
    expect(suggestPlans({ ranked: [pair(1, 2, 5)], slots: 0 })).toEqual([]);
    expect(suggestPlans({ ranked: [], slots: 3 })).toEqual([]);
  });

  it('option 1 is the globally greedy best plan, each plan internally disjoint', () => {
    const ranked = [pair(1, 2, 10), pair(3, 4, 9), pair(1, 4, 8), pair(5, 6, 7)];
    const plans = suggestPlans({ ranked, slots: 2 });
    expect(plans[0].pairs.map(key)).toEqual(['1x2', '3x4']);
    expect(plans[0].total).toBe(19);
    for (const plan of plans) {
      const males = plan.pairs.map((p) => p.male.id);
      const females = plan.pairs.map((p) => p.female.id);
      expect(new Set(males).size).toBe(males.length);
      expect(new Set(females).size).toBe(females.length);
      expect(plan.pairs.length).toBeLessThanOrEqual(2);
    }
  });

  it('surfaces distinct alternatives led by different pairings', () => {
    const ranked = [pair(1, 2, 10), pair(3, 4, 9), pair(1, 4, 8), pair(3, 2, 6)];
    const plans = suggestPlans({ ranked, slots: 2 });
    const signatures = plans.map((pl) => pl.pairs.map(key).sort().join('|'));
    // No two plans are identical.
    expect(new Set(signatures).size).toBe(signatures.length);
    expect(plans.length).toBeGreaterThan(1);
  });

  it('ranks plans by total score, best first', () => {
    const ranked = [pair(1, 2, 10), pair(3, 4, 9), pair(1, 4, 3), pair(3, 2, 2)];
    const plans = suggestPlans({ ranked, slots: 2 });
    for (let i = 1; i < plans.length; i++) {
      expect(plans[i - 1].total).toBeGreaterThanOrEqual(plans[i].total);
    }
  });

  it('honours a custom score objective', () => {
    const ranked = [pair(1, 2, 1), pair(3, 4, 100)];
    // Score by evPositiveTotal instead (all zero here) → totals collapse to 0.
    const plans = suggestPlans({ ranked, slots: 2, score: (p) => p.evPositiveTotal });
    expect(plans[0].total).toBe(0);
  });

  it('caps the number of plans returned', () => {
    const ranked = Array.from({ length: 10 }, (_, i) => pair(i * 2 + 1, i * 2 + 2, 10 - i));
    const plans = suggestPlans({ ranked, slots: 2, maxPlans: 3 });
    expect(plans.length).toBeLessThanOrEqual(3);
  });

  it('best-effort fills when slots exceed the maximum matching', () => {
    // Only one male → at most one pair per plan.
    const ranked = [pair(1, 2, 5), pair(1, 3, 4)];
    const plans = suggestPlans({ ranked, slots: 3 });
    for (const plan of plans) expect(plan.pairs.length).toBe(1);
  });
});
