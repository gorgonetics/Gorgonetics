/**
 * Reactive state for the Breeding Assistant view.
 *
 * Lives at module scope so the offspring-breed pick and the sort column
 * survive tab switches — the tab's components are unmounted when the
 * user navigates away, but this state persists for the session.
 */

import type { Pet } from '$lib/types/index.js';

/** The (father, mother) pair currently open in the trio detail view. */
export interface SelectedBreedingPair {
  male: Pet;
  female: Pet;
}

/**
 * Sort columns the breeding pair table will support in PR 4. The
 * `(string & {})` tail is load-bearing — per-attribute columns
 * (Toughness, Intelligence, …) are surfaced dynamically per species,
 * so the union can't be closed. The branded-string trick stops TS from
 * collapsing the literals into a bare `string` so autocomplete still
 * surfaces the well-known column names.
 */
export type BreedingSortColumn = 'evMixed' | 'evPositiveTotal' | 'evUnknown' | (string & {});

export const breedingView = $state({
  /**
   * Normalized species key the player is breeding within. '' means "not
   * chosen yet" — BreedView then derives a default (the most-populated
   * stabled species) instead of the alphabetical first. Set on an explicit
   * species click so the choice survives destination switches (e.g. a
   * parent-name excursion to My Pets and back).
   */
  species: '' as string,
  /** Player-selected offspring breed (horse-only; '' = no filter / mixed). */
  offspringBreed: '' as string,
  /** Active sort column for the pair table. */
  sortCol: 'evPositiveTotal' as BreedingSortColumn,
  /** Sort direction. Most useful columns are descending by default. */
  sortDir: 'desc' as 'asc' | 'desc',
  /** Pair open in the trio detail view; null when the view is closed. */
  selectedPair: null as SelectedBreedingPair | null,
  /**
   * Animals benched from the candidate pool — typically because they are
   * already breeding elsewhere. Benched pets are dropped before ranking, so
   * every pair involving them disappears. Session-scoped by design: real
   * breeding spans days, but the tool re-derives the pool from your stable
   * each launch rather than persisting a flag that would drift out of sync
   * with the game. Keyed by pet id so it survives species switches.
   */
  benchedIds: new Set<number>() as Set<number>,
  /**
   * Available simultaneous breeding spots. 0 = planning off (the flat
   * ranking). N > 0 groups the ranking into batches of N pairs with no
   * animal reused within the plan (see `buildBatches`). Global, not
   * per-species — it describes your stable, not the current breed.
   */
  spots: 0,
  /**
   * Pair-table scroll offsets, saved by BreedingPairTable so the ranking
   * position survives destination switches (the component unmounts).
   * Reset on a species change — an offset from one species' table is
   * meaningless in another's.
   */
  scrollTop: 0,
  scrollLeft: 0,
});

/**
 * Toggle an animal's benched state. Reassigns the Set so `$state` tracks the
 * change (mutating in place wouldn't re-run derived candidate filters), matching
 * `toggleMyPetsSelection`.
 */
export function toggleBench(id: number): void {
  const next = new Set(breedingView.benchedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  breedingView.benchedIds = next;
}

/**
 * Un-bench animals. With `ids`, only those return to the pool — callers pass the
 * current species' pool so a "Return all" in one species' panel can't silently
 * un-bench animals of another (benchedIds spans every species). Without `ids`,
 * clears the whole set.
 */
export function clearBench(ids?: Iterable<number>): void {
  if (breedingView.benchedIds.size === 0) return;
  if (ids === undefined) {
    breedingView.benchedIds = new Set();
    return;
  }
  const next = new Set(breedingView.benchedIds);
  let changed = false;
  for (const id of ids) {
    if (next.delete(id)) changed = true;
  }
  if (changed) breedingView.benchedIds = next;
}
