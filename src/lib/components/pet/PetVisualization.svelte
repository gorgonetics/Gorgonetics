<script>
    import GeneVisualizer from "$lib/components/gene/GeneVisualizer.svelte";
    import VisualizationHeader from "$lib/components/layout/VisualizationHeader.svelte";
    import { Button } from "flowbite-svelte";
    import { ArrowLeft } from "@lucide/svelte";
    import { appState } from "$lib/stores/pets.js";

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

    // Handle back navigation to pet table
    function handleBackToPetTable() {
        appState.showPetTableView();
    }
</script>

<div class="pet-visualization">
    <VisualizationHeader
        title="🧬 Gene Visualization: {pet?.name || 'Pet'}"
        stats={[
            { text: `${pet?.species || "Unknown"} species` },
            { text: `${pet?.known_genes || 0} known genes` },
        ]}
        hasUnknownGenes={pet?.has_unknown_genes}
    >
        {#snippet leftControls()}
            <button
                class="back-icon-button"
                onclick={handleBackToPetTable}
                title="Back to Pet Table"
            >
                <ArrowLeft class="w-4 h-4" />
            </button>
        {/snippet}
        {#snippet children()}
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
        {/snippet}
    </VisualizationHeader>

    <!-- Svelte gene visualizer -->
    <div class="gene-visualizer-container">
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

    .back-icon-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 6px;
        color: rgba(255, 255, 255, 0.9);
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .back-icon-button:hover {
        background: rgba(255, 255, 255, 0.2);
        border-color: rgba(255, 255, 255, 0.3);
        color: white;
        transform: translateX(-2px);
    }

    .view-controls {
        display: flex;
        gap: 0.5rem;
    }

    .view-btn {
        padding: 8px 16px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 6px;
        color: rgba(255, 255, 255, 0.8);
        font-size: 0.8rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .view-btn:hover {
        background: rgba(255, 255, 255, 0.2);
        color: white;
    }

    .view-btn.active {
        background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
        border-color: #1d4ed8;
        color: white;
    }

    .gene-visualizer-container {
        flex: 1;
        width: 100%;
        min-height: 0;
        position: relative;
        contain: layout style;
        padding: 1.5rem;
        overflow: hidden;
    }

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
