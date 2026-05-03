<script>
import { breedingView } from '$lib/stores/breeding.svelte.js';
import { appState } from '$lib/stores/pets.js';

let { results, attrNames } = $props();

/**
 * Column definitions. The per-attribute columns are appended after the
 * fixed columns; the column id matches the key in `evPositiveByAttribute`,
 * which in turn matches `breedingView.sortCol` after a click on the
 * header.
 */
const columns = $derived([
  { id: 'male', label: '♂ Male', accessor: (r) => r.male.name, numeric: false },
  { id: 'female', label: '♀ Female', accessor: (r) => r.female.name, numeric: false },
  { id: 'evMixed', label: 'Mixed', accessor: (r) => r.evMixed, numeric: true },
  { id: 'evUnknown', label: 'Unknown', accessor: (r) => r.evUnknown, numeric: true },
  { id: 'evPositiveTotal', label: 'Total +', accessor: (r) => r.evPositiveTotal, numeric: true },
  ...attrNames.map((name) => ({
    id: name,
    label: name,
    accessor: (r) => r.evPositiveByAttribute[name] ?? 0,
    numeric: true,
  })),
]);

const sortedResults = $derived.by(() => {
  // Fallback to the headline column by name (not by index) so re-ordering
  // the column list later won't silently change the default sort.
  const col =
    columns.find((c) => c.id === breedingView.sortCol) ?? columns.find((c) => c.id === 'evPositiveTotal') ?? columns[0];
  const dir = breedingView.sortDir === 'asc' ? 1 : -1;
  return [...results].sort((a, b) => {
    const av = col.accessor(a);
    const bv = col.accessor(b);
    const cmp = col.numeric ? av - bv : String(av).localeCompare(String(bv));
    return cmp * dir;
  });
});

function setSort(colId) {
  if (breedingView.sortCol === colId) {
    breedingView.sortDir = breedingView.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    breedingView.sortCol = colId;
    breedingView.sortDir = 'asc';
  }
}

function sortIndicator(colId) {
  if (colId !== breedingView.sortCol) return '';
  return breedingView.sortDir === 'asc' ? ' ▲' : ' ▼';
}

function openPet(pet) {
  appState.selectPet(pet);
  appState.switchTab('pets');
}

function fmt(n) {
  return n.toFixed(1);
}
</script>

<div class="table-wrapper" data-testid="breeding-pair-table">
    <table>
        <thead>
            <tr>
                {#each columns as col (col.id)}
                    <th
                        class:numeric={col.numeric}
                        class:active={breedingView.sortCol === col.id}
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
        overflow-x: auto;
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
</style>
