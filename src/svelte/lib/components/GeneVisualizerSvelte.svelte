<script>
  import { onDestroy, onMount } from "svelte";

  export let pet;

  let containerElement;
  let geneVisualizer = null;
  let loading = false;
  let error = null;
  let currentPet = null;
  let currentView = "attribute";

  onMount(async () => {
    // Load the gene visualizer script if not already loaded
    if (!window.GeneVisualizer) {
      await loadScript("/gene-visualizer.js");
    }

    initializeVisualizer();
  });

  onDestroy(() => {
    cleanup();
  });

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

  function initializeVisualizer() {
    if (!containerElement || !window.GeneVisualizer) return;

    try {
      // Create a unique ID for this instance
      const containerId = `gene-viz-${Date.now()}`;
      containerElement.id = containerId;

      // Initialize the gene visualizer and let it create UI
      geneVisualizer = new window.GeneVisualizer(containerId);

      // Override showError to handle errors in Svelte
      geneVisualizer.showError = function (message) {
        error = message;
      };

      // Load pet data if available
      if (pet) {
        loadPetData();
      }
    } catch (err) {
      error = `Failed to initialize visualizer: ${err.message}`;
      console.error("Gene visualizer initialization error:", err);
    }
  }

  async function loadPetData() {
    if (!geneVisualizer || !pet) return;

    try {
      loading = true;
      error = null;

      // Use the gene visualizer's loadPet method
      await geneVisualizer.loadPet(pet.id);
      currentPet = geneVisualizer.currentPet;
    } catch (err) {
      error = `Failed to load pet: ${err.message}`;
      console.error("Error loading pet data:", err);
    } finally {
      loading = false;
    }
  }

  function cleanup() {
    if (geneVisualizer) {
      try {
        geneVisualizer.clear();
      } catch (err) {
        console.warn("Error during cleanup:", err);
      }
      geneVisualizer = null;
    }
  }

  export function handleViewChange(view) {
    currentView = view;
    if (geneVisualizer) {
      geneVisualizer.currentView = view;
      geneVisualizer.updateVisualization();
    }
  }

  // React to pet changes
  $: if (pet && geneVisualizer) {
    loadPetData();
  } else if (!pet && geneVisualizer) {
    geneVisualizer.clear();
    currentPet = null;
  }
</script>

<div class="gene-visualizer-svelte">
  <!-- {#if loading}
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <p>Loading gene visualization...</p>
    </div>
  {:else if error}
    <div class="error-state">
      <span class="error-icon">⚠️</span>
      <p>{error}</p>
    </div>
  {/if} -->

  <!-- Visible container for GeneVisualizer instance with proper layout -->
  <div
    bind:this={containerElement}
    class="gene-visualizer-container-inner visualizer-content"
  ></div>
</div>

<style>
  .gene-visualizer-svelte {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: #ffffff;
    overflow: hidden;
  }

  .loading-state,
  .error-state,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem;
    gap: 1rem;
  }

  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 4px solid #e5e7eb;
    border-top: 4px solid #3b82f6;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }

  .error-state {
    color: #dc2626;
  }

  .error-icon {
    font-size: 2rem;
  }

  .gene-section {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 1rem;
    overflow: hidden;
  }

  .gene-legend {
    margin-bottom: 1rem;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 1rem;
  }

  .gene-grid-container {
    flex: 1;
    overflow-y: auto;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: white;
  }

  .stats-section {
    border-top: 1px solid #e2e8f0;
    background: #f9fafb;
    padding: 1rem;
  }

  .stats-table-container {
    max-width: 100%;
    overflow-x: auto;
  }

  .table-controls {
    display: flex;
    gap: 1rem;
    margin-bottom: 0.5rem;
  }

  .selection-counter {
    font-size: 0.875rem;
    color: #6b7280;
  }

  .table-instructions {
    font-size: 0.75rem;
    color: #9ca3af;
    margin-bottom: 1rem;
  }

  .stats-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }

  .stats-table th,
  .stats-table td {
    padding: 0.5rem;
    text-align: left;
    border-bottom: 1px solid #e5e7eb;
  }

  .stats-table th {
    background: #f3f4f6;
    font-weight: 600;
  }

  .summary-info {
    display: flex;
    gap: 2rem;
    margin-top: 1rem;
    font-size: 0.875rem;
    color: #6b7280;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 200px;
    color: #9ca3af;
    font-style: italic;
  }

  .gene-visualizer-content {
    flex: 1;
    overflow-y: auto;
  }

  .gene-visualizer-container-inner {
    height: 100%;
    width: 100%;
    display: flex;
  }

  /* Restore original layout structure */
  .gene-visualizer-container-inner :global(.gene-section) {
    flex: 1;
    padding: 10px;
    border-right: 1px solid #e2e8f0;
    overflow-y: auto;
  }

  .gene-visualizer-container-inner :global(.stats-section) {
    width: 300px;
    background: #f9fafb;
    padding: 10px;
    overflow-y: auto;
  }

  /* Responsive layout */
  @media (max-width: 1200px) {
    .gene-visualizer-container-inner {
      flex-direction: column;
    }

    .gene-visualizer-container-inner :global(.gene-section) {
      border-right: none;
      border-bottom: 1px solid #e2e8f0;
    }

    .gene-visualizer-container-inner :global(.stats-section) {
      width: 100%;
    }
  }

  /* Hide the header that GeneVisualizer creates */
  .gene-visualizer-container-inner :global(.visualizer-header),
  .gene-visualizer-container-inner :global(.compact-header) {
    display: none !important;
  }
</style>
