<script lang="ts">
/**
 * The Library — the redesign's persistent pet list. One filter bar + one pet
 * row, in card or table density, with multi-select that drives the Workspace.
 * Replaces the Pets sidebar and the Stable filters. Behind the redesign flag
 * until cutover. See docs/design/redesign-library-workspace-v1.md.
 */
import FilterBar from '$lib/components/shared/FilterBar.svelte';
import PetRow from '$lib/components/shared/PetRow.svelte';
import { getSupportedSpecies, normalizeSpecies } from '$lib/services/configService.js';
import { clearLibrarySelection, libraryView, toggleLibrarySelection } from '$lib/stores/library.svelte.js';
import { pets } from '$lib/stores/pets.js';
import { HORSE_BREEDS, type Pet } from '$lib/types/index.js';
import { filterPets } from '$lib/utils/petFilter.js';
import { getSpeciesEmoji } from '$lib/utils/species.js';

const speciesOptions = getSupportedSpecies();

// Breed maps per species. Horse has canonical abbreviations; beewasp's
// sub-types are their own labels (no invented abbreviations).
const BREEDS_BY_SPECIES: Record<string, Record<string, string>> = {
  beewasp: { Bee: 'Bee', Wasp: 'Wasp' },
  horse: HORSE_BREEDS,
};

// Breed filtering only makes sense within a single species.
const breedsForSpecies = $derived(libraryView.species ? BREEDS_BY_SPECIES[libraryView.species] : undefined);

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

const flags = $derived([
  { key: 'starred', label: '★ Starred', active: libraryView.starredOnly },
  { key: 'stabled', label: '🏠 Stabled', active: libraryView.stabledOnly },
  { key: 'petQuality', label: '🏆 Pet quality', active: libraryView.petQualityOnly },
]);

// A breed from another species no longer applies once the species changes.
$effect(() => {
  libraryView.species;
  if (libraryView.breed && (!breedsForSpecies || !(libraryView.breed in breedsForSpecies))) {
    libraryView.breed = '';
  }
});

// Clear the multi-selection when the species changes — pets selected under the
// old species would otherwise linger invisibly and still drive the Workspace
// (which resolves selection against the full pet list, not the filtered view).
// Tracks species only, so narrowing other filters (breed/flags) keeps the
// selection. Runs once on mount against an empty set (a no-op).
$effect(() => {
  libraryView.species;
  clearLibrarySelection();
});

function toggleFlag(key: string): void {
  if (key === 'starred') libraryView.starredOnly = !libraryView.starredOnly;
  else if (key === 'stabled') libraryView.stabledOnly = !libraryView.stabledOnly;
  else if (key === 'petQuality') libraryView.petQualityOnly = !libraryView.petQualityOnly;
}

function metaFor(pet: Pet): string {
  return [normalizeSpecies(pet.species), pet.breed || null, pet.gender].filter(Boolean).join(' · ');
}
</script>

<div class="library" data-testid="library">
  <div class="lib-head">
    <FilterBar
      search={libraryView.search}
      onSearch={(v) => { libraryView.search = v; }}
      species={speciesOptions}
      activeSpecies={libraryView.species}
      onSpecies={(v) => { libraryView.species = v; }}
      breeds={breedsForSpecies}
      breed={libraryView.breed}
      onBreed={(v) => { libraryView.breed = v; }}
      {flags}
      onToggleFlag={toggleFlag}
    />
    <div class="lib-subhead">
      <div class="density" role="group" aria-label="List density">
        <button
          type="button"
          class:active={libraryView.density === 'card'}
          aria-pressed={libraryView.density === 'card'}
          onclick={() => { libraryView.density = 'card'; }}
        >Cards</button>
        <button
          type="button"
          class:active={libraryView.density === 'table'}
          aria-pressed={libraryView.density === 'table'}
          onclick={() => { libraryView.density = 'table'; }}
        >Table</button>
      </div>
      <span class="lib-count" data-testid="library-count">{filtered.length} {filtered.length === 1 ? 'pet' : 'pets'}</span>
    </div>
  </div>

  <div class="lib-list" class:table={libraryView.density === 'table'} data-testid="library-list">
    {#if filtered.length === 0}
      <p class="lib-empty">No pets match these filters.</p>
    {:else}
      {#each filtered as pet (pet.id)}
        <PetRow
          name={pet.name ?? `Pet ${pet.id}`}
          avatar={getSpeciesEmoji(pet.species)}
          meta={metaFor(pet)}
          density={libraryView.density === 'table' ? 'row' : 'card'}
          selectable
          selected={libraryView.selectedIds.has(pet.id)}
          onActivate={() => toggleLibrarySelection(pet.id)}
          onToggleSelect={() => toggleLibrarySelection(pet.id)}
        >
          {#snippet trailing()}
            {#if pet.starred}<span class="lib-star" title="Starred">★</span>{/if}
          {/snippet}
        </PetRow>
      {/each}
    {/if}
  </div>

  {#if libraryView.selectedIds.size > 0}
    <div class="lib-foot" data-testid="library-foot">
      <span class="sel-count">{libraryView.selectedIds.size} selected</span>
      <button type="button" class="clear-btn" onclick={clearLibrarySelection}>Clear</button>
    </div>
  {/if}
</div>

<style>
  .library { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .lib-head { padding: 10px 12px; border-bottom: 1px solid var(--border-primary); display: flex; flex-direction: column; gap: 9px; }
  .lib-subhead { display: flex; align-items: center; justify-content: space-between; }

  .density { display: inline-flex; background: var(--bg-tertiary); border-radius: 7px; padding: 2px; }
  .density button {
    border: none; background: transparent; color: var(--text-tertiary);
    font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 5px; cursor: pointer;
  }
  .density button.active { background: var(--bg-primary); color: var(--text-primary); box-shadow: var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.06)); }
  .lib-count { font-size: 11px; color: var(--text-muted); }

  .lib-list { flex: 1; overflow: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .lib-list.table { padding: 0; gap: 0; }
  .lib-empty { color: var(--text-muted); font-size: 13px; text-align: center; padding: 24px; font-style: italic; }
  .lib-star { color: #f5a623; font-size: 13px; }

  .lib-foot {
    border-top: 1px solid var(--border-primary); padding: 9px 12px;
    display: flex; align-items: center; gap: 8px; background: var(--bg-secondary);
  }
  .sel-count { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
  .clear-btn {
    margin-left: auto; padding: 4px 10px; border: 1px solid var(--border-primary);
    border-radius: 6px; background: var(--bg-primary); color: var(--text-tertiary);
    font-size: 12px; font-weight: 600; cursor: pointer;
  }
  .clear-btn:hover { color: var(--text-secondary); }
</style>
