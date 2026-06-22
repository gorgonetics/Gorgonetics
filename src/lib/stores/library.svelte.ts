/**
 * Reactive state for My Pets (the table-first home): the filters, roster sort,
 * and multi-selection. Module-scoped so it survives tab switches.
 * See docs/design/redesign-library-workspace-v1.md (§9, IA v2).
 */

export type LibraryDensity = 'card' | 'table';

export const libraryView = $state({
  search: '',
  /** Normalized species; '' = all. */
  species: '' as string,
  /** Breed name; '' = all. */
  breed: '' as string,
  starredOnly: false,
  stabledOnly: false,
  petQualityOnly: false,
  tags: [] as string[],
  density: 'card' as LibraryDensity,
  /** Roster (table) sort — column id + direction. */
  sortCol: 'name' as string,
  sortDir: 'asc' as 'asc' | 'desc',
  /** Multi-select for bulk actions (Compare / Share). */
  selectedIds: new Set<number>() as Set<number>,
  /** Cross-destination request to open a pet's detail in My Pets (e.g. clicking
   *  a parent in the Breed pair table). MyPets consumes and clears it. */
  openPetId: null as number | null,
});

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
