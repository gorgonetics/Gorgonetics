/**
 * Reactive state for My Pets (the table-first home): the filters, roster sort,
 * and multi-selection. Module-scoped so it survives tab switches.
 * See docs/design/redesign-library-workspace-v1.md (§9, IA v2).
 */

import type { Gender } from '$lib/types/index.js';
import type { PetListFilters } from '$lib/utils/petFilter.js';

export const libraryView = $state({
  search: '',
  /** Normalized species; '' = all. */
  species: '' as string,
  /** Breed name; '' = all. */
  breed: '' as string,
  /** Exact gender; '' = all. */
  gender: '' as Gender | '',
  starredOnly: false,
  stabledOnly: false,
  petQualityOnly: false,
  tags: [] as string[],
  /** Roster (table) sort — column id + direction. */
  sortCol: 'name' as string,
  sortDir: 'asc' as 'asc' | 'desc',
  /** Multi-select for bulk actions (Compare / Share). */
  selectedIds: new Set<number>() as Set<number>,
  /** Cross-destination request to open a pet's detail in My Pets (e.g. clicking
   *  a parent in the Breed pair table). MyPets consumes and clears it. */
  openPetId: null as number | null,
});

/**
 * The active filter criteria as a plain `PetListFilters`. MyPets filters once
 * with these (`visiblePets`) and shares the result with the Roster via a prop,
 * so table rows and the bulk-action selection can never disagree (#405).
 * Call inside a reactive context ($derived) so the field reads are tracked.
 */
export function getLibraryFilters(): PetListFilters {
  return {
    query: libraryView.search,
    tags: libraryView.tags,
    starredOnly: libraryView.starredOnly,
    stabledOnly: libraryView.stabledOnly,
    petQualityOnly: libraryView.petQualityOnly,
    species: libraryView.species,
    breed: libraryView.breed,
    gender: libraryView.gender,
  };
}

/** Replace the selection set (reassign so $state tracks the change). */
export function setLibrarySelection(ids: Set<number>): void {
  libraryView.selectedIds = ids;
}

export function toggleLibrarySelection(id: number): void {
  const next = new Set(libraryView.selectedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  libraryView.selectedIds = next;
}

export function clearLibrarySelection(): void {
  libraryView.selectedIds = new Set();
}

/** Ask My Pets to open a pet's detail (used from other destinations). */
export function requestOpenPet(id: number): void {
  libraryView.openPetId = id;
}
