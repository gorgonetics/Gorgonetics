<script lang="ts">
import { onDestroy } from 'svelte';
import SharePetDialog from '$lib/components/community/SharePetDialog.svelte';
import GeneStatsTable from '$lib/components/gene/GeneStatsTable.svelte';
import GeneVisualizer from '$lib/components/gene/GeneVisualizer.svelte';
import BreedSelector from '$lib/components/shared/BreedSelector.svelte';
import PetActions from '$lib/components/shared/PetActions.svelte';
import StatusBanner from '$lib/components/shared/StatusBanner.svelte';
import { settings } from '$lib/stores/settings.js';
import type { DialogResult, Pet } from '$lib/types/index.js';
import { HORSE_BREEDS } from '$lib/types/index.js';
import type { StatsMap } from '$lib/utils/geneStats.js';
import PetImageGallery from './PetImageGallery.svelte';

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
  pet?: Pet | null;
}

const { pet }: Props = $props();

let geneVisualizerRef = $state<GeneVisualizerInstance | undefined>(undefined);
let currentView = $state('attribute');
let statsOpen = $state(false);
let galleryOpen = $state(false);
let drawerWidth = $state<number>(320);
let stats = $state<ReturnType<GeneVisualizerInstance['getStatsData']> | null>(null);
let breedFilter = $state('');
let autoBreed = $state(false);
let showShare = $state(false);
let shareStatus = $state<DialogResult | null>(null);

function handleShareResult(result: DialogResult): void {
  shareStatus = result;
}

const isHorse = $derived(pet?.species?.toLowerCase() === 'horse');
const petHasKnownBreed = $derived(isHorse && pet?.breed && HORSE_BREEDS[pet.breed]);

// Initialize autoBreed from setting when a new pet is loaded
$effect(() => {
  const _petId = pet?.id; // track pet changes
  autoBreed = !!$settings['horse.autoSelectBreedFilter'];
});

// Apply the breed filter whenever autoBreed or pet changes
$effect(() => {
  if (autoBreed && petHasKnownBreed && pet) {
    breedFilter = pet.breed;
  }
  if (geneVisualizerRef) {
    geneVisualizerRef.setBreedFilter(breedFilter);
  }
});

function toggleAutoBreed(): void {
  autoBreed = !autoBreed;
  if (autoBreed && petHasKnownBreed && pet) {
    breedFilter = pet.breed;
  } else {
    breedFilter = '';
  }
  if (geneVisualizerRef) {
    geneVisualizerRef.setBreedFilter(breedFilter);
  }
}

function handleBreedChange(fullName: string): void {
  breedFilter = fullName;
  if (geneVisualizerRef) {
    geneVisualizerRef.setBreedFilter(breedFilter);
  }
}

// Cleanup refs for resize listeners
let cleanupResize = $state<(() => void) | null>(null);

function handleViewChange(view: string): void {
  // Picking a grid view always brings the grid back if the gallery took over.
  galleryOpen = false;
  currentView = view;
  if (geneVisualizerRef) {
    geneVisualizerRef.handleViewChange(view);
  }
  refreshStats();
}

function toggleStats(): void {
  // The stats drawer belongs to the grid content: opening it brings the grid
  // back if the gallery took over, so pressed state always matches the screen.
  if (!statsOpen) galleryOpen = false;
  statsOpen = !statsOpen;
  if (statsOpen) refreshStats();
}

function toggleGallery(): void {
  galleryOpen = !galleryOpen;
  // The gallery hides the grid and its stats drawer; close Stats too so its
  // pressed state never points at a hidden panel.
  if (galleryOpen) statsOpen = false;
}

function refreshStats(): void {
  if (geneVisualizerRef) {
    stats = geneVisualizerRef.getStatsData();
  }
}

function handleAttributeFilter(event: CustomEvent<{ attribute: string; ctrlKey: boolean; altKey: boolean }>): void {
  if (geneVisualizerRef?.handleAttributeFilter) {
    geneVisualizerRef.handleAttributeFilter(event);
    refreshStats();
  }
}

// Called by GeneVisualizer when stats data changes
function handleStatsUpdated(): void {
  if (statsOpen) refreshStats();
}

