/**
 * Suggests several complete breeding plans for a given number of slots.
 *
 * A plan is a set of `slots` pairs you can breed at the same time, so no animal
 * appears twice within a plan. Plans are *alternatives*, not consecutive rounds:
 * different plans may reuse the same animal because you'll only ever pick one.
 *
 * To surface genuinely different options rather than near-identical permutations,
 * each candidate plan is seeded by forcing a distinct strong pairing as its lead
 * and greedily completing the rest from the ranking. Dedup collapses seeds that
 * complete to the same set; the survivors are ranked by total score, best first.
 * Option 1 is therefore the globally greedy best plan (its lead is the top pair).
 */

import type { BreedingPairResult } from '$lib/types/index.js';

export interface SuggestedPlan {
  /** The plan's pairs, strongest first. Length is `min(slots, max matching)`. */
  pairs: BreedingPairResult[];
  /** Sum of `score` across the plan's pairs — what plans are ranked by. */
  total: number;
}

export interface SuggestPlansOptions {
  /** Pairs to draw from — need NOT be pre-sorted; sorted internally by `score`. */
  ranked: readonly BreedingPairResult[];
  /** Slots to fill. `<= 0` returns []. */
  slots: number;
  /** Per-pair objective; plans maximise its sum. Defaults to pool gain. */
  score?: (p: BreedingPairResult) => number;
  /** Cap on plans returned (default 5). */
  maxPlans?: number;
  /** Cap on distinct lead pairings tried (default 30) — bounds cost. */
  maxLeads?: number;
}

const planKey = (pairs: readonly BreedingPairResult[]): string =>
  pairs
    .map((p) => `${p.male.id}x${p.female.id}`)
    .sort()
    .join('|');

export function suggestPlans(opts: SuggestPlansOptions): SuggestedPlan[] {
  const size = Math.floor(opts.slots);
  if (size <= 0 || opts.ranked.length === 0) return [];
  const score = opts.score ?? ((p: BreedingPairResult) => p.evPositiveWeighted);
  const maxPlans = opts.maxPlans ?? 5;
  const maxLeads = opts.maxLeads ?? 30;

  // Strongest first: greedy completion picks the best available pair, and the
  // top pairs are the lead seeds.
  const ranked = [...opts.ranked].sort((a, b) => score(b) - score(a));

  const complete = (lead: BreedingPairResult): BreedingPairResult[] => {
    const usedM = new Set<number>([lead.male.id]);
    const usedF = new Set<number>([lead.female.id]);
    const pairs = [lead];
    for (const p of ranked) {
      if (pairs.length === size) break;
      if (usedM.has(p.male.id) || usedF.has(p.female.id)) continue;
      pairs.push(p);
      usedM.add(p.male.id);
      usedF.add(p.female.id);
    }
    return pairs.sort((a, b) => score(b) - score(a));
  };

  const seen = new Set<string>();
  const plans: SuggestedPlan[] = [];
  const leadCap = Math.min(ranked.length, maxLeads);
  for (let i = 0; i < leadCap; i++) {
    const pairs = complete(ranked[i]);
    const key = planKey(pairs);
    if (seen.has(key)) continue;
    seen.add(key);
    plans.push({ pairs, total: pairs.reduce((s, p) => s + score(p), 0) });
  }

  plans.sort((a, b) => b.total - a.total);
  return plans.slice(0, maxPlans);
}
