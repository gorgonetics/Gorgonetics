<script lang="ts">
/**
 * Community catalogue table. Mirrors the local My Pets roster: a shared
 * FilterBar (search / species / breed / gender / tags) over a sortable
 * matrix of Name / Owner / Species / Gender / Breed / attribute columns /
 * Total / Uploaded. Clicking a row opens its full-view genome preview
 * (CommunityTab hosts the overlay, keyed on the store's `selectedHash`).
 *
 * Filtering is client-side over the LOADED pages only (#397) — the
 * catalogue is cursor-paginated 50/page, so entries not yet loaded are
 * not searched. The footer says so whenever filters are active and more
 * pages remain, and "Load more" stays available to widen the searched
 * set. Match semantics live in `sharedPetFilter.ts`, kept pure so a
 * future server-side pass can reuse/replace them in one place.
 *
 * Attribute columns are species-aware — a column is filled only for the
 * attributes that apply to a row's species (Temperament for horses,
 * Ferocity for bees). A column that is empty for EVERY loaded row (e.g.
 * an all-legacy catalogue with no published `attributes`) is hidden
 * entirely instead of rendering a dash per row; visibility is computed
 * over the loaded set, not the filtered subset, so columns don't pop in
 * and out as filters change.
 *
 * Sorting is client-side over the filtered rows; it re-orders what's on
 * screen without refetching.
 */
import FilterBar from '$lib/components/shared/FilterBar.svelte';
import StatusBanner from '$lib/components/shared/StatusBanner.svelte';
import StatusPane from '$lib/components/shared/StatusPane.svelte';
import { getAllAttributeNames, getSupportedSpecies } from '$lib/services/configService.js';
import { communityView, loadInitial, loadMore, selectPet } from '$lib/stores/community.svelte.js';
import { type Gender, HORSE_BREEDS, type SharedPet } from '$lib/types/index.js';
import { filterSharedPets, sharedPetOwner } from '$lib/utils/sharedPetFilter.js';
import { type SortableColumn, sortByColumn } from '$lib/utils/sortColumn.js';
import { formatShortDate } from '$lib/utils/timestamp.js';

/**
 * The eight published attribute columns, in wire order. Full names, not
 * abbreviations — matches the My Pets roster's header naming (Roster
 * labels attribute columns with the config's full display names).
 */
const ATTR_COLUMNS = [
  { key: 'intelligence', label: 'Intelligence' },
  { key: 'toughness', label: 'Toughness' },
  { key: 'friendliness', label: 'Friendliness' },
  { key: 'ruggedness', label: 'Ruggedness' },
  { key: 'enthusiasm', label: 'Enthusiasm' },
  { key: 'virility', label: 'Virility' },
  { key: 'ferocity', label: 'Ferocity' },
  { key: 'temperament', label: 'Temperament' },
] as const;

// Which of the eight attributes apply to a given species — cached per
// species string so we don't recompute for every cell/row.
const speciesAttrCache = new Map<string, Set<string>>();
function attrsForSpecies(species: string): Set<string> {
  let set = speciesAttrCache.get(species);
  if (!set) {
    set = new Set(getAllAttributeNames(species).map((a) => a.toLowerCase()));
    speciesAttrCache.set(species, set);
  }
  return set;
}

function attrApplies(pet: SharedPet, key: string): boolean {
  return attrsForSpecies(pet.species).has(key);
}

/**
 * The owner/sharer — the genome's in-game `Character=` name. The share
 * payload stores it in both `character` and `breeder`; prefer `character`
 * and fall back to `breeder` for older entries. Shared with the filter
 * predicate so search matches exactly what the Owner column shows.
 */
const ownerName = sharedPetOwner;

/** Cell value for an attribute, or null when it doesn't apply / is absent. */
function attrValue(pet: SharedPet, key: string): number | null {
  if (!pet.attributes || !attrApplies(pet, key)) return null;
  const v = pet.attributes[key];
  return typeof v === 'number' ? v : null;
}

/** Sum of the applicable published attributes, or null for legacy entries. */
function attrTotal(pet: SharedPet): number | null {
  if (!pet.attributes) return null;
  let sum = 0;
  for (const { key } of ATTR_COLUMNS) {
    const v = attrValue(pet, key);
    if (v !== null) sum += v;
  }
  return sum;
}

