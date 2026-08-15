<script lang="ts">
/**
 * Reference — the full-width gene-template editor. The animal-type / chromosome
 * pickers sit in a top toolbar (consistent with the other destinations' top
 * controls); the editing grid fills the area below. Replaces the old sidebar
 * GeneEditor + MasterPanel rail. See docs/design/redesign-library-workspace-v1.md (§9).
 */
import { onMount } from 'svelte';
import GeneEditingView from '$lib/components/GeneEditingView.svelte';
import GenomeMap from '$lib/components/gene/GenomeMap.svelte';
import BreedSelector from '$lib/components/shared/BreedSelector.svelte';
import EmptyState from '$lib/components/shared/EmptyState.svelte';
import { normalizeSpecies } from '$lib/services/configService.js';
import { petsForTier, type RarityTier } from '$lib/services/frequencyService.js';
import * as geneService from '$lib/services/geneService.js';
import { pets as allPets, appState, geneEditingView } from '$lib/stores/pets.js';
import { BREEDS_BY_SPECIES } from '$lib/utils/species.js';

const geneEdit = $derived($geneEditingView as { animalType?: string; chromosome?: string } | null);

let selectedAnimalType = $state('');
let selectedChromosome = $state('');
let animalTypes = $state<string[]>([]);
let chromosomes = $state<string[]>([]);
let loadingChromosomes = $state(false);
let editorError = $state('');

// --- Genome map (#368, design §7) -------------------------------------------
// Reference is map-first: the full-genome rarity map is the default, and the
// gene-template editor becomes a mode reached from the same toolbar. Editing is
// single-user functionality, so it is enough that the map does not strand it.
let editMode = $state(false);
let breedFilter = $state('');
let rarityPopulation = $state<RarityTier>('all');

const speciesKey = $derived(normalizeSpecies(selectedAnimalType));
const breedsForSpecies = $derived(speciesKey ? BREEDS_BY_SPECIES[speciesKey] : undefined);
const populationPets = $derived(petsForTier(rarityPopulation, $allPets));

// A breed only means something within its own species.
$effect(() => {
  const _key = speciesKey;
  breedFilter = '';
});
// Discards a stale chromosome fetch when the animal type changes again before
// the earlier request resolves (otherwise the slower, older response wins).
let chromosomeSeq = 0;

onMount(async () => {
  try {
    animalTypes = await geneService.getAnimalTypes();
  } catch (err: unknown) {
    console.error('Failed to load animal types:', err);
    editorError = 'Failed to load animal types';
  }
});

async function loadChromosomes(): Promise<void> {
  if (!selectedAnimalType) return;
  const mine = ++chromosomeSeq;
  const animalType = selectedAnimalType;
  try {
    loadingChromosomes = true;
    editorError = '';
    const result = await geneService.getChromosomes(animalType);
    if (mine !== chromosomeSeq) return; // a newer animal-type load superseded us
    chromosomes = result;
    selectedChromosome = '';
    appState.clearGeneEditingView();
  } catch (err: unknown) {
    if (mine !== chromosomeSeq) return;
    console.error('Failed to load chromosomes:', err);
    editorError = 'Failed to load chromosomes';
  } finally {
    if (mine === chromosomeSeq) loadingChromosomes = false;
  }
}

function openGeneEditor(): void {
  if (!selectedAnimalType || !selectedChromosome) return;
  try {
    appState.setGeneEditingView({ animalType: selectedAnimalType, chromosome: selectedChromosome });
  } catch (err) {
    console.error('Failed to open gene editor:', err);
    editorError = 'Failed to open gene editor';
  }
}

// Reload chromosomes whenever the animal type changes.
$effect(() => {
  if (selectedAnimalType) loadChromosomes();
});
</script>

