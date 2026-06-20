<script lang="ts">
import BulkSharePetDialog from '$lib/components/community/BulkSharePetDialog.svelte';
import PetEditor from '$lib/components/pet/PetEditor.svelte';
import StatusBanner from '$lib/components/shared/StatusBanner.svelte';
import {
  getAllAttributeNames,
  getAllAttributes,
  getSupportedSpecies,
  normalizeSpecies,
} from '$lib/services/configService.js';
import { comparisonActions, comparisonPets, comparisonReady } from '$lib/stores/comparison.js';
import { allTags as allTagsStore, appState, pets } from '$lib/stores/pets.js';
import { stableView } from '$lib/stores/stable.svelte.js';
import { type DialogResult, HORSE_BREEDS, type Pet } from '$lib/types/index.js';

interface Column {
  id: string;
  label: string;
  title?: string;
  accessor: (pet: Pet) => string | number;
  numeric: boolean;
  compact?: boolean;
  sortable?: boolean;
}

const SPECIES: string[] = getSupportedSpecies();

const BREEDS_BY_SPECIES: Record<string, string[]> = {
  beewasp: ['Bee', 'Wasp'],
  horse: Object.keys(HORSE_BREEDS),
};

let editingPet = $state<Pet | null>(null);
let editorOpen = $state(false);

// Bulk-share selection. Keyed by pet id so it survives re-sorts and filter
// narrowing; "select all" operates on the full filtered set (`sortedPets`),
// not the rendered rows, so it covers every match regardless of scroll.
let selectedIds = $state<Set<number>>(new Set());
let bulkShareOpen = $state(false);
let shareStatus = $state<DialogResult | null>(null);

function isInComparison(id: number): boolean {
  return $comparisonPets[0]?.id === id || $comparisonPets[1]?.id === id;
}

function viewPet(pet: Pet): void {
  appState.selectPet(pet);
  appState.switchTab('pets');
}

function openEditor(pet: Pet): void {
  editingPet = pet;
  editorOpen = true;
}

function closeEditor(): void {
  editorOpen = false;
  editingPet = null;
}

function toggleCompare(pet: Pet): void {
  if (isInComparison(pet.id)) comparisonActions.removePet(pet.id);
  else comparisonActions.addPet(pet);
}

function startCompare(): void {
  appState.switchTab('compare');
}

/**
 * Build the column list for the currently selected species. Species-specific
 * attribute columns (temperament / ferocity) appear only for the species they
 * belong to; Breed is a shared column that may be blank on species that don't
 * use it yet.
 */
function buildColumns(species: string): Column[] {
  const attrConfig = getAllAttributes(species) as Record<string, { name?: string }>;
  const attrNames = getAllAttributeNames(species);
  const attrCols: Column[] = attrNames.map((attr) => {
    const info = attrConfig[attr];
    return {
      id: attr,
      label: info?.name ?? attr,
      title: info?.name ?? attr,
      accessor: (pet: Pet) => (pet as unknown as Record<string, number>)[attr] ?? 0,
      numeric: true,
      compact: true,
      sortable: true,
    };
  });

  const attrTotal = (pet: Pet): number =>
    attrNames.reduce((sum, attr) => sum + ((pet as unknown as Record<string, number>)[attr] ?? 0), 0);

  return [
    { id: 'actions', label: 'Actions', accessor: () => '', numeric: false, sortable: false },
    { id: 'name', label: 'Name', accessor: (pet: Pet) => pet.name ?? '', numeric: false, sortable: true },
    { id: 'gender', label: 'Gender', accessor: (pet: Pet) => pet.gender ?? '', numeric: false, sortable: true },
    { id: 'breed', label: 'Breed', accessor: (pet: Pet) => pet.breed ?? '', numeric: false, sortable: true },
    ...attrCols,
    {
      id: 'attr_total',
      label: 'Total',
      title: 'Sum of attributes',
      accessor: attrTotal,
      numeric: true,
      compact: true,
      sortable: true,
    },
    {
      id: 'positive_genes',
      label: '+ Genes',
      title: 'Confirmed positive-effect genes',
      accessor: (pet: Pet) => pet.positive_genes ?? 0,
      numeric: true,
      sortable: true,
    },
  ];
}

const columns: Column[] = $derived(buildColumns(stableView.species));

