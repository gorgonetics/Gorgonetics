<script lang="ts">
/**
 * Roster — the Library's full attribute table, shown in the Workspace when no
 * pet is selected. Absorbs the old Stable tab: a sortable matrix of the
 * filtered pets with Name / Gender / Breed / per-species attributes / Total /
 * +Genes, driven by `libraryView` (filters + sort + multi-select). Clicking a
 * name opens that pet; checkboxes build a multi-selection for the lenses.
 * See docs/design/redesign-library-workspace-v1.md (§2.1).
 */
import { getAllAttributeNames, getAllAttributes } from '$lib/services/configService.js';
import { libraryView, setLibrarySelection, toggleLibrarySelection } from '$lib/stores/library.svelte.js';
import { pets } from '$lib/stores/pets.js';
import type { Pet } from '$lib/types/index.js';
import { filterPets } from '$lib/utils/petFilter.js';
import { capitalize } from '$lib/utils/string.js';

interface Column {
  id: string;
  label: string;
  numeric: boolean;
  accessor: (pet: Pet) => string | number;
}

// Per-attribute columns only when a single species is selected (different
// species expose different attributes); species-agnostic columns are always
// shown so the roster is useful for an all-species view too.
const columns = $derived.by((): Column[] => {
  const species = libraryView.species;
  const attrNames = species ? getAllAttributeNames(species) : [];
  const attrInfo = species ? (getAllAttributes(species) as Record<string, { name?: string }>) : {};
  const num = (pet: Pet, k: string) => (pet as unknown as Record<string, number>)[k] ?? 0;

  const attrCols: Column[] = attrNames.map((attr) => ({
    id: attr,
    label: attrInfo[attr]?.name ?? capitalize(attr),
    numeric: true,
    accessor: (pet: Pet) => num(pet, attr),
  }));

  return [
    { id: 'name', label: 'Name', numeric: false, accessor: (p) => p.name ?? '' },
    { id: 'gender', label: 'Gender', numeric: false, accessor: (p) => p.gender ?? '' },
    { id: 'breed', label: 'Breed', numeric: false, accessor: (p) => p.breed ?? '' },
    ...attrCols,
    {
      id: 'attr_total',
      label: 'Total',
      numeric: true,
      accessor: (p) => attrNames.reduce((sum, a) => sum + num(p, a), 0),
    },
    { id: 'positive_genes', label: '+ Genes', numeric: true, accessor: (p) => p.positive_genes ?? 0 },
  ];
});

const filtered = $derived(
  filterPets($pets, {
    query: libraryView.search,
    tags: libraryView.tags,
    starredOnly: libraryView.starredOnly,
    stabledOnly: libraryView.stabledOnly,
    petQualityOnly: libraryView.petQualityOnly,
    species: libraryView.species,
    breed: libraryView.breed,
  }),
);

const sorted = $derived.by(() => {
  const col = columns.find((c) => c.id === libraryView.sortCol) ?? columns[0];
  const list = [...filtered];
  list.sort((a, b) => {
    const av = col.accessor(a);
    const bv = col.accessor(b);
    const cmp = col.numeric ? Number(av) - Number(bv) : String(av).localeCompare(String(bv));
    return libraryView.sortDir === 'asc' ? cmp : -cmp;
  });
  return list;
});

// If the sorted column disappears (species change drops an attribute), fall
// back to name so the table doesn't silently sort by a stale, missing column.
$effect(() => {
  const ids = new Set(columns.map((c) => c.id));
  if (!ids.has(libraryView.sortCol)) {
    libraryView.sortCol = 'name';
    libraryView.sortDir = 'asc';
  }
});

const selectedInView = $derived(sorted.reduce((n, p) => n + (libraryView.selectedIds.has(p.id) ? 1 : 0), 0));
const allSelected = $derived(sorted.length > 0 && selectedInView === sorted.length);
const someSelected = $derived(selectedInView > 0 && !allSelected);

function toggleSort(colId: string): void {
  if (libraryView.sortCol === colId) {
    libraryView.sortDir = libraryView.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    libraryView.sortCol = colId;
    libraryView.sortDir = 'asc';
  }
}

function sortIndicator(colId: string): string {
  if (colId !== libraryView.sortCol) return '';
  return libraryView.sortDir === 'asc' ? ' ▲' : ' ▼';
}

function toggleSelectAll(): void {
  const next = new Set(libraryView.selectedIds);
  if (allSelected) for (const p of sorted) next.delete(p.id);
  else for (const p of sorted) next.add(p.id);
  setLibrarySelection(next);
}

// Open a single pet (replaces the selection so the Workspace shows its detail).
function open(pet: Pet): void {
  setLibrarySelection(new Set([pet.id]));
}
</script>

<div class="roster" data-testid="roster">
  <table class="roster-table">
    <thead>
      <tr>
        <th class="sel-col">
          <input
            type="checkbox"
            data-testid="roster-select-all"
            checked={allSelected}
            indeterminate={someSelected}
            onchange={toggleSelectAll}
            aria-label="Select all {sorted.length} pets"
          />
        </th>
        {#each columns as col (col.id)}
          <th class:numeric={col.numeric} class:active-sort={libraryView.sortCol === col.id}>
            <button type="button" class="sort-btn" onclick={() => toggleSort(col.id)}>
              {col.label}{sortIndicator(col.id)}
            </button>
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#if sorted.length === 0}
        <tr><td class="empty" colspan={columns.length + 1}>No pets match these filters.</td></tr>
      {:else}
        {#each sorted as pet (pet.id)}
          <tr class:row-selected={libraryView.selectedIds.has(pet.id)} data-pet-id={pet.id}>
            <td class="sel-col">
              <input
                type="checkbox"
                data-testid="roster-row-select"
                checked={libraryView.selectedIds.has(pet.id)}
                onchange={() => toggleLibrarySelection(pet.id)}
                aria-label="Select {pet.name}"
              />
            </td>
            {#each columns as col (col.id)}
              <td class:numeric={col.numeric}>
                {#if col.id === 'name'}
                  <button type="button" class="name-btn" data-testid="roster-open" onclick={() => open(pet)}>
                    {col.accessor(pet)}
                  </button>
                {:else}
                  {col.accessor(pet)}
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      {/if}
    </tbody>
  </table>
</div>

<style>
  .roster { width: 100%; overflow: auto; }
  .roster-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .roster-table th,
  .roster-table td { padding: 6px 10px; text-align: left; border-bottom: 1px solid var(--border-primary); white-space: nowrap; }
  .roster-table th.numeric,
  .roster-table td.numeric { text-align: right; }
  .roster-table thead th { position: sticky; top: 0; background: var(--bg-tertiary); color: var(--text-secondary); font-weight: 600; z-index: 1; }
  .roster-table th.active-sort { color: var(--accent-text, var(--accent)); }
  .sel-col { width: 1%; text-align: center; }
  .sort-btn { background: none; border: none; padding: 0; font: inherit; color: inherit; cursor: pointer; }
  .sort-btn:hover { color: var(--accent-text, var(--accent)); }
  .name-btn { background: none; border: none; padding: 0; font: inherit; font-weight: 600; color: var(--accent-text, var(--accent)); cursor: pointer; }
  .name-btn:hover { text-decoration: underline; }
  .roster-table tbody tr:hover { background: var(--bg-secondary); }
  .roster-table tbody tr.row-selected { background: var(--bg-selected); }
  .empty { text-align: center; color: var(--text-muted); font-style: italic; padding: 24px; }
</style>
