<script>
    import GeneVisualizer from "./GeneVisualizer.svelte";

    const { pet } = $props();

    let geneVisualizerRef = $state();
    let currentView = $state("attribute");

    // No longer need to load external styles - handled by Svelte components

    // Handle view control clicks
    function handleViewChange(view) {
        currentView = view;
        if (geneVisualizerRef) {
            geneVisualizerRef.handleViewChange(view);
        }
    }
</script>

<div class="pet-visualization">
    <div class="visualization-header">
        <h3 class="visualization-title">
            🧬 Gene Visualization: {pet?.name || "Pet"}
        </h3>
        <div class="visualization-stats">
            <span class="stat-item">{pet?.species || "Unknown"} species</span>
            <span class="stat-item">{pet?.known_genes || 0} known genes</span>
            {#if pet?.has_unknown_genes}
                <span class="unknown-indicator">⚠️ Has unknown genes</span>
            {/if}
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
        </div>
    </div>

    <!-- Svelte gene visualizer -->
    <div class="gene-visualizer-container">
        <GeneVisualizer {pet} bind:this={geneVisualizerRef} />
    </div>
</div>

<style>
    .empty-state,
    .error-state {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 200px;
        color: #6b7280;
        font-style: italic;
    }

    .error-state {
        color: #f44336;
    }

    .gene-tooltip {
        position: fixed;
        background: #1f2937;
        color: white;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 12px;
        line-height: 1.4;
        max-width: 250px;
        z-index: 1000;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        pointer-events: none;
    }

    .gene-tooltip strong {
        color: #60a5fa;
    }
</style>