const breedOptions: string[] = $derived(BREEDS_BY_SPECIES[stableView.species] ?? []);
const availableTags: string[] = $derived($allTagsStore);

const filteredPets = $derived.by((): Pet[] => {
  const q = stableView.search.trim().toLowerCase();
  const tagSet = new Set(stableView.tags);
  return $pets.filter((pet: Pet) => {
    if (!pet.stabled) return false;
    if (normalizeSpecies(pet.species) !== stableView.species) return false;
    if (q && !(pet.name ?? '').toLowerCase().includes(q)) return false;
    if (stableView.gender !== 'all' && pet.gender !== stableView.gender) return false;
    if (stableView.breed !== 'all' && pet.breed !== stableView.breed) return false;
    if (stableView.starredOnly && !pet.starred) return false;
    if (stableView.petQualityOnly && !pet.is_pet_quality) return false;
    if (tagSet.size > 0) {
      const petTags = pet.tags ?? [];
      for (const t of tagSet) if (!petTags.includes(t)) return false;
    }
    return true;
  });
});

// Reset the breed filter when the selected species changes and the chosen
// breed no longer belongs to that species.
$effect(() => {
  if (stableView.breed === 'all') return;
  if (!breedOptions.includes(stableView.breed)) {
    stableView.breed = 'all';
  }
});

// Drop stale tag filters that no longer exist on any pet.
$effect(() => {
  const valid = stableView.tags.filter((t) => availableTags.includes(t));
  if (valid.length !== stableView.tags.length) {
    stableView.tags = valid;
  }
});

function toggleTagFilter(tag: string): void {
  if (stableView.tags.includes(tag)) {
    stableView.tags = stableView.tags.filter((t) => t !== tag);
  } else {
    stableView.tags = [...stableView.tags, tag];
  }
}

const sortedPets = $derived.by((): Pet[] => {
  const col = columns.find((c) => c.id === stableView.sortCol) ?? columns[0];
  const list = [...filteredPets];
  list.sort((a, b) => {
    const av = col.accessor(a);
    const bv = col.accessor(b);
    const cmp = col.numeric ? Number(av) - Number(bv) : String(av).localeCompare(String(bv));
    return stableView.sortDir === 'asc' ? cmp : -cmp;
  });
  return list;
});

// If the currently-sorted column doesn't exist for the newly-selected species
// (only temperament ↔ ferocity can disappear), fall back to sorting by name.
$effect(() => {
  const ids = new Set(columns.map((c) => c.id));
  if (!ids.has(stableView.sortCol)) {
    stableView.sortCol = 'name';
    stableView.sortDir = 'asc';
  }
});

// --- Bulk-share selection ---

// How many of the currently-visible (filtered) pets are selected drives the
// header checkbox's checked/indeterminate state.
const selectedInView = $derived(sortedPets.reduce((n, p) => n + (selectedIds.has(p.id) ? 1 : 0), 0));
const allSelected = $derived(sortedPets.length > 0 && selectedInView === sortedPets.length);
const someSelected = $derived(selectedInView > 0 && !allSelected);

// Switching species changes the pet universe entirely; carrying a selection
// across would let "Share selected" include pets you can no longer see.
$effect(() => {
  stableView.species; // track
  selectedIds = new Set();
});

