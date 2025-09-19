<script>
    /**
     * @typedef {Object} Props
     * @property {string} title - Header title text
     * @property {Object[]} [stats] - Array of stat objects with text property
     * @property {boolean} [hasUnknownGenes] - Whether to show unknown genes indicator
     * @property {any} [children] - Slot content for controls
     */

    /** @type {Props} */
    const { title, stats = [], hasUnknownGenes = false, children } = $props();
</script>

<div class="visualization-header">
    <h3 class="visualization-title">
        {title}
    </h3>
    {#if stats.length > 0 || hasUnknownGenes}
        <div class="visualization-stats">
            {#each stats as stat}
                <span class="stat-item">{stat.text}</span>
            {/each}
            {#if hasUnknownGenes}
                <span class="unknown-indicator">⚠️ Has unknown genes</span>
            {/if}
        </div>
    {/if}
    {#if children}
        <div class="visualization-controls">
            {@render children()}
        </div>
    {/if}
</div>

<style>
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
        margin-bottom: 0;
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

    .visualization-controls {
        display: flex;
        gap: 4px;
    }

    @media (max-width: 768px) {
        .visualization-header {
            padding: 1rem;
            flex-direction: column;
            gap: 1rem;
            align-items: stretch;
        }
    }
</style>