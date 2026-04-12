<script>
import { onDestroy } from 'svelte';
import GeneStatsTable from '$lib/components/gene/GeneStatsTable.svelte';
import GeneVisualizer from '$lib/components/gene/GeneVisualizer.svelte';
import { settings } from '$lib/stores/settings.js';
import { HORSE_BREEDS } from '$lib/types/index.js';
import PetImageGallery from './PetImageGallery.svelte';

const { pet } = $props();

let geneVisualizerRef = $state();
let currentView = $state('attribute');
let statsOpen = $state(false);
let galleryOpen = $state(false);
let drawerWidth = $state(320);
let stats = $state(null);
let breedFilter = $state('');
let autoBreed = $state(false);

const isHorse = $derived(pet?.species?.toLowerCase() === 'horse');
const petHasKnownBreed = $derived(isHorse && pet?.breed && HORSE_BREEDS[pet.breed]);

// Initialize autoBreed from setting when a new pet is loaded
$effect(() => {
  const _petId = pet?.id; // track pet changes
  autoBreed = !!$settings['horse.autoSelectBreedFilter'];
});

// Apply the breed filter whenever autoBreed or pet changes
$effect(() => {
  if (autoBreed && petHasKnownBreed) {
    breedFilter = pet.breed;
  }
  if (geneVisualizerRef) {
    geneVisualizerRef.setBreedFilter(breedFilter);
  }
});

function toggleAutoBreed() {
  autoBreed = !autoBreed;
  if (autoBreed && petHasKnownBreed) {
    breedFilter = pet.breed;
  } else {
    breedFilter = '';
  }
  if (geneVisualizerRef) {
    geneVisualizerRef.setBreedFilter(breedFilter);
  }
}

function setBreedFilter(fullName) {
  breedFilter = breedFilter === fullName ? '' : fullName;
  if (geneVisualizerRef) {
    geneVisualizerRef.setBreedFilter(breedFilter);
  }
}

// Cleanup refs for resize listeners
let cleanupResize = null;

function handleViewChange(view) {
  currentView = view;
  if (geneVisualizerRef) {
    geneVisualizerRef.handleViewChange(view);
  }
  refreshStats();
}

function toggleStats() {
  statsOpen = !statsOpen;
  if (statsOpen) refreshStats();
}

function refreshStats() {
  if (geneVisualizerRef) {
    stats = geneVisualizerRef.getStatsData();
  }
}

function handleAttributeFilter(event) {
  if (geneVisualizerRef?.handleAttributeFilter) {
    geneVisualizerRef.handleAttributeFilter(event);
    refreshStats();
  }
}

// Called by GeneVisualizer when stats data changes
function handleStatsUpdated() {
  if (statsOpen) refreshStats();
}

function startResize(e) {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = drawerWidth;

  function onMove(e) {
    drawerWidth = Math.max(240, Math.min(600, startWidth + (startX - e.clientX)));
  }

  function onUp() {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    cleanupResize = null;
  }

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  cleanupResize = onUp;
}

onDestroy(() => {
  if (cleanupResize) cleanupResize();
});
</script>