function toggleRow(id: number): void {
  const next = new Set(selectedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds = next;
}

function toggleSelectAll(): void {
  if (allSelected) {
    // Clear only the in-view pets, preserving any selected-but-now-filtered.
    const next = new Set(selectedIds);
    for (const p of sortedPets) next.delete(p.id);
    selectedIds = next;
  } else {
    const next = new Set(selectedIds);
    for (const p of sortedPets) next.add(p.id);
    selectedIds = next;
  }
}

function clearSelection(): void {
  selectedIds = new Set();
}

const selectedPets = $derived($pets.filter((p) => selectedIds.has(p.id)));

function handleBulkShareResult(result: DialogResult): void {
  shareStatus = result;
  // A run that shared or skipped is "done" with these pets; clear so the user
  // isn't left with a stale selection that re-shares on a second click.
  if (result.type !== 'error') clearSelection();
}

function toggleSort(colId: string): void {
  const col = columns.find((c) => c.id === colId);
  if (!col || col.sortable === false) return;
  if (stableView.sortCol === colId) {
    stableView.sortDir = stableView.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    stableView.sortCol = colId;
    stableView.sortDir = 'asc';
  }
}

function sortIndicator(colId: string): string {
  if (colId !== stableView.sortCol) return '';
  return stableView.sortDir === 'asc' ? ' ▲' : ' ▼';
}
</script>

<div class="stable-view" data-testid="stable-view">
    <header class="stable-header">
        <h2 class="stable-title">Stable</h2>
        <div class="species-tabs" role="group" aria-label="Species">
            {#each SPECIES as species}
                <button
                    class="species-tab-btn"
                    class:active={stableView.species === species}
                    aria-pressed={stableView.species === species}
                    data-species={species}
                    onclick={() => { stableView.species = species; }}
                >
                    {species}
                </button>
            {/each}
        </div>
        <span class="count">{sortedPets.length} stabled</span>
        {#if selectedPets.length > 0}
            <div class="bulk-actions" data-testid="bulk-actions">
                <span class="bulk-count">{selectedPets.length} selected</span>
                <button
                    class="bulk-share-btn"
                    data-testid="bulk-share-open"
                    onclick={() => { bulkShareOpen = true; }}
                    title="Share the selected pets to the community catalogue"
                >🌐 Share selected</button>
                <button class="bulk-clear-btn" onclick={clearSelection} title="Clear selection">Clear</button>
            </div>
        {/if}
        {#if $comparisonReady}
            <button class="compare-now-btn" onclick={startCompare} title="Open comparison view">
                ⚖️ Compare ({[$comparisonPets[0]?.name, $comparisonPets[1]?.name].filter(Boolean).join(' vs ')})
            </button>
        {/if}
    </header>

    {#if shareStatus}
        <div class="share-status">
            <StatusBanner
                type={shareStatus.type}
                message={shareStatus.message}
                autoDismissMs={8000}
                onDismiss={() => { shareStatus = null; }}
            />
        </div>
    {/if}

    <div class="filter-bar">
        <input
            class="filter-search"
            type="search"
            placeholder="Search by name…"
            data-testid="stable-search"
            bind:value={stableView.search}
        />
        <label class="filter-select-label">
            <span>Gender</span>
            <select class="filter-select" bind:value={stableView.gender} data-testid="stable-gender">
                <option value="all">All</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
            </select>
        </label>
        <label class="filter-select-label">
            <span>Breed</span>
            <select class="filter-select" bind:value={stableView.breed} data-testid="stable-breed">
                <option value="all">All</option>
                {#each breedOptions as breed}
                    <option value={breed}>{breed}</option>
                {/each}
            </select>
        </label>
        <button
            class="filter-pill"
            class:active={stableView.starredOnly}
            data-testid="stable-starred"
            onclick={() => { stableView.starredOnly = !stableView.starredOnly; }}
            title="Show only starred pets"
        >⭐ Starred</button>
        <button
            class="filter-pill"
            class:active={stableView.petQualityOnly}
            data-testid="stable-pet-quality"
            onclick={() => { stableView.petQualityOnly = !stableView.petQualityOnly; }}
            title="Show only pet-quality pets"
        >🏆 Pet quality</button>
        {#if availableTags.length > 0}
            <div class="filter-tags">
                {#each availableTags as tag}
                    <button
                        class="filter-pill tag"
                        class:active={stableView.tags.includes(tag)}
                        onclick={() => toggleTagFilter(tag)}
                    >{tag}</button>
                {/each}
            </div>
        {/if}
    </div>

    <div class="table-scroll">
        <table class="stable-table">
            <thead>
                <tr>
                    <th class="select-col">
                        <input
                            type="checkbox"
                            class="row-select"
                            data-testid="bulk-select-all"
                            checked={allSelected}
                            indeterminate={someSelected}
                            onchange={toggleSelectAll}
                            aria-label="Select all {sortedPets.length} pets matching the current filters"
                            title="Select all {sortedPets.length} matching"
                        />
                    </th>
                    {#each columns as col (col.id)}
                        <th
                            class="header-cell"
                            class:numeric={col.numeric}
                            class:compact={col.compact}
                            class:active-sort={stableView.sortCol === col.id}
                            data-col={col.id}
                            title={col.title ?? ''}
                        >
                            {#if col.sortable === false}
                                <span class="header-static">{col.label}</span>
                            {:else}
                                <button
                                    type="button"
                                    class="header-sort-btn"
                                    onclick={() => toggleSort(col.id)}
                                    aria-label="Sort by {col.title ?? col.label}"
                                >
                                    {col.label}{sortIndicator(col.id)}
                                </button>
                            {/if}
                        </th>
                    {/each}
                </tr>
            </thead>
            <tbody>
                {#if sortedPets.length === 0}
                    <tr>
                        <td class="empty" colspan={columns.length + 1}>
                            No stabled {stableView.species} pets.
                        </td>
                    </tr>
                {:else}
                    {#each sortedPets as pet (pet.id)}
                        <tr data-pet-id={pet.id} class:row-selected={selectedIds.has(pet.id)}>
                            <td class="select-col">
                                <input
                                    type="checkbox"
                                    class="row-select"
                                    data-testid="bulk-select-row"
                                    checked={selectedIds.has(pet.id)}
                                    onchange={() => toggleRow(pet.id)}
                                    aria-label="Select {pet.name}"
                                />
                            </td>
                            {#each columns as col (col.id)}
                                <td class:numeric={col.numeric} class:compact={col.compact} data-col={col.id}>
                                    {#if col.id === 'actions'}
                                        <div class="row-actions">
                                            <button
                                                class="row-action-btn"
                                                title="View genes"
                                                aria-label="View genes for {pet.name}"
                                                data-action="view"
                                                onclick={() => viewPet(pet)}
                                            >👁</button>
                                            <button
                                                class="row-action-btn"
                                                title="Edit pet"
                                                aria-label="Edit {pet.name}"
                                                data-action="edit"
                                                onclick={() => openEditor(pet)}
                                            >✎</button>
                                            <button
                                                class="row-action-btn"
                                                class:active={isInComparison(pet.id)}
                                                title={isInComparison(pet.id) ? 'Remove from comparison' : 'Add to comparison'}
                                                aria-label="Toggle comparison selection for {pet.name}"
                                                aria-pressed={isInComparison(pet.id)}
                                                data-action="compare"
                                                onclick={() => toggleCompare(pet)}
                                            >⚖️</button>
                                        </div>
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
</div>

{#if editingPet}
    <PetEditor
        pet={editingPet}
        bind:open={editorOpen}
        onClose={closeEditor}
        onSave={() => {}}
    />
{/if}

{#if bulkShareOpen}
    <BulkSharePetDialog
        pets={selectedPets}
        onClose={() => { bulkShareOpen = false; }}
        onResult={handleBulkShareResult}
    />
{/if}

<style>
    .stable-view {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
    }

    .stable-header {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 12px 16px;
        border-bottom: 1px solid var(--border-primary);
        background: var(--bg-primary);
        flex-shrink: 0;
    }

    .stable-title {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        color: var(--text-primary);
    }

    .species-tabs {
        display: flex;
        gap: 4px;
        background: var(--bg-tertiary);
        border-radius: 8px;
        padding: 3px;
    }

    .species-tab-btn {
        padding: 4px 14px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--text-tertiary);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        text-transform: capitalize;
        transition: all 0.15s ease;
    }

    .species-tab-btn:hover {
        color: var(--text-secondary);
    }

    .species-tab-btn.active {
        background: var(--bg-primary);
        color: var(--text-primary);
        box-shadow: var(--shadow-sm);
    }

    .count {
        margin-left: auto;
        font-size: 11px;
        color: var(--text-muted);
    }

    .table-scroll {
        flex: 1;
        overflow: auto;
        padding: 12px 16px 16px;
    }

    .stable-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
        background: var(--bg-primary);
        border: 1px solid var(--border-primary);
        border-radius: 6px;
        overflow: hidden;
    }

    .stable-table th,
    .stable-table td {
        padding: 6px 10px;
        text-align: left;
        border-bottom: 1px solid var(--border-primary);
        white-space: nowrap;
    }

    .stable-table th.numeric,
    .stable-table td.numeric {
        text-align: right;
    }

    .stable-table th.compact,
    .stable-table td.compact {
        padding-left: 6px;
        padding-right: 6px;
        text-align: center;
        width: 1%; /* shrink-to-fit */
    }

    .stable-table th.compact {
        font-size: 11px;
        letter-spacing: 0.2px;
    }

    .stable-table td.compact {
        font-variant-numeric: tabular-nums;
    }

    .stable-table thead th {
        background: var(--bg-tertiary);
        font-weight: 600;
        color: var(--text-secondary);
        position: sticky;
        top: 0;
        z-index: 1;
    }

    .stable-table th.active-sort {
        color: var(--accent-text);
    }

    .header-sort-btn {
        background: none;
        border: none;
        padding: 0;
        margin: 0;
        font: inherit;
        color: inherit;
        cursor: pointer;
        width: 100%;
        text-align: inherit;
    }

    .header-sort-btn:hover {
        color: var(--accent-text);
    }

    .stable-table tbody tr:hover {
        background: var(--bg-secondary);
    }

    .empty {
        padding: 24px;
        text-align: center;
        color: var(--text-muted);
        font-style: italic;
    }

    .header-static {
        color: var(--text-secondary);
    }

    .row-actions {
        display: flex;
        gap: 2px;
        justify-content: flex-start;
    }

    .row-action-btn {
        width: 24px;
        height: 24px;
        padding: 0;
        border: 1px solid transparent;
        border-radius: 4px;
        background: transparent;
        color: var(--text-tertiary);
        font-size: 12px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
    }

    .row-action-btn:hover {
        background: var(--bg-selected);
        border-color: var(--accent-soft);
        color: var(--accent-text);
    }

    .row-action-btn.active {
        background: var(--accent);
        border-color: var(--accent);
        color: var(--bg-primary);
    }

    .bulk-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-left: auto;
    }

    .bulk-count {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-secondary);
    }

    .bulk-share-btn {
        padding: 6px 14px;
        background: var(--accent);
        border: none;
        border-radius: 6px;
        color: white;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease;
    }

    .bulk-share-btn:hover {
        background: var(--accent-hover);
    }

    .bulk-clear-btn {
        padding: 6px 10px;
        background: transparent;
        border: 1px solid var(--border-primary);
        border-radius: 6px;
        color: var(--text-tertiary);
        font-size: 12px;
        cursor: pointer;
    }

    .bulk-clear-btn:hover {
        color: var(--text-secondary);
        border-color: var(--border-secondary);
    }

    /* When bulk-actions takes the right slot, Compare follows it rather than
       grabbing the auto margin. */
    .bulk-actions ~ .compare-now-btn {
        margin-left: 0;
    }

    .share-status {
        padding: 8px 16px 0;
        flex-shrink: 0;
    }

    .select-col {
        width: 1%;
        text-align: center;
        padding-left: 10px;
        padding-right: 4px;
    }

    .row-select {
        cursor: pointer;
        margin: 0;
    }

    .stable-table tbody tr.row-selected {
        background: var(--bg-selected);
    }

    .compare-now-btn {
        padding: 6px 14px;
        background: var(--accent);
        border: none;
        border-radius: 6px;
        color: white;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease;
    }

    .compare-now-btn:hover {
        background: var(--accent-hover);
    }

    .filter-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        border-bottom: 1px solid var(--border-primary);
        background: var(--bg-primary);
        flex-shrink: 0;
    }

    .filter-search {
        flex: 0 1 220px;
        padding: 6px 10px;
        border: 1px solid var(--border-primary);
        border-radius: 6px;
        background: var(--bg-secondary);
        color: var(--text-primary);
        font-size: 12px;
        outline: none;
    }

    .filter-search:focus {
        border-color: var(--accent);
        background: var(--bg-primary);
    }

    .filter-select-label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: var(--text-tertiary);
    }

    .filter-select {
        padding: 4px 8px;
        border: 1px solid var(--border-primary);
        border-radius: 6px;
        background: var(--bg-secondary);
        color: var(--text-primary);
        font-size: 12px;
        cursor: pointer;
    }

    .filter-pill {
        padding: 3px 10px;
        border: 1px solid var(--border-primary);
        border-radius: 10px;
        background: var(--bg-primary);
        color: var(--text-tertiary);
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .filter-pill:hover {
        border-color: var(--accent);
        color: var(--accent-text);
    }

    .filter-pill.active {
        background: var(--accent);
        border-color: var(--accent);
        color: var(--bg-primary);
    }

    .filter-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }
</style>