// --- Filters (#397) ---------------------------------------------------------
// Component-local state, mirroring the vocabulary MyPets feeds the same
// FilterBar. The tab content stays mounted (covered/inert) across tab
// switches, so these survive navigation within a session.
const speciesOptions = getSupportedSpecies();
const BREEDS_BY_SPECIES: Record<string, Record<string, string>> = {
  beewasp: { Bee: 'Bee', Wasp: 'Wasp' },
  horse: HORSE_BREEDS,
};

let search = $state('');
let speciesFilter = $state('');
let breedFilter = $state('');
let genderFilter = $state<Gender | ''>('');
let tagFilters = $state<string[]>([]);

const breedsForSpecies = $derived(speciesFilter ? BREEDS_BY_SPECIES[speciesFilter] : undefined);

// Switching species changes the breed universe — drop a breed that no
// longer belongs to it (same rule MyPets applies).
$effect(() => {
  if (breedFilter && (!breedsForSpecies || !(breedFilter in breedsForSpecies))) {
    breedFilter = '';
  }
});

// Tag pills are offered from whatever the loaded entries actually carry.
const tagOptions = $derived.by(() => {
  const set = new Set<string>();
  for (const pet of communityView.pets) for (const t of pet.tags) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
});

// A tag filter can outlive the tags visible in the loaded set (e.g. a
// forced refresh replaced the page) — prune it so an invisible pill can't
// silently keep filtering.
$effect(() => {
  if (tagFilters.length > 0 && !tagFilters.every((t) => tagOptions.includes(t))) {
    tagFilters = tagFilters.filter((t) => tagOptions.includes(t));
  }
});

function toggleTag(tag: string): void {
  tagFilters = tagFilters.includes(tag) ? tagFilters.filter((t) => t !== tag) : [...tagFilters, tag];
}

const filtersActive = $derived(
  search !== '' || speciesFilter !== '' || breedFilter !== '' || genderFilter !== '' || tagFilters.length > 0,
);

const filtered = $derived(
  filterSharedPets(communityView.pets, {
    query: search,
    species: speciesFilter,
    breed: breedFilter,
    gender: genderFilter,
    tags: tagFilters,
  }),
);

// --- Column visibility (#397) ------------------------------------------------
// Hide attribute columns that are empty for EVERY loaded row (legacy
// entries with no published attributes, or attributes that apply to no
// loaded species). Computed over the loaded set — not the filtered
// subset — so columns stay put while the user types.
const visibleAttrCols = $derived(
  ATTR_COLUMNS.filter((col) => communityView.pets.some((p) => attrValue(p, col.key) !== null)),
);
const showTotal = $derived(communityView.pets.some((p) => attrTotal(p) !== null));
const columnCount = $derived(5 + visibleAttrCols.length + (showTotal ? 1 : 0) + 1);

// --- Sorting ------------------------------------------------------------------
let sortCol = $state('uploaded');
let sortDir = $state<'asc' | 'desc'>('desc');

// If the sorted column disappears (a forced refresh can shrink the loaded
// set and hide its column), fall back to the default order rather than
// silently sorting by an invisible column.
$effect(() => {
  const valid = new Set<string>(['name', 'owner', 'species', 'gender', 'breed', 'uploaded']);
  for (const col of visibleAttrCols) valid.add(col.key);
  if (showTotal) valid.add('total');
  if (!valid.has(sortCol)) {
    sortCol = 'uploaded';
    sortDir = 'desc';
  }
});

function toggleSort(col: string): void {
  if (sortCol === col) {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    sortCol = col;
    // Text columns read most naturally ascending; numeric/date descending.
    sortDir = ['name', 'owner', 'species', 'gender', 'breed'].includes(col) ? 'asc' : 'desc';
  }
}

function sortIndicator(col: string): string {
  if (col !== sortCol) return '';
  return sortDir === 'asc' ? ' ▲' : ' ▼';
}

