<script>
    import { onMount } from "svelte";
    import GeneVisualizer from "./GeneVisualizer.svelte";

    let { pet } = $props();

    let geneVisualizerRef = $state();
    let stylesLoaded = false;
    let currentView = $state("attribute");

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
            const scopedCss = cssText;

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