function startResize(e: MouseEvent): void {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = drawerWidth;

  function onMove(e: MouseEvent): void {
    drawerWidth = Math.max(240, Math.min(600, startWidth + (startX - e.clientX)));
  }

  function onUp(): void {
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
            <!-- The pet name lives in the DetailOverlay title; only the meta line here. -->
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
                    {#if petHasKnownBreed}
                        <button
                            type="button"
                            class="auto-btn"
                            class:active={autoBreed}
                            aria-pressed={autoBreed}
                            onclick={toggleAutoBreed}
                            title="Auto-select pet's breed"
                        >Auto</button>
                    {/if}
                    <BreedSelector
                        value={breedFilter}
                        breeds={HORSE_BREEDS}
                        disabled={autoBreed && !!petHasKnownBreed}
                        onChange={handleBreedChange}
                    />
                </div>
            {/if}
            <div class="view-controls" role="group" aria-label="Grid view">
                <button
                    class="view-btn"
                    class:active={!galleryOpen && currentView === "attribute"}
                    onclick={() => handleViewChange("attribute")}
                >
                    Attributes
                </button>
                <button
                    class="view-btn"
                    class:active={!galleryOpen && currentView === "appearance"}
                    onclick={() => handleViewChange("appearance")}
                >
                    Appearance
                </button>
            </div>
            <div class="toggle-controls">
                <button
                    class="toggle-btn"
                    class:active={statsOpen}
                    aria-pressed={statsOpen}
                    data-testid="detail-stats-toggle"
                    title="Toggle the stats side panel"
                    onclick={toggleStats}
                >
                    Stats
                </button>
                <button
                    class="toggle-btn"
                    class:active={galleryOpen}
                    aria-pressed={galleryOpen}
                    data-testid="detail-gallery-toggle"
                    title="Toggle the image gallery"
                    onclick={toggleGallery}
                >
                    Gallery
                </button>
            </div>
            <div class="header-actions">
                <button
                    class="view-btn share-btn"
                    data-testid="share-pet-btn"
                    title="Share this pet to the public community catalogue"
                    onclick={() => { showShare = true; }}
                >
                    Share
                </button>
                {#if pet}<PetActions {pet} variant="button" />{/if}
            </div>
        </div>
    </div>

    {#if showShare && pet}
        <SharePetDialog
            {pet}
            onClose={() => { showShare = false; }}
            onResult={handleShareResult}
        />
    {/if}

    {#if shareStatus}
        <StatusBanner
            type={shareStatus.type}
            message={shareStatus.message}
            toast
            autoDismissMs={5000}
            onDismiss={() => { shareStatus = null; }}
        />
    {/if}

    <div class="content-area">
      {#if galleryOpen && pet}
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
        gap: 12px;
        flex-wrap: wrap;
        padding: 8px 16px;
        border-bottom: 1px solid var(--border-primary);
        background: var(--bg-primary);
        flex-shrink: 0;
    }

    .detail-meta {
        font-size: 12px;
        color: var(--text-tertiary);
    }

    .unknown-badge {
        color: var(--warning-text);
        font-weight: 600;
    }

    /* Three control kinds, each its own cluster: exclusive views (segmented),
       panel/content toggles (bordered, pressed state), actions (Share/Edit/
       Delete). Wraps so everything stays reachable at narrow widths. */
    .header-controls {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px 12px;
    }

    .breed-filter {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    /* Auto = follow the pet's breed; it owns the BreedSelector while active. */
    .auto-btn {
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

    .auto-btn:hover {
        border-color: var(--border-secondary);
        color: var(--text-secondary);
    }

    .auto-btn.active {
        background: var(--auto-active);
        border-color: var(--auto-active);
        color: var(--bg-primary);
    }

    .view-controls {
        display: flex;
        align-items: center;
        gap: 4px;
        background: var(--bg-tertiary);
        border-radius: 6px;
        padding: 3px;
    }

    .toggle-controls {
        display: flex;
        align-items: center;
        gap: 4px;
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
        box-shadow: var(--shadow-sm);
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
