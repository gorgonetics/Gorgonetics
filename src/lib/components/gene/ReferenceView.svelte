<script lang="ts">
/**
 * Reference — the full-width gene-template editor. The animal-type / chromosome
 * pickers sit in a top toolbar (consistent with the other destinations' top
 * controls); the editing grid fills the area below. Replaces the old sidebar
 * GeneEditor + MasterPanel rail. See docs/design/redesign-library-workspace-v1.md (§9).
 */
import { onMount } from 'svelte';
import GeneEditingView from '$lib/components/GeneEditingView.svelte';
import EmptyState from '$lib/components/shared/EmptyState.svelte';
import * as geneService from '$lib/services/geneService.js';
import { appState, geneEditingView } from '$lib/stores/pets.js';

const geneEdit = $derived($geneEditingView as { animalType?: string; chromosome?: string } | null);

let selectedAnimalType = $state('');
let selectedChromosome = $state('');
let animalTypes = $state<string[]>([]);
let chromosomes = $state<string[]>([]);
let loadingChromosomes = $state(false);
let editorError = $state('');
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
    {#if editorError}
      <span class="ref-error"><span aria-hidden="true">⚠️</span> {editorError}</span>
    {/if}
  </div>

  <div class="ref-body">
    {#if $geneEditingView}
      <GeneEditingView animalType={geneEdit?.animalType} chromosome={geneEdit?.chromosome} />
    {:else}
      <EmptyState
        icon="📚"
        title="Edit gene templates"
        body="Pick an animal type and chromosome above, then choose Edit Genes."
      />
    {/if}
  </div>
</div>

<style>
  .reference { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .ref-toolbar {
    display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap;
    padding: 0 20px 12px; border-bottom: 1px solid var(--border-primary); flex-shrink: 0;
  }
  .ref-field { display: flex; flex-direction: column; gap: 4px; font-size: 11px; font-weight: 600; color: var(--text-tertiary); }
  .ref-field select {
    padding: 6px 8px; border: 1px solid var(--border-secondary); border-radius: 6px;
    font-size: 13px; background: var(--bg-primary); color: var(--text-primary); min-width: 160px;
  }
  .ref-field select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .ref-field select:disabled { background: var(--bg-secondary); color: var(--text-muted); }
  .load-btn {
    padding: 7px 16px; background: var(--accent); color: var(--text-inverse);
    border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  .load-btn:hover:not(:disabled) { filter: brightness(1.05); }
  .load-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .ref-error { font-size: 12px; color: var(--error-text); display: inline-flex; align-items: center; gap: 4px; }
  .ref-body { flex: 1; min-height: 0; overflow: auto; padding: 16px 20px; }
</style>
