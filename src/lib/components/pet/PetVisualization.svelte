<script>
    import GeneVisualizer from "$lib/components/gene/GeneVisualizer.svelte";

    const { pet } = $props();

    let geneVisualizerRef = $state();
    let currentView = $state("attribute");
    let statsOpen = $state(false);

    function handleViewChange(view) {
        currentView = view;
        if (geneVisualizerRef) {
            geneVisualizerRef.handleViewChange(view);
        }
    }

    function toggleStats() {
        statsOpen = !statsOpen;
        if (geneVisualizerRef) {
            geneVisualizerRef.setStatsOpen(statsOpen);
        }
    }
</script>

<div class="pet-visualization">
    <div class="detail-header">
        <div class="detail-header-info">
            <h2 class="detail-title">{pet?.name || 'Pet'}</h2>
            <div class="detail-meta">
                <span>{pet?.species || 'Unknown'}</span>
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

    <div class="visualizer-container">
        <GeneVisualizer {pet} bind:this={geneVisualizerRef} />
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
        padding: 16px 20px;
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

    .visualizer-container {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 16px;
    }
</style>
