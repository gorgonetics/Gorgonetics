<script lang="ts">
/**
 * Full-view genome preview for a community-catalogue pet. The local
 * counterpart is PetVisualization; this one drops the local-only actions
 * (Gallery / Share / Edit / Delete) and adds the catalogue metadata plus
 * the Import-to-stable action.
 *
 * The genome comes from the share blob, not `pet_genes`: the full
 * SharedPet (with `genomeData`) is lazy-fetched here via `getSharedPet`,
 * parsed into a grid with `genomeTextToGrid`, and handed to GeneVisualizer
 * through its `gridOverride` prop. A synthetic Pet (`sharedPetToPet`)
 * carries the species/breed/attributes the visualizer and stats table
 * read — it is never persisted.
 */
import GeneStatsTable from '$lib/components/gene/GeneStatsTable.svelte';
import GeneVisualizer from '$lib/components/gene/GeneVisualizer.svelte';
import BreedSelector from '$lib/components/shared/BreedSelector.svelte';
import StatusBanner from '$lib/components/shared/StatusBanner.svelte';
import { getSharedPet, type ImportResult } from '$lib/services/shareService.js';
import { communityView, importSelected } from '$lib/stores/community.svelte.js';
import { HORSE_BREEDS, type Pet, type SharedPet } from '$lib/types/index.js';
import { errorMessage } from '$lib/utils/error.js';
import type { StatsMap } from '$lib/utils/geneStats.js';
import { genomeTextToGrid } from '$lib/utils/genomeGrid.js';
import { keyedResource } from '$lib/utils/keyedResource.svelte.js';
import { sharedPetToPet } from '$lib/utils/sharedPet.js';
import { formatShortDate } from '$lib/utils/timestamp.js';

interface GeneVisualizerInstance {
  getStatsData(): {
    currentStats: StatsMap | null;
    currentView: string;
    selectedAttributes: string[];
    hiddenAttributes: string[];
    totalGenes: number;
    neutralGenes: number;
    petSpecies: string | undefined;
  };
  handleViewChange(view: string): void;
  handleAttributeFilter(event: CustomEvent<{ attribute: string; ctrlKey: boolean; altKey: boolean }>): void;
  setBreedFilter(breed: string): void;
}

interface Props {
  /** Metadata-only SharedPet from the catalogue list (no `genomeData`). */
  pet: SharedPet;
}

const { pet }: Props = $props();

// Lazy-fetch the full record (metadata + genome blob). The keyed resource
// rejects a stale result if the selection changes mid-fetch.
const genome = keyedResource(
  () => pet.contentHash,
  (hash) => getSharedPet(hash),
);
const genomeLoading = $derived(genome.loading);
const fullPet = $derived(genome.value?.genomeData ? genome.value : null);
const genomeError = $derived(
  genome.error
    ? errorMessage(genome.error)
    : genome.value && !genome.value.genomeData
      ? 'Genome data is missing for this pet — it may have been taken down.'
      : null,
);

const previewPet = $derived<Pet | null>(fullPet ? sharedPetToPet(fullPet) : null);
const grid = $derived(fullPet?.genomeData ? genomeTextToGrid(fullPet.genomeData) : null);

const isHorse = $derived(pet.species?.toLowerCase() === 'horse');

let geneVisualizerRef = $state<GeneVisualizerInstance | undefined>(undefined);
let currentView = $state('attribute');
let statsOpen = $state(false);
let stats = $state<ReturnType<GeneVisualizerInstance['getStatsData']> | null>(null);
let breedFilter = $state('');

// --- Import ---------------------------------------------------------------
const isImportingThis = $derived(communityView.importingHash === pet.contentHash);
const isAnyImportInFlight = $derived(communityView.importingHash !== null);
let importStatus = $state<ImportResult | null>(null);

// Reset the transient import banner when the selection changes.
$effect(() => {
  void pet.contentHash;
  importStatus = null;
});

