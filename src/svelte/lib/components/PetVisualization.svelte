<script>
    import { onMount } from "svelte";
    import GeneVisualizer from "./GeneVisualizer.svelte";

    export let pet;

    let geneVisualizerRef;
    let stylesLoaded = false;
    let currentView = "attribute";

    onMount(async () => {
        // Load scoped styles for gene visualizer
        if (!stylesLoaded) {
            await loadScopedStyles();
            stylesLoaded = true;
        }

        // Ensure the gene visualizer script is loaded
        if (!window.GeneVisualizer) {
            await loadScript("/gene-visualizer.js");
        }

        // CSS loading only - visualization handled by GeneVisualizerSvelte
    });

    async function loadScopedStyles() {
        try {
            const response = await fetch("/gene-visualizer-styles.css");
            const cssText = await response.text();

            // Scope other styles to the gene visualizer
            let scopedCss = cssText;

            // Only add scoped styles if not already present
            if (!document.querySelector("[data-gene-visualizer-scoped]")) {
                const styleElement = document.createElement("style");
                styleElement.textContent = scopedCss;
                styleElement.setAttribute(
                    "data-gene-visualizer-scoped",
                    "true",
                );
                document.head.appendChild(styleElement);
            }
        } catch (error) {
            console.warn("Failed to load gene visualizer styles:", error);
        }
    }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${src}"]`)) {
                resolve();
                return;
            }

            const script = document.createElement("script");
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

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
                on:click={() => handleViewChange("attribute")}
            >
                Attributes
            </button>
            <button
                class="view-btn"
                class:active={currentView === "appearance"}
                on:click={() => handleViewChange("appearance")}
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
    .pet-visualization {
        flex: 1;
        overflow-y: auto;
        min-height: 0;
        height: 100%;
        display: flex;
        flex-direction: column;
    }

    .visualization-header {
        position: sticky;
        top: 0;
        z-index: 100;
        display: flex;
        align-items: center;
        gap: 2rem;
        padding: 0.75rem 1.5rem;
        background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        border-radius: 0;
    }

    .visualization-title {
        font-size: 1.25rem;
        font-weight: 700;
        color: white;
        margin: 0;
    }

    .visualization-stats {
        display: flex;
        gap: 1rem;
        align-items: center;
        flex: 1;
    }

    .stat-item {
        font-size: 0.8rem;
        color: rgba(255, 255, 255, 0.8);
    }

    .unknown-indicator {
        color: #f59e0b;
        font-weight: 600;
        font-size: 0.8rem;
    }

    .view-controls {
        display: flex;
        gap: 4px;
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

    @keyframes spin {
        0% {
            transform: rotate(0deg);
        }
        100% {
            transform: rotate(360deg);
        }
    }

    .gene-visualizer-container {
        flex: 1;
        width: 100%;
        min-height: 0;
        /* Isolate from any external styles */
        position: relative;
        contain: layout style;
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
