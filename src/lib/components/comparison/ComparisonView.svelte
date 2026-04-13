<script>
import AttributeComparison from '$lib/components/comparison/AttributeComparison.svelte';
import GeneStatsComparison from '$lib/components/comparison/GeneStatsComparison.svelte';
import GenomeGridDiff from '$lib/components/comparison/GenomeGridDiff.svelte';
import { normalizeSpecies } from '$lib/services/configService.js';
import { comparisonPets, comparisonReady, speciesMismatch } from '$lib/stores/comparison.js';
import { getSpeciesEmoji } from '$lib/utils/species.js';

let activeView = $state('attributes');

const speciesLabel = $derived($comparisonPets[0] ? normalizeSpecies($comparisonPets[0].species) : '');
</script>

<div class="comparison-view">
    {#if $comparisonReady}
        <div class="comparison-header">
            <div class="comparison-title-row">
                <h2 class="comparison-title">
                    <span class="pet-name-a">{$comparisonPets[0]?.name}</span>
                    <span class="vs-label">vs</span>
                    <span class="pet-name-b">{$comparisonPets[1]?.name}</span>
                </h2>
                {#if speciesLabel}
                    <span class="species-badge">
                        {getSpeciesEmoji($comparisonPets[0]?.species)} {speciesLabel}
                    </span>
                {/if}
            </div>

            {#if $speciesMismatch}
                <div class="mismatch-warning" role="alert">
                    ⚠️ These pets are different species. Genome comparison is not available across species.
                </div>
            {/if}

            <nav class="view-tabs" aria-label="Comparison views">
                <button
                    class="view-tab"
                    class:active={activeView === 'attributes'}
                    onclick={() => activeView = 'attributes'}
                >
                    Attributes
                </button>
                <button
                    class="view-tab"
                    class:active={activeView === 'geneStats'}
                    onclick={() => activeView = 'geneStats'}
                    disabled={$speciesMismatch}
                >
                    Gene Stats
                </button>
                <button
                    class="view-tab"
                    class:active={activeView === 'genomeDiff'}
                    onclick={() => activeView = 'genomeDiff'}
                    disabled={$speciesMismatch}
                >
                    Genome Diff
                </button>
            </nav>
        </div>

        <div class="comparison-body">
            {#if activeView === 'attributes'}
                <AttributeComparison petA={$comparisonPets[0]} petB={$comparisonPets[1]} />
            {:else if activeView === 'geneStats'}
                <GeneStatsComparison petA={$comparisonPets[0]} petB={$comparisonPets[1]} />
            {:else if activeView === 'genomeDiff'}
                <GenomeGridDiff petA={$comparisonPets[0]} petB={$comparisonPets[1]} />
            {/if}
        </div>
    {:else}
        <div class="empty-state">
            <div class="empty-icon">⚖️</div>
            <p class="state-title">Select two pets to compare</p>
            <p class="state-text">Use the sidebar to pick two same-species pets for head-to-head comparison</p>
        </div>
    {/if}
</div>

<style>
    .comparison-view {
        display: flex;
        flex-direction: column;
        height: 100%;
    }

    .comparison-header {
        padding: 16px 20px 0;
        border-bottom: 1px solid var(--border-primary);
        flex-shrink: 0;
    }

    .comparison-title-row {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
    }

    .comparison-title {
        font-size: 18px;
        font-weight: 700;
        color: var(--text-primary);
        margin: 0;
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .vs-label {
        font-size: 13px;
        font-weight: 500;
        color: var(--text-muted);
        text-transform: uppercase;
    }

    .species-badge {
        font-size: 12px;
        padding: 2px 8px;
        background: var(--bg-tertiary);
        border-radius: 10px;
        color: var(--text-secondary);
        white-space: nowrap;
    }

    .mismatch-warning {
        padding: 8px 12px;
        background: var(--warning-bg, #fef3c7);
        border: 1px solid var(--warning-border, #f59e0b);
        border-radius: 6px;
        font-size: 12px;
        color: var(--warning-text, #92400e);
        margin-bottom: 12px;
    }

    .view-tabs {
        display: flex;
        gap: 4px;
        background: var(--bg-tertiary);
        border-radius: 8px;
        padding: 3px;
        margin-bottom: -1px;
        width: fit-content;
    }

    .view-tab {
        padding: 6px 16px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--text-tertiary);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .view-tab:hover:not(:disabled) {
        color: var(--text-secondary);
        background: var(--border-primary);
    }

    .view-tab.active {
        background: var(--bg-primary);
        color: var(--text-primary);
        box-shadow: var(--shadow-sm);
    }

    .view-tab:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .comparison-body {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
    }

    .empty-state {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        color: var(--text-muted);
    }

    .empty-icon {
        font-size: 48px;
        opacity: 0.4;
    }

    .state-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--text-tertiary);
        margin: 0;
    }

    .state-text {
        font-size: 13px;
        color: var(--text-muted);
        margin: 0;
    }
</style>