async function handleImport(): Promise<void> {
  if (!fullPet) return;
  const startedHash = fullPet.contentHash;
  importStatus = null;
  const result = await importSelected(fullPet);
  if (pet.contentHash === startedHash) importStatus = result;
}

// --- View / stats ---------------------------------------------------------
function handleViewChange(view: string): void {
  currentView = view;
  geneVisualizerRef?.handleViewChange(view);
  refreshStats();
}

function toggleStats(): void {
  statsOpen = !statsOpen;
  if (statsOpen) refreshStats();
}

function refreshStats(): void {
  if (geneVisualizerRef) stats = geneVisualizerRef.getStatsData();
}

function handleStatsUpdated(): void {
  if (statsOpen) refreshStats();
}

function handleAttributeFilter(event: CustomEvent<{ attribute: string; ctrlKey: boolean; altKey: boolean }>): void {
  if (geneVisualizerRef?.handleAttributeFilter) {
    geneVisualizerRef.handleAttributeFilter(event);
    refreshStats();
  }
}

function handleBreedChange(fullName: string): void {
  breedFilter = fullName;
  geneVisualizerRef?.setBreedFilter(breedFilter);
}
</script>

<div class="pet-visualization" data-testid="community-detail">
  <div class="detail-header">
    <div class="detail-header-info">
      <div class="detail-meta">
        <span>{pet.species || 'Unknown'}</span>
        {#if pet.breed && pet.breed !== 'Mixed'}
          <span class="meta-dot">·</span>
          <span>{pet.breed}</span>
        {/if}
        <span class="meta-dot">·</span>
        <span>{pet.gender || 'Unknown'}</span>
        {#if pet.breeder}
          <span class="meta-dot">·</span>
          <span>by {pet.breeder}</span>
        {/if}
        <span class="meta-dot">·</span>
        <span>{formatShortDate(pet.uploadedAt)}</span>
      </div>
      {#if pet.tags.length > 0}
        <div class="detail-tags">
          {#each pet.tags as t (t)}
            <span class="tag-badge">{t}</span>
          {/each}
        </div>
      {/if}
    </div>
    <div class="header-controls">
      {#if isHorse}
        <BreedSelector value={breedFilter} breeds={HORSE_BREEDS} onChange={handleBreedChange} />
      {/if}
      <div class="view-controls" role="group" aria-label="Grid view">
        <button class="view-btn" class:active={currentView === 'attribute'} onclick={() => handleViewChange('attribute')}>Attributes</button>
        <button class="view-btn" class:active={currentView === 'appearance'} onclick={() => handleViewChange('appearance')}>Appearance</button>
      </div>
      <button
        class="toggle-btn"
        class:active={statsOpen}
        aria-pressed={statsOpen}
        data-testid="detail-stats-toggle"
        title="Toggle the stats side panel"
        onclick={toggleStats}
      >Stats</button>
      <div class="header-actions">
        <button
          class="import-btn"
          data-testid="community-import"
          onclick={handleImport}
          disabled={isAnyImportInFlight || !fullPet}
          title={fullPet
            ? isAnyImportInFlight && !isImportingThis
              ? 'Another import is already running'
              : 'Import to my stable'
            : genomeError
              ? "Can't import — the genome failed to load"
              : 'Waiting for genome to load…'}
        >
          {isImportingThis ? 'Importing…' : '⬇ Import'}
        </button>
      </div>
    </div>
  </div>

  {#if pet.notes}
    <div class="notes-strip">
      <span class="block-label">Notes from the uploader</span>
      <span class="notes-text">{pet.notes}</span>
    </div>
  {/if}

  {#if importStatus}
    <div class="status-strip">
      <StatusBanner type={importStatus.status} message={importStatus.message} autoDismissMs={6000} onDismiss={() => { importStatus = null; }} />
    </div>
  {/if}

  <div class="content-area">
    {#if genomeLoading}
      <div class="state" data-testid="community-genome-loading">Loading genome…</div>
    {:else if genomeError}
      <div class="state"><StatusBanner type="error" message={genomeError} /></div>
    {:else if previewPet && grid}
      <div class="visualizer-container">
        {#key pet.contentHash}
          <GeneVisualizer pet={previewPet} bind:this={geneVisualizerRef} onStatsUpdated={handleStatsUpdated} gridOverride={grid} />
        {/key}
      </div>

      {#if statsOpen}
        <div class="stats-drawer">
          <div class="stats-drawer-header">
            <span class="stats-drawer-title">{currentView === 'attribute' ? 'Attribute Effects' : 'Appearance Effects'}</span>
            <button class="stats-close" onclick={toggleStats}>×</button>
          </div>
          <div class="stats-drawer-body">
            <GeneStatsTable
              currentStats={stats?.currentStats}
              currentView={stats?.currentView ?? currentView}
              selectedAttributes={stats?.selectedAttributes ?? []}
              hiddenAttributes={stats?.hiddenAttributes ?? []}
              totalGenes={stats?.totalGenes ?? 0}
              neutralGenes={stats?.neutralGenes ?? 0}
              petSpecies={stats?.petSpecies ?? pet.species}
              pet={previewPet}
              on:attributeFilter={handleAttributeFilter}
            />
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .pet-visualization {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .detail-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border-primary);
    background: var(--bg-primary);
    flex-shrink: 0;
  }

  .detail-header-info {
    min-width: 0;
  }

  .detail-meta {
    font-size: 12px;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .detail-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }

  .tag-badge {
    display: inline-block;
    padding: 1px 7px;
    border-radius: 10px;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    font-size: 10px;
  }

  /* Control kinds, each its own cluster: exclusive views (segmented), the
     Stats panel toggle (bordered, pressed state), and the Import action.
     Wraps so everything stays reachable at narrow widths. */
  .header-controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 12px;
  }

  .view-controls {
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--bg-tertiary);
    border-radius: 6px;
    padding: 3px;
  }

  .toggle-btn {
    padding: 4px 12px;
    border: 1px solid var(--border-primary);
    border-radius: 6px;
    background: var(--bg-primary);
    color: var(--text-tertiary);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .toggle-btn:hover {
    border-color: var(--border-secondary);
    color: var(--text-secondary);
  }

  .toggle-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg-primary);
  }

  .header-actions {
    display: flex;
    align-items: center;
  }

  .view-btn {
    padding: 5px 14px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-tertiary);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .view-btn:hover {
    color: var(--text-secondary);
  }

  .view-btn.active {
    background: var(--bg-primary);
    color: var(--text-primary);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  }

  .import-btn {
    padding: 5px 14px;
    border: none;
    border-radius: 6px;
    background: var(--accent);
    color: var(--text-inverse);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .import-btn:hover:not(:disabled) {
    filter: brightness(1.05);
    color: var(--text-inverse);
  }

  .import-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .notes-strip {
    padding: 6px 16px;
    border-bottom: 1px solid var(--border-primary);
    font-size: 12px;
    flex-shrink: 0;
  }

  .block-label {
    font-size: 11px;
    text-transform: uppercase;
    color: var(--text-tertiary);
    margin-right: 8px;
  }

  .notes-text {
    color: var(--text-secondary);
    white-space: pre-wrap;
  }

  .status-strip {
    padding: 8px 16px 0;
    flex-shrink: 0;
  }

  .content-area {
    flex: 1;
    min-height: 0;
    display: flex;
    overflow: hidden;
  }

  .visualizer-container {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
    font-size: 13px;
    padding: 24px;
  }

  .stats-drawer {
    flex-shrink: 0;
    width: 320px;
    border-left: 1px solid var(--border-primary);
    background: var(--bg-secondary);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .stats-drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-primary);
    flex-shrink: 0;
  }

  .stats-drawer-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .stats-close {
    background: none;
    border: none;
    font-size: 18px;
    color: var(--text-tertiary);
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }

  .stats-close:hover {
    color: var(--text-primary);
  }

  .stats-drawer-body {
    flex: 1;
    overflow-y: auto;
  }
</style>
