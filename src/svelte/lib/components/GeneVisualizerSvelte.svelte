<script>
  import { onDestroy, onMount } from "svelte";
  import GeneStatsTable from "./GeneStatsTable.svelte";
  import GeneTooltip from "./GeneTooltip.svelte";

  export let pet;

  let containerElement;
  let geneVisualizer = null;
  let loading = false;
  let error = null;
  let currentPet = null;
  let currentView = "attribute";

  // Stats-related reactive variables
  let currentStats = null;
  let totalGenes = 0;
  let neutralGenes = 0;
  let selectedAttributes = [];
  let hiddenAttributes = [];

  // Tooltip state
  let tooltipVisible = false;
  let tooltipX = 0;
  let tooltipY = 0;
  let tooltipGeneId = "";
  let tooltipGeneType = "";
  let tooltipEffect = "";
  let tooltipPotentialEffects = [];

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

      // Override tooltip methods to use Svelte tooltip
      geneVisualizer.showTooltip = function (event) {
        handleTooltipShow(event);
      };

      geneVisualizer.hideTooltip = function () {
        handleTooltipHide();
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
      updateStatsFromVisualizer();
    }
  }

  function updateStatsFromVisualizer() {
    if (geneVisualizer) {
      currentStats = geneVisualizer.currentStats;
      totalGenes = geneVisualizer.totalGenes || 0;
      neutralGenes = geneVisualizer.neutralGenes || 0;
      selectedAttributes = [...geneVisualizer.selectedAttributes];
      hiddenAttributes = [...geneVisualizer.hiddenAttributes];
    }
  }

  function handleAttributeFilter(event) {
    if (geneVisualizer) {
      geneVisualizer.toggleAttributeFilter(
        event.detail.attribute,
        event.detail.ctrlKey,
        event.detail.altKey
      );
      updateStatsFromVisualizer();
    }
  }

  function handleTooltipShow(event) {
    // Get the gene cell, handling nested elements
    let cell = event.target;
    while (cell && !cell.dataset.geneId && cell !== document.body) {
      cell = cell.parentElement;
    }

    if (!cell || !cell.dataset.geneId) {
      return;
    }

    const geneId = cell.dataset.geneId;
    const geneType = cell.dataset.geneType;
    const effectInfo = cell.dataset.effect;

    // Get potential effects
    let potentialEffects = [];
    if (geneVisualizer.currentPet) {
      const dominantEffect = geneVisualizer.getGeneEffect(
        geneVisualizer.currentPet.species,
        geneId,
        "D"
      );
      const recessiveEffect = geneVisualizer.getGeneEffect(
        geneVisualizer.currentPet.species,
        geneId,
        "R"
      );

      if (
        geneType !== "D" &&
        dominantEffect &&
        dominantEffect !== "No dominant effect" &&
        dominantEffect !== "No gene data found" &&
        dominantEffect !== "Unknown gene type"
      ) {
        const isPositive = dominantEffect.includes("+");
        const isNegative = dominantEffect.includes("-");
        const color = isPositive ? "#4CAF50" : isNegative ? "#f44336" : "#666";
        potentialEffects.push(
          `If Dominant: <span style="color: ${color}">${dominantEffect}</span>`
        );
      }

      if (
        geneType !== "R" &&
        recessiveEffect &&
        recessiveEffect !== "No recessive effect" &&
        recessiveEffect !== "No gene data found" &&
        recessiveEffect !== "Unknown gene type"
      ) {
        const isPositive = recessiveEffect.includes("+");
        const isNegative = recessiveEffect.includes("-");
        const color = isPositive ? "#4CAF50" : isNegative ? "#f44336" : "#666";
        potentialEffects.push(
          `If Recessive: <span style="color: ${color}">${recessiveEffect}</span>`
        );
      }
    }

    // Position tooltip relative to the gene visualizer container
    const rect = cell.getBoundingClientRect();
    const containerRect = containerElement.getBoundingClientRect();
    tooltipX = rect.right - containerRect.left + 5;
    tooltipY = rect.top - containerRect.top - 5;

    // Set tooltip data
    tooltipGeneId = geneId;
    tooltipGeneType = geneType;
    tooltipEffect = effectInfo;
    tooltipPotentialEffects = potentialEffects;
    tooltipVisible = true;
  }

  function handleTooltipHide() {
    tooltipVisible = false;
  }

  // React to pet changes
  $: if (pet && geneVisualizer) {
    loadPetData();
  } else if (!pet && geneVisualizer) {
    geneVisualizer.clear();
    currentPet = null;
    currentStats = null;
    totalGenes = 0;
    neutralGenes = 0;
    selectedAttributes = [];
    hiddenAttributes = [];
  }
</script>

<div class="gene-visualizer-svelte">
  <!-- Main gene visualization container -->
  <div
    bind:this={containerElement}
    class="gene-visualization-container"
  ></div>

  <!-- Separate stats table component -->
  <GeneStatsTable
    {currentStats}
    {currentView}
    {selectedAttributes}
    {hiddenAttributes}
    {totalGenes}
    {neutralGenes}
    on:attributeFilter={handleAttributeFilter}
  />
</div>

<!-- Tooltip component -->
<GeneTooltip
  visible={tooltipVisible}
  x={tooltipX}
  y={tooltipY}
  geneId={tooltipGeneId}
  geneType={tooltipGeneType}
  effect={tooltipEffect}
  potentialEffects={tooltipPotentialEffects}
/>

<style>
  .gene-visualizer-svelte {
    height: 100%;
    display: flex;
    flex-direction: row;
    background: #ffffff;
    overflow: hidden;
  }

  .gene-visualization-container {
    flex: 1;
    height: 100%;
    overflow: hidden;
    position: relative;
  }

  /* Ensure the gene visualizer takes full space */
  .gene-visualization-container :global(.gene-section) {
    height: 100%;
    padding: 10px;
  }

  /* Hide the stats section created by GeneVisualizer since we have our own */
  .gene-visualization-container :global(.stats-section) {
    display: none !important;
  }

  /* Hide the header that GeneVisualizer creates */
  .gene-visualization-container :global(.visualizer-header),
  .gene-visualization-container :global(.compact-header) {
    display: none !important;
  }

  /* Responsive layout */
  @media (max-width: 1200px) {
    .gene-visualizer-svelte {
      flex-direction: column;
    }
  }
</style>
