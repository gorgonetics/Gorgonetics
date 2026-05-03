/**
 * Reactive state for the Breeding Assistant view.
 *
 * Lives at module scope so the offspring-breed pick and the sort column
 * survive tab switches — the tab's components are unmounted when the
 * user navigates away, but this state persists for the session.
 *
 * The PR-3 placeholder doesn't yet read these fields; PR 4 (the ranking
 * UI) is where they get wired into the breed selector and sortable
 * column headers. They are defined now so the surface is stable across
 * the remaining PRs.
 */

import { getSupportedSpecies } from '$lib/services/configService.js';

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
  /** Canonical species the player is breeding within (defaults to first supported). */
  species: getSupportedSpecies()[0],
  /** Player-selected offspring breed (horse-only; '' = no filter / mixed). */
  offspringBreed: '' as string,
  /** Active sort column for the pair table. */
  sortCol: 'evPositiveTotal' as BreedingSortColumn,
  /** Sort direction. Most useful columns are descending by default. */
  sortDir: 'desc' as 'asc' | 'desc',
});
