/**
 * Reactive state for the redesign Library (the unified pet list + filters that
 * replaces the Pets sidebar and the Stable filters). Module-scoped so it
 * survives tab switches, mirroring `stableView`.
 * See docs/design/redesign-library-workspace-v1.md.
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
  /** Multi-select for bulk actions / driving the Workspace. */
  selectedIds: new Set<number>() as Set<number>,
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
