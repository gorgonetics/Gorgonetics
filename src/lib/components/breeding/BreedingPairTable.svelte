<script lang="ts">
import { breedingView } from '$lib/stores/breeding.svelte.js';
import { appState } from '$lib/stores/pets.js';
import type { BreedingPairResult, Pet } from '$lib/types/index.js';

interface Props {
  results: BreedingPairResult[];
  attrNames: string[];
}

// Discriminated on `numeric` so the accessor's return type is tied to the flag:
// a numeric column sorts by subtraction, a text column by localeCompare, and a
// mismatch is a compile error rather than a silent cast.
type Column =
  | { id: string; label: string; numeric: true; accessor: (r: BreedingPairResult) => number }
  | { id: string; label: string; numeric: false; accessor: (r: BreedingPairResult) => string };

const { results, attrNames }: Props = $props();

/**
 * Column definitions. The per-attribute columns are appended after the
 * fixed columns; the column id matches the key in `evPositiveByAttribute`,
 * which in turn matches `breedingView.sortCol` after a click on the
 * header.
 */
const columns = $derived<Column[]>([
  { id: 'male', label: '♂ Male', accessor: (r) => r.male.name, numeric: false },
  { id: 'female', label: '♀ Female', accessor: (r) => r.female.name, numeric: false },
  { id: 'evMixed', label: 'Mixed', accessor: (r) => r.evMixed, numeric: true },
  { id: 'evUnknown', label: 'Unknown', accessor: (r) => r.evUnknown, numeric: true },
  { id: 'evPositiveTotal', label: 'Total +', accessor: (r) => r.evPositiveTotal, numeric: true },
  ...attrNames.map(
    (name): Column => ({
      id: name,
      label: name,
      accessor: (r: BreedingPairResult) => r.evPositiveByAttribute[name] ?? 0,
      numeric: true,
    }),
  ),
]);

const sortedResults = $derived.by(() => {
  // Fallback to the headline column by name (not by index) so re-ordering
  // the column list later won't silently change the default sort.
  const col =
    columns.find((c) => c.id === breedingView.sortCol) ?? columns.find((c) => c.id === 'evPositiveTotal') ?? columns[0];
  const dir = breedingView.sortDir === 'asc' ? 1 : -1;
  return [...results].sort((a, b) => {
    // `col.numeric` narrows the accessor's return type, so no cast is needed.
    const cmp = col.numeric ? col.accessor(a) - col.accessor(b) : col.accessor(a).localeCompare(col.accessor(b));
    return cmp * dir;
  });
});

function setSort(colId: string) {
  if (breedingView.sortCol === colId) {
    breedingView.sortDir = breedingView.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    breedingView.sortCol = colId;
    breedingView.sortDir = 'asc';
  }
}

function sortIndicator(colId: string) {
  if (colId !== breedingView.sortCol) return '';
  return breedingView.sortDir === 'asc' ? ' ▲' : ' ▼';
}

function openPet(pet: Pet) {
  appState.selectPet(pet);
  appState.switchTab('pets');
}

function openTrio(pair: BreedingPairResult) {
  breedingView.selectedPair = { male: pair.male, female: pair.female };
}

function fmt(n: number) {
  return n.toFixed(1);
}
</script>

<div class="table-wrapper" data-testid="breeding-pair-table">
    <table>
        <thead>
            <tr>
                <th class="action-col" aria-label="Inspect"></th>
                {#each columns as col (col.id)}
                    {@const isActive = breedingView.sortCol === col.id}
                    <th
                        class:numeric={col.numeric}
                        class:active={isActive}
                        aria-sort={isActive ? (breedingView.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                        <button
                            type="button"
                            class="sort-btn"
                            onclick={() => setSort(col.id)}
                        >
                            {col.label}{sortIndicator(col.id)}
                        </button>
                    </th>
                {/each}
            </tr>
        </thead>
        <tbody>
            {#each sortedResults as pair (`${pair.male.id}-${pair.female.id}`)}
                <tr>
                    <td class="action-cell">
                        <button
                            type="button"
                            class="inspect-btn"
                            onclick={() => openTrio(pair)}
                            title="View offspring trio"
                            aria-label={`View offspring trio for ${pair.male.name} × ${pair.female.name}`}
                            data-testid="inspect-pair"
                        >🔬</button>
                    </td>
                    <td><button class="parent-link" onclick={() => openPet(pair.male)}>{pair.male.name}</button></td>
                    <td><button class="parent-link" onclick={() => openPet(pair.female)}>{pair.female.name}</button></td>
                    <td class="numeric">{fmt(pair.evMixed)}</td>
                    <td class="numeric">{fmt(pair.evUnknown)}</td>
                    <td class="numeric strong">{fmt(pair.evPositiveTotal)}</td>
                    {#each attrNames as name (name)}
                        <td class="numeric">{fmt(pair.evPositiveByAttribute[name] ?? 0)}</td>
                    {/each}
                </tr>
            {/each}
        </tbody>
    </table>
</div>

<style>
    .table-wrapper {
        flex: 1;
        min-height: 0;
        overflow: auto;
        border: 1px solid var(--border-primary);
        border-radius: 6px;
        background: var(--bg-primary);
    }

    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
    }

    th {
        text-align: left;
        background: var(--bg-secondary);
        border-bottom: 1px solid var(--border-primary);
        font-weight: 600;
        font-size: 12px;
        position: sticky;
        top: 0;
        z-index: 1;
    }

    th.numeric {
        text-align: right;
    }

    th.active {
        color: var(--accent);
    }

    .sort-btn {
        width: 100%;
        padding: 8px 10px;
        background: transparent;
        border: none;
        color: inherit;
        font: inherit;
        cursor: pointer;
        text-align: inherit;
        white-space: nowrap;
    }

    .sort-btn:hover {
        background: var(--bg-tertiary);
    }

    td {
        padding: 6px 10px;
        border-bottom: 1px solid var(--border-primary);
    }

    td.numeric {
        text-align: right;
        font-variant-numeric: tabular-nums;
    }

    td.strong {
        font-weight: 600;
    }

    tbody tr:hover {
        background: var(--bg-secondary);
    }

    .parent-link {
        background: none;
        border: none;
        padding: 0;
        color: var(--accent);
        cursor: pointer;
        font: inherit;
        text-decoration: none;
    }

    .parent-link:hover {
        text-decoration: underline;
    }

    .action-col {
        width: 32px;
        min-width: 32px;
    }

    .action-cell {
        text-align: center;
        padding: 2px 4px;
    }

    .inspect-btn {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        padding: 4px;
        border-radius: 4px;
        opacity: 0.65;
        transition: opacity 0.15s ease, background 0.15s ease;
    }

    .inspect-btn:hover {
        opacity: 1;
        background: var(--bg-tertiary);
    }
</style>
