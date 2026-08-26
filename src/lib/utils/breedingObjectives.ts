/**
 * The strategies a breeder can pick between, and the selector each one
 * sorts by.
 *
 * **Why this is a registry rather than a score.** Every attempt to reduce
 * pairing choice to one number failed against a case a player could name,
 * and each failure was measured rather than argued (design doc §10a):
 *
 *  - Absolute positive count ranks the two best animals together at the
 *    top, and the foal regresses to the mean — the local maximum, visible
 *    in the data.
 *  - Improvement over the better parent fixes that but hides the ~48% of
 *    pairings that cannot beat the better parent yet can replace the weaker.
 *  - Improvement over the weaker parent surfaces those but correlates 0.75
 *    with the gap between the parents, so it ranks "best × worst" first.
 *  - Any positive-side measure hides a pairing made purely to drop a
 *    negative.
 *  - Any aggregate measure hides a pairing made to lift one lagging trait.
 *
 * These are not approximations of a single true objective. They are
 * different goals that genuinely conflict, and which one is right changes
 * from one breeding round to the next. So the app offers them and the
 * player chooses; it does not average them into a house strategy.
 *
 * Pure: selectors read an already-scored `BreedingPairResult`. Ranking is
 * `rankBreedingPairs`' job, planning is `suggestPlans`', and both take the
 * selector as a parameter.
 */

import type { BreedingPairResult } from '$lib/types/index.js';

/** A named breeding strategy: what to optimise, and how to explain it. */
export interface BreedingObjective {
  /** Stable key — persisted in settings, so do not rename. */
  id: string;
  /** Picker label. */
  label: string;
  /** One line saying what this strategy is for, shown beside the picker. */
  description: string;
  /** Higher is better. Passed straight to `suggestPlans` as its `score`. */
  score: (pair: BreedingPairResult) => number;
}

/**
 * The five general strategies. Deliberately not ordered by quality — the
 * first is a reasonable default, not a recommendation, and the rest are
 * peers rather than fallbacks.
 */
export const BREEDING_OBJECTIVES: readonly BreedingObjective[] = Object.freeze([
  {
    id: 'reach',
    label: 'Reach new ground',
    description: 'Foals that put an outcome in reach the stable cannot currently breed at all.',
    score: (p) => p.evCapabilityGain,
  },
  {
    id: 'ceiling',
    label: 'Raise the ceiling',
    description: 'Foals likely to beat the better parent, pushing the best line forward.',
    score: (p) => p.evPositiveImprovement,
  },
  {
    id: 'floor',
    label: 'Raise the floor',
    description: 'Foals that can replace the weaker parent, giving a stronger pair next round.',
    score: (p) => p.evPairUpgrade,
  },
  {
    id: 'clean',
    label: 'Clean the line',
    description: 'Foals carrying fewer negative effects than the cleaner parent.',
    score: (p) => p.evLiabilityReduction,
  },
  {
    id: 'positives',
    label: 'Most positive genes',
    description:
      'Highest expected positive count outright. Note this favours pairing your two best animals, whose foals often regress — prefer "Raise the ceiling" unless you specifically want the level.',
    score: (p) => p.evPositiveTotal,
  },
]);

/** Objective ids, for validating a persisted setting. */
export const BREEDING_OBJECTIVE_IDS: readonly string[] = Object.freeze(BREEDING_OBJECTIVES.map((o) => o.id));

/** The default when nothing is chosen: reach, being the only one no other metric can express. */
export const DEFAULT_BREEDING_OBJECTIVE = 'reach';

/**
 * A strategy targeting one attribute — "Intelligence is lagging, lift it".
 *
 * Scores expected improvement on that attribute against the better parent
 * *on that attribute*, not its absolute expected value: a pairing can lead
 * the field on a trait while being unable to improve on either parent's, so
 * the absolute figure reproduces the local-maximum trap per attribute.
 *
 * `attribute` must be the capitalised key `rankBreedingPairs` produces
 * (`Intelligence`, not `intelligence`).
 */
export function attributeObjective(attribute: string): BreedingObjective {
  return {
    id: `attribute:${attribute}`,
    label: `Improve ${attribute}`,
    description: `Foals likely to beat both parents on ${attribute}.`,
    score: (p) => p.evAttributeImprovement[attribute] ?? 0,
  };
}

/**
 * Parse an objective id back to its objective; `null` if unknown.
 *
 * `attributes` bounds the per-attribute strategies to the ones the current
 * species actually has. The selection persists across species switches, so
 * without it "Improve Temperament" survives a switch to a species with no
 * Temperament and yields an objective scoring 0 for every pair — an
 * arbitrary ranking, and a `<select>` whose value matches no option. Omit it
 * only where no species context exists.
 */
export function resolveObjective(id: string, attributes?: readonly string[]): BreedingObjective | null {
  const attributeMatch = id.match(/^attribute:(.+)$/);
  if (attributeMatch) {
    const attribute = attributeMatch[1];
    if (attributes && !attributes.includes(attribute)) return null;
    return attributeObjective(attribute);
  }
  return BREEDING_OBJECTIVES.find((o) => o.id === id) ?? null;
}