<div class="pet-visualization">
    <div class="detail-header">
        <div class="detail-header-info">
            <h2 class="detail-title">{pet?.name || 'Pet'}</h2>
            <div class="detail-meta">
                <span>{pet?.species || 'Unknown'}</span>
                {#if pet?.breed && pet.breed !== 'Mixed'}
                    <span class="meta-dot">·</span>
                    <span>{pet.breed}</span>
                {/if}
                <span class="meta-dot">·</span>
                <span>{pet?.gender || 'Unknown'}</span>
                {#if pet?.known_genes}
                    <span class="meta-dot">·</span>
                    <span class="gene-count">{pet.known_genes} known genes</span>
                {/if}
                {#if pet?.has_unknown_genes}
                    <span class="meta-dot">·</span>
                    <span class="unknown-badge">⚠ Unknown genes</span>
                {/if}
            </div>
        </div>
        <div class="header-controls">
            {#if isHorse}
                <div class="breed-filter">
                    <span class="breed-label">Breed:</span>
                    {#if petHasKnownBreed}
                        <button class="breed-btn auto-btn" class:active={autoBreed} onclick={toggleAutoBreed} title="Auto-select pet's breed">Auto</button>
                        <span class="breed-divider"></span>
                    {/if}
                    <button class="breed-btn" class:active={!autoBreed && breedFilter === ''} disabled={autoBreed} onclick={() => setBreedFilter('')}>All</button>
                    {#each Object.entries(HORSE_BREEDS) as [name, abbrev]}
                        <button class="breed-btn" class:active={!autoBreed && breedFilter === name} disabled={autoBreed} onclick={() => setBreedFilter(name)} title={name}>{abbrev}</button>
                    {/each}
                </div>
            {/if}
            <div class="view-controls">
                <button
                    class="view-btn"
                    class:active={currentView === "attribute"}
                    onclick={() => handleViewChange("attribute")}
                >
                    Attributes
                </button>
                <button
                    class="view-btn"
                    class:active={currentView === "appearance"}
                    onclick={() => handleViewChange("appearance")}
                >
                    Appearance
                </button>
                <button
                    class="view-btn stats-btn"
                    class:active={statsOpen}
                    onclick={toggleStats}
                >
                    Stats
                </button>
                <button
                    class="view-btn"
                    class:active={galleryOpen}
                    onclick={() => { galleryOpen = !galleryOpen; }}
                >
                    Gallery
                </button>
            </div>
        </div>
    </div>

    <div class="content-area">
      {#if galleryOpen}
        <div class="gallery-container">
            <PetImageGallery {pet} />
        </div>
      {:else}
        <div class="visualizer-container">
            <GeneVisualizer {pet} bind:this={geneVisualizerRef} onStatsUpdated={handleStatsUpdated} />
        </div>

        {#if statsOpen}
            <div class="stats-drawer" style="width: {drawerWidth}px;">
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="resize-handle" onmousedown={startResize}></div>
                <div class="stats-drawer-header">
                    <span class="stats-drawer-title">
                        {currentView === "attribute" ? "Attribute Effects" : "Appearance Effects"}
                    </span>
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
                        petSpecies={stats?.petSpecies ?? pet?.species}
                        pet={pet}
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
        padding: 12px 20px;
        border-bottom: 1px solid var(--border-primary);
        background: var(--bg-primary);
        flex-shrink: 0;
    }

    .detail-title {
        font-size: 18px;
        font-weight: 700;
        color: var(--text-primary);
        margin: 0;
    }

    .detail-meta {
        font-size: 12px;
        color: var(--text-tertiary);
        margin-top: 2px;
    }

    .unknown-badge {
        color: var(--warning-text);
        font-weight: 600;
    }

    .header-controls {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .breed-filter {
        display: flex;
        align-items: center;
        gap: 3px;
    }

    .breed-label {
        font-size: 11px;
        font-weight: 600;
        color: var(--text-tertiary);
        margin-right: 4px;
    }

    .breed-btn {
        padding: 3px 8px;
        border: 1px solid var(--border-primary);
        border-radius: 4px;
        background: var(--bg-primary);
        color: var(--text-tertiary);
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
    }

    .breed-btn:hover {
        border-color: var(--border-secondary);
        color: var(--text-secondary);
    }

    .breed-btn.active {
        background: var(--accent);
        border-color: var(--accent);
        color: var(--bg-primary);
    }

    .breed-btn:disabled {
        opacity: 0.4;
        cursor: default;
        pointer-events: none;
    }

    .auto-btn.active {
        background: #22c55e;
        border-color: #22c55e;
        color: var(--bg-primary);
    }

    .breed-divider {
        width: 1px;
        height: 16px;
        background: var(--border-secondary);
        margin: 0 2px;
    }

    .view-controls {
        display: flex;
        gap: 4px;
        background: var(--bg-tertiary);
        border-radius: 6px;
        padding: 3px;
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

    .gallery-container {
        flex: 1;
        min-height: 0;
        overflow: hidden;
    }

    .stats-drawer {
        flex-shrink: 0;
        border-left: 1px solid var(--border-primary);
        background: var(--bg-secondary);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        position: relative;
    }

    .resize-handle {
        position: absolute;
        left: -3px;
        top: 0;
        bottom: 0;
        width: 6px;
        cursor: col-resize;
        z-index: 10;
    }

    .resize-handle:hover {
        background: rgba(59, 130, 246, 0.3);
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
