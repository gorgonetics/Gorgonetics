<script>
import { onDestroy } from 'svelte';
import GeneStatsTable from '$lib/components/gene/GeneStatsTable.svelte';
import GeneVisualizer from '$lib/components/gene/GeneVisualizer.svelte';

import { HORSE_BREEDS } from '$lib/types/index.js';

const { pet } = $props();

let geneVisualizerRef = $state();
let currentView = $state('attribute');
let statsOpen = $state(false);
let drawerWidth = $state(320);
let stats = $state(null);
let breedFilter = $state('');

const isHorse = $derived(pet?.species?.toLowerCase() === 'horse');

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
                    <button class="breed-btn" class:active={breedFilter === ''} onclick={() => setBreedFilter('')}>All</button>
                    {#each Object.entries(HORSE_BREEDS) as [name, abbrev]}
                        <button class="breed-btn" class:active={breedFilter === name} onclick={() => setBreedFilter(name)} title={name}>{abbrev}</button>
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
            </div>
        </div>
    </div>

    <div class="content-area">
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
                        on:attributeFilter={handleAttributeFilter}
                    />
                </div>
            </div>
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
        border-bottom: 1px solid #e5e7eb;
        background: #ffffff;
        flex-shrink: 0;
    }

    .detail-title {
        font-size: 18px;
        font-weight: 700;
        color: #111827;
        margin: 0;
    }

    .detail-meta {
        font-size: 12px;
        color: #6b7280;
        margin-top: 2px;
    }

    .meta-dot {
        margin: 0 4px;
        color: #d1d5db;
    }

    .gene-count {
        color: #3b82f6;
    }

    .unknown-badge {
        color: #f59e0b;
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
        color: #6b7280;
        margin-right: 4px;
    }

    .breed-btn {
        padding: 3px 8px;
        border: 1px solid #e5e7eb;
        border-radius: 4px;
        background: #ffffff;
        color: #6b7280;
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
    }

    .breed-btn:hover {
        border-color: #d1d5db;
        color: #374151;
    }

    .breed-btn.active {
        background: #3b82f6;
        border-color: #3b82f6;
        color: #ffffff;
    }

    .view-controls {
        display: flex;
        gap: 4px;
        background: #f3f4f6;
        border-radius: 6px;
        padding: 3px;
    }

    .view-btn {
        padding: 5px 14px;
        border: none;
        border-radius: 4px;
        background: transparent;
        color: #6b7280;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .view-btn:hover {
        color: #374151;
    }

    .view-btn.active {
        background: #ffffff;
        color: #111827;
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

    .stats-drawer {
        flex-shrink: 0;
        border-left: 1px solid #e5e7eb;
        background: #f9fafb;
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
        background: #f3f4f6;
        border-bottom: 1px solid #e5e7eb;
        flex-shrink: 0;
    }

    .stats-drawer-title {
        font-size: 12px;
        font-weight: 600;
        color: #374151;
    }

    .stats-close {
        background: none;
        border: none;
        font-size: 18px;
        color: #6b7280;
        cursor: pointer;
        padding: 0 4px;
        line-height: 1;
    }

    .stats-close:hover {
        color: #111827;
    }

    .stats-drawer-body {
        flex: 1;
        overflow-y: auto;
    }
</style>
