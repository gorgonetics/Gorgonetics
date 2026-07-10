/**
 * Groups a ranked list of breeding pairs into batches sized to the player's
 * available breeding spots.
 *
 * A batch is a set of pairs that can breed at the same time, so no animal may
 * appear twice *within the whole plan* — each male and each female is committed
 * to at most one pair. The selection is a greedy pass over the ranking the
 * caller already produced: walk top-to-bottom, take each pair whose parents are
 * both still free, skip any that would reuse a committed animal. This honours
 * whatever column the player sorted by (WYSIWYG — the plan is "the best pairs
 * you can see, minus reuses") at the cost of the exact max-total-score a
 * Hungarian matching would give; the transparency is the point.
 *
 * The resulting disjoint matching is then chunked into groups of `spots`:
 * batch 1 is the "breed now" set, batch 2 the next round once those animals
 * free up, and so on.
 */

import type { BreedingPairResult } from '$lib/types/index.js';

/**
 * Build a breeding plan from `ranked` (already in the player's chosen order) and
 * the number of simultaneous `spots`. Returns the disjoint pair batches, best
 * first: `batches[0]` is the "breed now" set. `spots <= 0` returns [] — callers
 * treat that as "planning off" and render the flat ranking instead.
 */
export function buildBatches(ranked: readonly BreedingPairResult[], spots: number): BreedingPairResult[][] {
  const size = Math.floor(spots);
  if (size <= 0) return [];

  const usedMales = new Set<number>();
  const usedFemales = new Set<number>();
  const matching: BreedingPairResult[] = [];

  for (const pair of ranked) {
    if (usedMales.has(pair.male.id) || usedFemales.has(pair.female.id)) continue;
    matching.push(pair);
    usedMales.add(pair.male.id);
    usedFemales.add(pair.female.id);
  }

  const batches: BreedingPairResult[][] = [];
  for (let i = 0; i < matching.length; i += size) {
    batches.push(matching.slice(i, i + size));
  }
  return batches;
}