const sorted = $derived.by(() => {
  const pets = filtered;
  let column: SortableColumn<SharedPet>;
  if (sortCol === 'name') column = { numeric: false, accessor: (p) => p.name || '' };
  else if (sortCol === 'owner') column = { numeric: false, accessor: ownerName };
  else if (sortCol === 'species') column = { numeric: false, accessor: (p) => p.species || '' };
  else if (sortCol === 'gender') column = { numeric: false, accessor: (p) => p.gender || '' };
  else if (sortCol === 'breed') column = { numeric: false, accessor: (p) => p.breed || '' };
  else if (sortCol === 'uploaded') column = { numeric: true, accessor: (p) => p.uploadedAt.getTime() };
  else if (sortCol === 'total') column = { numeric: true, accessor: (p) => attrTotal(p) ?? -1 };
  else column = { numeric: true, accessor: (p) => attrValue(p, sortCol) ?? -1 };
  return sortByColumn(pets, column, sortDir);
});

function handleKey(e: KeyboardEvent, hash: string): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    selectPet(hash);
  }
}
</script>

<div class="community-table" data-testid="community-table">
  {#if communityView.loading && communityView.pets.length === 0}
    <div data-testid="community-loading">
      <StatusPane variant="loading" body="Loading catalogue…" />
    </div>
  {:else if communityView.error && communityView.pets.length === 0}
    <div data-testid="community-error">
      <StatusPane
        variant="error"
        body={communityView.error}
        actionLabel="Try again"
        onAction={() => loadInitial({ force: true })}
      />
    </div>
  {:else if communityView.pets.length === 0}
    <div data-testid="community-empty">
      <StatusPane variant="empty" body="The catalogue is empty — be the first to share a pet." />
    </div>
  {:else}
    <div class="ct-filter">
      <FilterBar
        {search}
        onSearch={(v) => { search = v; }}
        searchPlaceholder="Search name, owner, species…"
        species={speciesOptions}
        activeSpecies={speciesFilter}
        onSpecies={(v) => { speciesFilter = v; }}
        breeds={breedsForSpecies}
        breed={breedFilter}
        onBreed={(v) => { breedFilter = v; }}
        genders={['Male', 'Female']}
        activeGender={genderFilter}
        onGender={(v) => { genderFilter = v as Gender | ''; }}
        {tagOptions}
        activeTags={tagFilters}
        onToggleTag={toggleTag}
      />
    </div>

    <div class="table-scroll">
      <!--
        `role="grid"` upgrades the table from a passive layout to an
        interactive selection widget — pairs with `aria-selected` on each
        row + `role="gridcell"` on each cell so screen readers announce row
        navigation + selection state.
      -->
      <table role="grid" aria-label="Community pet catalogue">
        <thead>
          <tr>
            <th class="col-text"><button type="button" class="sort-btn" onclick={() => toggleSort('name')}>Name{sortIndicator('name')}</button></th>
            <th class="col-text"><button type="button" class="sort-btn" onclick={() => toggleSort('owner')}>Owner{sortIndicator('owner')}</button></th>
            <th class="col-text"><button type="button" class="sort-btn" onclick={() => toggleSort('species')}>Species{sortIndicator('species')}</button></th>
            <th class="col-text"><button type="button" class="sort-btn" onclick={() => toggleSort('gender')}>Gender{sortIndicator('gender')}</button></th>
            <th class="col-text"><button type="button" class="sort-btn" onclick={() => toggleSort('breed')}>Breed{sortIndicator('breed')}</button></th>
            {#each visibleAttrCols as col (col.key)}
              <th class="col-num"><button type="button" class="sort-btn" onclick={() => toggleSort(col.key)}>{col.label}{sortIndicator(col.key)}</button></th>
            {/each}
            {#if showTotal}
              <th class="col-num"><button type="button" class="sort-btn" onclick={() => toggleSort('total')}>Total{sortIndicator('total')}</button></th>
            {/if}
            <th class="col-num col-uploaded"><button type="button" class="sort-btn" onclick={() => toggleSort('uploaded')}>Uploaded{sortIndicator('uploaded')}</button></th>
          </tr>
        </thead>
        <tbody>
          {#if sorted.length === 0}
            <tr>
              <td class="filter-empty" colspan={columnCount} data-testid="community-filter-empty">
                No loaded pets match these filters.
                {#if communityView.hasMore}Load more to search older entries.{/if}
              </td>
            </tr>
          {/if}
          {#each sorted as pet (pet.contentHash)}
            {@const selected = pet.contentHash === communityView.selectedHash}
            {@const total = attrTotal(pet)}
            <tr
              class="row"
              class:selected
              data-testid="community-row"
              data-content-hash={pet.contentHash}
              tabindex="0"
              aria-selected={selected}
              onclick={() => selectPet(pet.contentHash)}
              onkeydown={(e) => handleKey(e, pet.contentHash)}
            >
              <td role="gridcell" class="cell-name">{pet.name || '(unnamed)'}</td>
              <td role="gridcell" class="cell-text">{ownerName(pet) || '—'}</td>
              <td role="gridcell" class="cell-text">{pet.species || '—'}</td>
              <td role="gridcell" class="cell-text">{pet.gender || '—'}</td>
              <td role="gridcell" class="cell-text">{pet.breed || '—'}</td>
              {#each visibleAttrCols as col (col.key)}
                {@const v = attrValue(pet, col.key)}
                <td role="gridcell" class="cell-num" class:muted={v === null}>{v ?? '—'}</td>
              {/each}
              {#if showTotal}
                <td role="gridcell" class="cell-num cell-total" class:muted={total === null}>{total ?? '—'}</td>
              {/if}
              <td role="gridcell" class="cell-num cell-uploaded">{formatShortDate(pet.uploadedAt)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if communityView.error}
      <div data-testid="community-loadmore-error">
        <StatusBanner type="error" message={communityView.error} />
      </div>
    {/if}

    <!--
      Honest counts under filtering + pagination: the filter only sees the
      loaded pages, so while more pages remain the count is labelled "of N
      loaded" and "Load more" stays visible — loading more both extends the
      catalogue AND widens the searched set.
    -->
    <div class="table-footer">
      {#if filtersActive}
        <span class="filter-count" data-testid="community-filter-count">
          {sorted.length} of {communityView.pets.length} loaded
          {communityView.pets.length === 1 ? 'pet' : 'pets'} match{#if communityView.hasMore}
            &nbsp;· older entries not loaded yet{/if}
        </span>
      {/if}
      {#if communityView.hasMore}
        <button
          class="btn btn-secondary load-more-btn"
          data-testid="community-load-more"
          onclick={loadMore}
          disabled={communityView.loadingMore || communityView.loading}
        >
          {communityView.loadingMore ? 'Loading…' : 'Load more'}
        </button>
      {:else}
        <span class="end-marker">
          End of catalogue · {communityView.pets.length}
          {communityView.pets.length === 1 ? 'pet' : 'pets'}
        </span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .community-table {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .ct-filter {
    padding: 10px 16px;
    border-bottom: 1px solid var(--border-primary);
    flex-shrink: 0;
  }

  .table-scroll {
    flex: 1;
    overflow: auto;
    min-height: 0;
  }

  .filter-empty {
    text-align: center;
    color: var(--text-muted);
    font-style: italic;
    padding: 24px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  thead {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--bg-tertiary);
  }

  th {
    text-align: left;
    padding: 6px 10px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    border-bottom: 1px solid var(--border-primary);
    white-space: nowrap;
  }

  th.col-num {
    text-align: right;
  }

  .col-uploaded {
    white-space: nowrap;
  }

  .sort-btn {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }

  .sort-btn:hover {
    color: var(--accent-text, var(--accent));
  }

  .row {
    cursor: pointer;
    transition: background 0.1s ease;
  }
  .row:hover {
    background: var(--bg-hover, var(--bg-secondary));
  }
  .row.selected {
    background: var(--bg-selected);
  }
  .row:focus-visible {
    outline: 2px solid var(--accent-text);
    outline-offset: -2px;
  }

  td {
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-primary);
    vertical-align: middle;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .cell-name {
    font-weight: 600;
  }
  .cell-text {
    color: var(--text-secondary);
  }
  .cell-num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .cell-total {
    font-weight: 600;
  }
  .cell-uploaded {
    color: var(--text-tertiary);
  }
  .muted {
    color: var(--text-tertiary);
  }

  .table-footer {
    padding: 12px 16px;
    border-top: 1px solid var(--border-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    flex-shrink: 0;
  }

  .end-marker,
  .filter-count {
    font-size: 12px;
    color: var(--text-tertiary);
  }

  .load-more-btn {
    min-width: 160px;
  }
</style>
