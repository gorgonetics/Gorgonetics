<script lang="ts">
/**
 * Community catalogue table. Mirrors the local My Pets roster: a sortable
 * matrix of Name / Species / Gender / Breed / the eight attribute columns /
 * Total / Uploaded. Clicking a row opens its full-view genome preview
 * (CommunityTab hosts the overlay, keyed on the store's `selectedHash`).
 *
 * Attribute cells are species-aware — each of the eight columns is filled
 * only for the attributes that apply to a row's species (Temperament for
 * horses, Ferocity for bees), blank otherwise. Legacy entries with no
 * published `attributes` map show "—" across the attribute columns.
 *
 * Sorting is client-side over the loaded pages (the catalogue is paged
 * server-side, newest-first); it re-orders what's on screen without
 * refetching.
 */
import StatusBanner from '$lib/components/shared/StatusBanner.svelte';
import StatusPane from '$lib/components/shared/StatusPane.svelte';
import { getAllAttributeNames } from '$lib/services/configService.js';
import { communityView, loadInitial, loadMore, selectPet } from '$lib/stores/community.svelte.js';
import type { SharedPet } from '$lib/types/index.js';
import { type SortableColumn, sortByColumn } from '$lib/utils/sortColumn.js';
import { formatShortDate } from '$lib/utils/timestamp.js';

/** The eight published attribute columns, in wire order, with short labels. */
const ATTR_COLUMNS = [
  { key: 'intelligence', label: 'Int' },
  { key: 'toughness', label: 'Tou' },
  { key: 'friendliness', label: 'Fri' },
  { key: 'ruggedness', label: 'Rug' },
  { key: 'enthusiasm', label: 'Ent' },
  { key: 'virility', label: 'Vir' },
  { key: 'ferocity', label: 'Fer' },
  { key: 'temperament', label: 'Tem' },
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
 * and fall back to `breeder` for older entries.
 */
function ownerName(pet: SharedPet): string {
  return pet.character || pet.breeder || '';
}

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

let sortCol = $state('uploaded');
let sortDir = $state<'asc' | 'desc'>('desc');

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
  const pets = communityView.pets;
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
            {#each ATTR_COLUMNS as col (col.key)}
              <th class="col-num" title={col.key}><button type="button" class="sort-btn" onclick={() => toggleSort(col.key)}>{col.label}{sortIndicator(col.key)}</button></th>
            {/each}
            <th class="col-num"><button type="button" class="sort-btn" onclick={() => toggleSort('total')}>Total{sortIndicator('total')}</button></th>
            <th class="col-num col-uploaded"><button type="button" class="sort-btn" onclick={() => toggleSort('uploaded')}>Uploaded{sortIndicator('uploaded')}</button></th>
          </tr>
        </thead>
        <tbody>
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
              {#each ATTR_COLUMNS as col (col.key)}
                {@const v = attrValue(pet, col.key)}
                <td role="gridcell" class="cell-num" class:muted={v === null}>{v ?? '—'}</td>
              {/each}
              <td role="gridcell" class="cell-num cell-total" class:muted={total === null}>{total ?? '—'}</td>
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

    <div class="table-footer">
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

  .table-scroll {
    flex: 1;
    overflow: auto;
    min-height: 0;
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
    justify-content: center;
    flex-shrink: 0;
  }

  .end-marker {
    font-size: 12px;
    color: var(--text-tertiary);
  }

  .load-more-btn {
    min-width: 160px;
  }
</style>
