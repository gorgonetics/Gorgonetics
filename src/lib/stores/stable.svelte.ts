/**
 * Reactive state for the Stable Table view. Lives at module scope so that
 * species selection, sort column, and sort direction survive tab switches —
 * the StableTable component is unmounted when the user navigates away, but
 * this state persists for the session.
 */

import { getSupportedSpecies } from '$lib/services/configService.js';

export type GenderFilter = 'all' | 'Male' | 'Female';

export const stableView = $state({
  species: getSupportedSpecies()[0],
  sortCol: 'name',
  sortDir: 'asc' as 'asc' | 'desc',
  search: '',
  gender: 'all' as GenderFilter,
  breed: 'all' as string,
  starredOnly: false,
  petQualityOnly: false,
  tags: [] as string[],
});
