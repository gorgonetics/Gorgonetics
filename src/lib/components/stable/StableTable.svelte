<script>
import PetEditor from '$lib/components/pet/PetEditor.svelte';
import {
  getAllAttributeNames,
  getAllAttributes,
  getSupportedSpecies,
  normalizeSpecies,
} from '$lib/services/configService.js';
import { comparisonActions, comparisonPets, comparisonReady } from '$lib/stores/comparison.js';
import { allTags as allTagsStore, appState, pets } from '$lib/stores/pets.js';
import { stableView } from '$lib/stores/stable.svelte.js';
import { HORSE_BREEDS } from '$lib/types/index.js';

const SPECIES = getSupportedSpecies();

const BREEDS_BY_SPECIES = {
  beewasp: ['Bee', 'Wasp'],
  horse: Object.keys(HORSE_BREEDS),
};

let editingPet = $state(null);
let editorOpen = $state(false);

const comparisonIds = $derived(new Set([$comparisonPets[0]?.id, $comparisonPets[1]?.id].filter((id) => id != null)));

function viewPet(pet) {
  appState.selectPet(pet);
  appState.switchTab('pets');
}

function openEditor(pet) {
  editingPet = pet;
  editorOpen = true;
}

function closeEditor() {
  editorOpen = false;
  editingPet = null;
}

function toggleCompare(pet) {
  if (comparisonIds.has(pet.id)) comparisonActions.removePet(pet.id);
  else comparisonActions.addPet(pet);
}

function startCompare() {
  appState.switchTab('compare');
}

/**
 * Build the column list for the currently selected species. Species-specific
 * attribute columns (temperament / ferocity) appear only for the species they
 * belong to; Breed is a shared column that may be blank on species that don't
 * use it yet.
 */
function buildColumns(species) {
  const attrConfig = getAllAttributes(species);
  const attrNames = getAllAttributeNames(species);
  const attrCols = attrNames.map((attr) => {
    const info = attrConfig[attr];
    return {
      id: attr,
      label: info?.name ?? attr,
      title: info?.name ?? attr,
      accessor: (pet) => pet[attr] ?? 0,
      numeric: true,
      compact: true,
      sortable: true,
    };
  });

  const attrTotal = (pet) => attrNames.reduce((sum, attr) => sum + (pet[attr] ?? 0), 0);

  return [
    { id: 'actions', label: 'Actions', accessor: () => '', numeric: false, sortable: false },
    { id: 'name', label: 'Name', accessor: (pet) => pet.name ?? '', numeric: false, sortable: true },
    { id: 'gender', label: 'Gender', accessor: (pet) => pet.gender ?? '', numeric: false, sortable: true },
    { id: 'breed', label: 'Breed', accessor: (pet) => pet.breed ?? '', numeric: false, sortable: true },
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
      accessor: (pet) => pet.positive_genes ?? 0,
      numeric: true,
      sortable: true,
    },
  ];
}

const columns = $derived(buildColumns(stableView.species));

const breedOptions = $derived(BREEDS_BY_SPECIES[stableView.species] ?? []);
const availableTags = $derived($allTagsStore);

const filteredPets = $derived.by(() => {
  const q = stableView.search.trim().toLowerCase();
  const tagSet = new Set(stableView.tags);
  return $pets.filter((pet) => {
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

function toggleTagFilter(tag) {
  if (stableView.tags.includes(tag)) {
    stableView.tags = stableView.tags.filter((t) => t !== tag);
  } else {
    stableView.tags = [...stableView.tags, tag];
  }
}

const sortedPets = $derived.by(() => {
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

function toggleSort(colId) {
  const col = columns.find((c) => c.id === colId);
  if (!col || col.sortable === false) return;
  if (stableView.sortCol === colId) {
    stableView.sortDir = stableView.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    stableView.sortCol = colId;
    stableView.sortDir = 'asc';
  }
}

function sortIndicator(colId) {
  if (colId !== stableView.sortCol) return '';
  return stableView.sortDir === 'asc' ? ' ▲' : ' ▼';
}
</script>

<div class="stable-view" data-testid="stable-view">
    <header class="stable-header">
        <h2 class="stable-title">Stable</h2>
        <div class="species-tabs" role="tablist" aria-label="Species">
            {#each SPECIES as species}
                <button
                    class="species-tab-btn"
                    class:active={stableView.species === species}
                    role="tab"
                    aria-selected={stableView.species === species}
                    data-species={species}
                    onclick={() => { stableView.species = species; }}
                >
                    {species}
                </button>
            {/each}
        </div>
        <span class="count">{sortedPets.length} stabled</span>
        {#if $comparisonReady}
            <button class="compare-now-btn" onclick={startCompare} title="Open comparison view">
                ⚖️ Compare ({[$comparisonPets[0]?.name, $comparisonPets[1]?.name].filter(Boolean).join(' vs ')})
            </button>
        {/if}
    </header>

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
                        <td class="empty" colspan={columns.length}>
                            No stabled {stableView.species} pets.
                        </td>
                    </tr>
                {:else}
                    {#each sortedPets as pet (pet.id)}
                        <tr data-pet-id={pet.id}>
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
                                                class:active={comparisonIds.has(pet.id)}
                                                title={comparisonIds.has(pet.id) ? 'Remove from comparison' : 'Add to comparison'}
                                                aria-label="Toggle comparison selection for {pet.name}"
                                                aria-pressed={comparisonIds.has(pet.id)}
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
