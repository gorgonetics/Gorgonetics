<script>
  import { onMount } from 'svelte';
  import GeneVisualizerSvelte from './GeneVisualizerSvelte.svelte';

  export let pet;

  let geneVisualizerRef;
  let stylesLoaded = false;
  let currentView = 'attribute';

  onMount(async () => {
    // Load scoped styles for gene visualizer
    if (!stylesLoaded) {
      await loadScopedStyles();
      stylesLoaded = true;
    }

    // Ensure the gene visualizer script is loaded
    if (!window.GeneVisualizer) {
      await loadScript('/gene-visualizer.js');
    }

    // CSS loading only - visualization handled by GeneVisualizerSvelte
  });



  async function loadScopedStyles() {
    try {
      const response = await fetch('/gene-visualizer-styles.css');
      const cssText = await response.text();

      // Add tooltip styles globally first
      if (!document.querySelector('[data-gene-tooltip-styles]')) {
        const tooltipStyleElement = document.createElement('style');
        tooltipStyleElement.textContent = `
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
        `;
        tooltipStyleElement.setAttribute('data-gene-tooltip-styles', 'true');
        document.head.appendChild(tooltipStyleElement);
      }

      // Scope other styles to the gene visualizer container and remove height constraints
      let scopedCss = cssText
        .replace(/\.gene-tooltip[^}]*}/g, '') // Remove tooltip styles from scoped CSS
        .replace(/max-height:\s*[^;]+;/g, '') // Remove all max-height properties
        .replace(/min-height:\s*[^;]+;/g, '') // Remove all min-height properties
        .replace(/\.gene-visualizer\s*{/g, '.gene-visualizer-container {') // Move gene-visualizer styles to gene-visualizer-container
        .replace(/\.visualizer-content\s*{/g, '.gene-visualizer-container {') // Move visualizer-content styles to gene-visualizer-container
        .replace(/([^{}]+){/g, (match, selector) => {
          // Skip keyframes, at-rules, and already scoped selectors
          if (selector.includes('@') || selector.includes('.gene-visualizer-container') || selector.includes('.gene-visualizer') || selector.includes('.visualizer-content')) {
            return match;
          }
          // Scope each selector to the gene visualizer container
          const trimmedSelector = selector.trim();
          if (trimmedSelector) {
            return `.gene-visualizer-container ${trimmedSelector} {`;
          }
          return match;
        });

      // Add rules to ensure full width and height for gene-visualizer-container
      scopedCss += `
        .gene-visualizer-container {
          margin: 0 !important;
          padding: 0 !important;
          width: 100% !important;
          max-width: 100% !important;
          height: 100% !important;
          display: flex !important;
          flex-direction: column !important;
          flex: 1 !important;
          overflow-y: auto !important;
        }
      `;

      // Only add scoped styles if not already present
      if (!document.querySelector('[data-gene-visualizer-scoped]')) {
        const styleElement = document.createElement('style');
        styleElement.textContent = scopedCss;
        styleElement.setAttribute('data-gene-visualizer-scoped', 'true');
        document.head.appendChild(styleElement);
      }
    } catch (error) {
      console.warn('Failed to load gene visualizer styles:', error);
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }

      const script = document.createElement('script');
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
    <h3 class="visualization-title">🧬 Gene Visualization: {pet?.name || 'Pet'}</h3>
    <div class="visualization-stats">
      <span class="stat-item">{pet?.species || 'Unknown'} species</span>
      <span class="stat-item">{pet?.known_genes || 0} known genes</span>
      {#if pet?.has_unknown_genes}
        <span class="unknown-indicator">⚠️ Has unknown genes</span>
      {/if}
    </div>
    <div class="view-controls">
      <button
        class="view-btn"
        class:active={currentView === 'attribute'}
        on:click={() => handleViewChange('attribute')}
      >
        Attributes
      </button>
      <button
        class="view-btn"
        class:active={currentView === 'appearance'}
        on:click={() => handleViewChange('appearance')}
      >
        Appearance
      </button>
    </div>
  </div>

  <!-- Svelte gene visualizer -->
  <div class="gene-visualizer-container">
    <GeneVisualizerSvelte {pet} bind:this={geneVisualizerRef} />
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



  .loading-state {
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
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .loading-state p {
    color: #6b7280;
    font-style: italic;
    margin: 0;
  }

  .error-state {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    background-color: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 8px;
    color: #dc2626;
    margin-bottom: 1rem;
  }

  .error-icon {
    font-size: 1.25rem;
    flex-shrink: 0;
  }

  .gene-visualizer-container {
    flex: 1;
    width: 100%;
    min-height: 0;
    /* Isolate from any external styles */
    position: relative;
    contain: layout style;
  }



</style>
