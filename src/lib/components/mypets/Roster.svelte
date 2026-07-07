<script lang="ts">
/**
 * Roster — the Library's full attribute table, shown in the Workspace when no
 * pet is selected. Absorbs the old Stable tab: a sortable matrix of the
 * filtered pets with Name / Gender / Breed / per-species attributes / Total /
 * +Genes. Receives the already-filtered pets from MyPets (one filterPets pass
 * shared by table and selection); sort + multi-select live in `myPetsView`.
 * Clicking a name opens that pet; checkboxes build a multi-selection for the
 * lenses.
 * See docs/design/redesign-library-workspace-v1.md (§2.1).
 */
import PetActions from '$lib/components/shared/PetActions.svelte';
import { getAllAttributeNames, getAllAttributes } from '$lib/services/configService.js';
import { myPetsView, setMyPetsSelection, toggleMyPetsSelection } from '$lib/stores/mypets.svelte.js';
import type { Pet } from '$lib/types/index.js';
import { type SortableColumn, sortByColumn } from '$lib/utils/sortColumn.js';
import { capitalize } from '$lib/utils/string.js';

interface Props {
  /** The already-filtered pets to list. MyPets computes the visible set once
   *  (filterPets + getMyPetsFilters) and shares it with the roster (#405). */
  pets: Pet[];
  /** Open a pet's detail (clicking its name). Distinct from the row checkbox,
   *  which builds the multi-selection for bulk actions. */
  onOpen?: (pet: Pet) => void;
}

const { pets: filtered, onOpen }: Props = $props();

interface Column {
  id: string;
  label: string;
  numeric: boolean;
  accessor: (pet: Pet) => string | number;
}

const num = (pet: Pet, k: string) => (pet as unknown as Record<string, number>)[k] ?? 0;

// Per-attribute columns only when a single species is selected (different
// species expose different attributes); species-agnostic columns are always
// shown so the roster is useful for an all-species view too.
const attrNames = $derived(myPetsView.species ? getAllAttributeNames(myPetsView.species) : []);
const attrInfo = $derived(
  myPetsView.species ? (getAllAttributes(myPetsView.species) as Record<string, { name?: string }>) : {},
);

// Precompute one attribute total per visible pet so sorting by Total doesn't
// re-sum every attribute on each O(n log n) comparison.
const totals = $derived.by(() => {
  if (attrNames.length === 0) return null;
  const m = new Map<number, number>();
  for (const p of filtered)
    m.set(
      p.id,
      attrNames.reduce((sum, a) => sum + num(p, a), 0),
    );
  return m;
});

const columns = $derived.by((): Column[] => {
  const attrCols: Column[] = attrNames.map((attr) => ({
    id: attr,
    label: attrInfo[attr]?.name ?? capitalize(attr),
    numeric: true,
    accessor: (pet: Pet) => num(pet, attr),
  }));

  // Total only makes sense alongside the per-species attribute columns; under
  // "All" species there are no attributes to sum, so it would read 0 for every
  // pet — omit it (and the attr columns) there.
  const totalCol: Column[] = attrNames.length
    ? [{ id: 'attr_total', label: 'Total', numeric: true, accessor: (p: Pet) => totals?.get(p.id) ?? 0 }]
    : [];

  return [
    { id: 'name', label: 'Name', numeric: false, accessor: (p) => p.name ?? '' },
    { id: 'gender', label: 'Gender', numeric: false, accessor: (p) => p.gender ?? '' },
    { id: 'breed', label: 'Breed', numeric: false, accessor: (p) => p.breed ?? '' },
    ...attrCols,
    ...totalCol,
    { id: 'positive_genes', label: '+ Genes', numeric: true, accessor: (p) => p.positive_genes ?? 0 },
  ];
});

const sorted = $derived.by(() => {
  const col = columns.find((c) => c.id === myPetsView.sortCol) ?? columns[0];
  // Reuse the shared, tested comparator (numeric subtract vs localeCompare).
  const sortable: SortableColumn<Pet> = col.numeric
    ? { numeric: true, accessor: (p) => Number(col.accessor(p)) }
    : { numeric: false, accessor: (p) => String(col.accessor(p)) };
  return sortByColumn(filtered, sortable, myPetsView.sortDir);
});

// If the sorted column disappears (species change drops an attribute), fall
// back to name so the table doesn't silently sort by a stale, missing column.
$effect(() => {
  const ids = new Set(columns.map((c) => c.id));
  if (!ids.has(myPetsView.sortCol)) {
    myPetsView.sortCol = 'name';
    myPetsView.sortDir = 'asc';
  }
});

const selectedInView = $derived(sorted.reduce((n, p) => n + (myPetsView.selectedIds.has(p.id) ? 1 : 0), 0));
const allSelected = $derived(sorted.length > 0 && selectedInView === sorted.length);
const someSelected = $derived(selectedInView > 0 && !allSelected);

function toggleSort(colId: string): void {
  if (myPetsView.sortCol === colId) {
    myPetsView.sortDir = myPetsView.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    myPetsView.sortCol = colId;
    myPetsView.sortDir = 'asc';
  }
}

function sortIndicator(colId: string): string {
  if (colId !== myPetsView.sortCol) return '';
  return myPetsView.sortDir === 'asc' ? ' ▲' : ' ▼';
}

function toggleSelectAll(): void {
  const next = new Set(myPetsView.selectedIds);
  if (allSelected) for (const p of sorted) next.delete(p.id);
  else for (const p of sorted) next.add(p.id);
  setMyPetsSelection(next);
}

// Open a single pet's detail. The row checkbox is separate (multi-select for
// bulk actions); clicking the name opens the full-view detail.
function open(pet: Pet): void {
  onOpen?.(pet);
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
          <th class:numeric={col.numeric} class:active-sort={myPetsView.sortCol === col.id}>
            <button type="button" class="sort-btn" onclick={() => toggleSort(col.id)}>
              {col.label}{sortIndicator(col.id)}
            </button>
          </th>
        {/each}
        <th class="act-col" aria-label="Actions"></th>
      </tr>
    </thead>
    <tbody>
      {#if sorted.length === 0}
        <tr><td class="empty" colspan={columns.length + 2}>No pets match these filters.</td></tr>
      {:else}
        {#each sorted as pet (pet.id)}
          <tr class:row-selected={myPetsView.selectedIds.has(pet.id)} data-pet-id={pet.id}>
            <td class="sel-col">
              <input
                type="checkbox"
                data-testid="roster-row-select"
                checked={myPetsView.selectedIds.has(pet.id)}
                onchange={() => toggleMyPetsSelection(pet.id)}
                aria-label="Select {pet.name ?? 'pet'}"
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
            <td class="act-col">
              <PetActions {pet} variant="icon" />
            </td>
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
  .act-col { width: 1%; white-space: nowrap; text-align: right; }
  .act-col :global(.action-btn) { display: inline-grid; }
  .sort-btn { background: none; border: none; padding: 0; font: inherit; color: inherit; cursor: pointer; }
  .sort-btn:hover { color: var(--accent-text, var(--accent)); }
  .name-btn { background: none; border: none; padding: 0; font: inherit; font-weight: 600; color: var(--accent-text, var(--accent)); cursor: pointer; }
  .name-btn:hover { text-decoration: underline; }
  .roster-table tbody tr:hover { background: var(--bg-secondary); }
  .roster-table tbody tr.row-selected { background: var(--bg-selected); }
  .empty { text-align: center; color: var(--text-muted); font-style: italic; padding: 24px; }
</style>
