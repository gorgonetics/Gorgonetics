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
   * Pair-table scroll offsets, saved by BreedingPairTable so the ranking
   * position survives destination switches (the component unmounts).
   * Reset on a species change — an offset from one species' table is
   * meaningless in another's.
   */
  scrollTop: 0,
  scrollLeft: 0,
});
