<script lang="ts">
import { breedingView } from '$lib/stores/breeding.svelte.js';
import { requestOpenPet } from '$lib/stores/mypets.svelte.js';
import { appState } from '$lib/stores/pets.js';
import type { BreedingPairResult, Pet } from '$lib/types/index.js';
import type { SuggestedPlan } from '$lib/utils/breedingPlan.js';
import { type SortableColumn, sortByColumn } from '$lib/utils/sortColumn.js';

interface Props {
  results: BreedingPairResult[];
  attrNames: string[];
  /**
   * Suggested plans. When set, the table renders each plan as a colour-coded,
   * vertically-stacked group of rows (best first) instead of the flat ranking —
   * all columns stay visible and sortable within each group.
   */
  plans?: SuggestedPlan[];
  /** Bench an animal straight from a row (drops every pair using it). */
  onBench?: (petId: number) => void;
}

// `SortableColumn` is discriminated on `numeric` so the accessor's return type
// is tied to the flag: a numeric column sorts by subtraction, a text column by
// localeCompare, and a mismatch is a compile error rather than a silent cast.
type Column = { id: string; label: string } & SortableColumn<BreedingPairResult>;

const { results, attrNames, plans, onBench }: Props = $props();

// Distinct hues per option — saturated mid-tones that read in light and dark.
const OPTION_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#ef4444'];
const optionColor = (i: number) => OPTION_COLORS[i % OPTION_COLORS.length];

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
  { id: 'evPositiveWeighted', label: 'Pool gain', accessor: (r) => r.evPositiveWeighted, numeric: true },
  ...attrNames.map(
    (name): Column => ({
      id: name,
      label: name,
      accessor: (r: BreedingPairResult) => r.evPositiveByAttribute[name] ?? 0,
      numeric: true,
    }),
  ),
]);

// The active column: matched by name (not index) so re-ordering the column
// list later won't silently change the default sort.
const activeCol = $derived(
  columns.find((c) => c.id === breedingView.sortCol) ?? columns.find((c) => c.id === 'evPositiveTotal') ?? columns[0],
);

const sortPairs = (pairs: BreedingPairResult[]) => sortByColumn(pairs, activeCol, breedingView.sortDir);

const sortedResults = $derived(sortPairs(results));

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
  // Jump to My Pets and open this parent's full detail.
  requestOpenPet(pet.id);
  appState.switchTab('mypets');
}

function openTrio(pair: BreedingPairResult) {
  breedingView.selectedPair = { male: pair.male, female: pair.female };
}

function fmt(n: number) {
  return n.toFixed(1);
}

// --- Scroll persistence -----------------------------------------------------
// The wrapper is the ranking's scroll container; the component unmounts on a
// destination switch (e.g. a parent-name excursion to My Pets), so the offsets
// live in breedingView. Sync the DOM to the store whenever the offsets
// change: this restores them on mount (only once the ranked rows are in the
// DOM — before that, scrollHeight is too small for the offset to apply) AND
// applies external resets (a species change zeroes the offsets while this
// component stays mounted; a one-shot restore would leave the table visually
// scrolled with the store saying 0, and the next user scroll would re-persist
// the stale offsets). Comparing before assigning breaks the feedback loop
// with the onscroll handler — a store write that merely echoes the element's
// own scroll position is a no-op here.
let wrapperEl = $state<HTMLDivElement>();

$effect(() => {
  const top = breedingView.scrollTop;
  const left = breedingView.scrollLeft;
  if (!wrapperEl || sortedResults.length === 0) return;
  if (wrapperEl.scrollTop !== top) wrapperEl.scrollTop = top;
  if (wrapperEl.scrollLeft !== left) wrapperEl.scrollLeft = left;
});

function persistScroll() {
  if (!wrapperEl) return;
  breedingView.scrollTop = wrapperEl.scrollTop;
  breedingView.scrollLeft = wrapperEl.scrollLeft;
}
</script>