<div class="reference" data-testid="reference-view">
  <!-- Heading landmark for screen readers; the visible title was dropped as a
       redundant repeat of the nav tab (its description is the tab's tooltip). -->
  <h2 class="sr-only">Reference</h2>
  <div class="ref-toolbar">
    <label class="ref-field">
      <span>Animal type</span>
      <select id="animalType" bind:value={selectedAnimalType} disabled={loadingChromosomes}>
        <option value="">Select…</option>
        {#each animalTypes as type (type)}
          <option value={type}>{type}</option>
        {/each}
      </select>
    </label>
    {#if editMode}
      <label class="ref-field">
        <span>Chromosome</span>
        <select id="chromosome" bind:value={selectedChromosome} disabled={loadingChromosomes || !selectedAnimalType}>
          <option value="">Select…</option>
          {#each chromosomes as chromosome (chromosome)}
            <option value={chromosome}>{chromosome}</option>
          {/each}
        </select>
      </label>
      <button
        class="load-btn"
        onclick={openGeneEditor}
        disabled={!selectedAnimalType || !selectedChromosome || loadingChromosomes}
      >
        {loadingChromosomes ? 'Loading…' : 'Edit Genes'}
      </button>
    {:else}
      {#if breedsForSpecies}
        <label class="ref-field">
          <span>Breed</span>
          <BreedSelector value={breedFilter} breeds={breedsForSpecies} onChange={(b) => { breedFilter = b; }} />
        </label>
      {/if}
      <div class="ref-field">
        <span>Baseline</span>
        <div class="seg" role="group" aria-label="Rarity baseline">
          <button
            class="seg-btn"
            class:active={rarityPopulation === 'stabled'}
            data-testid="map-pop-stabled"
            onclick={() => { rarityPopulation = 'stabled'; }}
          >Stabled</button>
          <button
            class="seg-btn"
            class:active={rarityPopulation === 'all'}
            data-testid="map-pop-all"
            onclick={() => { rarityPopulation = 'all'; }}
          >All my pets</button>
          <button class="seg-btn" disabled title="Needs a shared aggregate — not yet available">Community · soon</button>
        </div>
      </div>
    {/if}
    <button
      class="edit-toggle"
      class:active={editMode}
      aria-pressed={editMode}
      data-testid="reference-edit-toggle"
      title="Edit gene templates for a chromosome"
      onclick={() => { editMode = !editMode; if (!editMode) appState.clearGeneEditingView(); }}
    >
      Edit
    </button>
    {#if editorError}
      <span class="ref-error"><span aria-hidden="true">⚠️</span> {editorError}</span>
    {/if}
  </div>

  <div class="ref-body" class:ref-body-map={!editMode}>
    {#if editMode}
      {#if $geneEditingView}
        <GeneEditingView animalType={geneEdit?.animalType} chromosome={geneEdit?.chromosome} />
      {:else}
        <EmptyState
          icon="📚"
          title="Edit gene templates"
          body="Pick an animal type and chromosome above, then choose Edit Genes."
        />
      {/if}
    {:else if selectedAnimalType}
      <GenomeMap species={selectedAnimalType} {populationPets} {breedFilter} />
    {:else}
      <EmptyState
        icon="🧬"
        title="Genome map"
        body="Pick an animal type above to see how rare each gene value is across your pets."
      />
    {/if}
  </div>
</div>

<style>
  .reference { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .ref-toolbar {
    display: flex; align-items: flex-end; gap: var(--space-lg); flex-wrap: wrap;
    padding: var(--space-md) var(--space-xl); border-bottom: 1px solid var(--border-primary); flex-shrink: 0;
  }
  .ref-field { display: flex; flex-direction: column; gap: var(--space-2xs); font-size: 11px; font-weight: 600; color: var(--text-tertiary); }
  .ref-field select {
    padding: var(--space-xs) var(--space-sm); border: 1px solid var(--border-secondary); border-radius: 6px;
    font-size: 13px; background: var(--bg-primary); color: var(--text-primary); min-width: 160px;
  }
  .ref-field select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .ref-field select:disabled { background: var(--bg-secondary); color: var(--text-muted); }
  .load-btn {
    padding: 7px var(--space-xl); background: var(--accent); color: var(--text-inverse);
    border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  .load-btn:hover:not(:disabled) { filter: brightness(1.05); }
  .load-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .ref-error { font-size: 12px; color: var(--error-text); display: inline-flex; align-items: center; gap: var(--space-2xs); }
  .ref-body { flex: 1; min-height: 0; overflow: auto; padding: var(--space-xl) var(--space-2xl); }
  /* The map owns its own scrolling (its cell size is measured from that box),
     so the wrapper must not scroll or the two would fight. */
  .ref-body-map { overflow: hidden; display: flex; min-width: 0; }

  .edit-toggle {
    margin-left: auto; padding: 7px var(--space-xl); border: 1px solid var(--border-secondary);
    background: var(--bg-primary); color: var(--text-primary);
    border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  .edit-toggle:hover { background: var(--bg-secondary); }
  .edit-toggle.active { background: var(--accent); color: var(--text-inverse); border-color: var(--accent); }
</style>