<div class="table-wrapper" data-testid="breeding-pair-table" bind:this={wrapperEl} onscroll={persistScroll}>
    <table>
        <thead>
            <tr>
                <th class="action-col">Offspring</th>
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
        {#snippet parentCell(pet: Pet)}
            <td>
                <span class="parent">
                    <button class="parent-link" onclick={() => openPet(pet)}>{pet.name}</button>
                    {#if onBench}
                        <button
                            type="button"
                            class="bench-btn"
                            title={`Bench ${pet.name} (already breeding)`}
                            aria-label={`Bench ${pet.name}`}
                            data-testid="bench-animal"
                            data-pet-id={pet.id}
                            onclick={() => onBench?.(pet.id)}
                        >⏸</button>
                    {/if}
                </span>
            </td>
        {/snippet}

        {#snippet row(pair: BreedingPairResult)}
            <tr>
                <td class="action-cell">
                    <button
                        type="button"
                        class="inspect-btn"
                        onclick={() => openTrio(pair)}
                        title="View offspring trio"
                        aria-label={`View offspring trio for ${pair.male.name} × ${pair.female.name}`}
                        data-testid="inspect-pair"
                    >🔬 Trio</button>
                </td>
                {@render parentCell(pair.male)}
                {@render parentCell(pair.female)}
                <td class="numeric">{fmt(pair.evMixed)}</td>
                <td class="numeric">{fmt(pair.evUnknown)}</td>
                <td class="numeric strong">{fmt(pair.evPositiveTotal)}</td>
                <td class="numeric strong">{fmt(pair.evPositiveWeighted)}</td>
                {#each attrNames as name (name)}
                    <td class="numeric">{fmt(pair.evPositiveByAttribute[name] ?? 0)}</td>
                {/each}
            </tr>
        {/snippet}

        {#if plans}
            {#each plans as plan, i (i)}
                <tbody class="option" data-testid="plan-option" style="--option-color: {optionColor(i)}">
                    <tr class="option-head">
                        <td colspan={columns.length + 1}>
                            <span class="option-dot"></span>
                            Option {i + 1}{i === 0 ? ' · best' : ''}
                            <span class="option-total">pool gain {fmt(plan.total)}</span>
                        </td>
                    </tr>
                    {#each sortPairs(plan.pairs) as pair (`${pair.male.id}-${pair.female.id}`)}
                        {@render row(pair)}
                    {/each}
                </tbody>
            {/each}
        {:else}
            <tbody>
                {#each sortedResults as pair (`${pair.male.id}-${pair.female.id}`)}
                    {@render row(pair)}
                {/each}
            </tbody>
        {/if}
    </table>
</div>

<style>
    /* Hug the rows: `flex: 0 1 auto` sizes the bordered box to the table's
       natural height (a sparse ranking doesn't sit in a full-height frame of
       empty space), while flex-shrink + min-height: 0 still cap it at the
       parent's constrained height so a long ranking scrolls inside as before. */
    .table-wrapper {
        flex: 0 1 auto;
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

    .parent {
        display: inline-flex;
        align-items: center;
        gap: 4px;
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

    /* Quick-bench: faint until the row is hovered so it doesn't compete with
       the parent names, but always in the DOM (and focusable) for a11y/tests. */
    .bench-btn {
        background: none;
        border: none;
        padding: 0 2px;
        color: var(--text-tertiary);
        cursor: pointer;
        font-size: 11px;
        line-height: 1;
        opacity: 0;
        transition: opacity 0.12s ease;
    }

    tbody tr:hover .bench-btn,
    .bench-btn:focus-visible {
        opacity: 1;
    }

    .bench-btn:hover {
        color: var(--accent);
    }

    /* Suggested-plan groups: each option is a colour-coded block of rows so the
       stacked alternatives stay visually distinct while keeping every column. */
    .option-head td {
        background: var(--bg-secondary);
        border-top: 2px solid var(--option-color);
        border-bottom: 1px solid var(--border-primary);
        color: var(--text-secondary);
        font-size: 12px;
        font-weight: 600;
        padding: 5px 10px;
    }

    .option-dot {
        display: inline-block;
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: var(--option-color);
        margin-right: 6px;
        vertical-align: middle;
    }

    .option-total {
        margin-left: 8px;
        font-weight: 400;
        color: var(--text-tertiary);
        font-variant-numeric: tabular-nums;
    }

    /* Colour spine down the left of every row in the option. */
    .option .action-cell {
        border-left: 3px solid var(--option-color);
    }

    /* The pair table is wide (attribute columns); pin the offspring action to
       the left so it stays reachable at any horizontal scroll position. */
    .action-col {
        width: 84px;
        min-width: 84px;
        left: 0;
        z-index: 2;
    }

    .action-cell {
        text-align: center;
        padding: 4px 8px;
        position: sticky;
        left: 0;
        background: var(--bg-primary);
        z-index: 1;
    }

    tbody tr:hover .action-cell {
        background: var(--bg-secondary);
    }

    .inspect-btn {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        background: var(--bg-secondary);
        border: 1px solid var(--border-primary);
        color: var(--text-secondary);
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
        padding: 4px 8px;
        border-radius: 6px;
        white-space: nowrap;
        transition: all 0.15s ease;
    }

    .inspect-btn:hover {
        background: var(--accent);
        color: var(--text-inverse);
        border-color: var(--accent);
    }
</style>
