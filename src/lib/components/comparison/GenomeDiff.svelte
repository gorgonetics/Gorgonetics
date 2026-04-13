<script>
import { diffGenomes } from '$lib/services/comparisonService.js';

const { petA, petB } = $props();

let diffs = $state([]);
let summary = $state(null);
let loading = $state(false);
let error = $state(null);
let showDiffsOnly = $state(false);

// Track which chromosomes are expanded
let expandedChromosomes = $state(new Set());

$effect(() => {
  if (petA?.id && petB?.id) {
    loadDiff();
  }
});

async function loadDiff() {
  try {
    loading = true;
    error = null;
    const result = await diffGenomes(petA, petB);
    diffs = result.diffs;
    summary = result.summary;

    // Auto-expand chromosomes with differences
    const expanded = new Set();
    for (const d of diffs) {
      if (d.differentGenes > 0) expanded.add(d.chromosome);
    }
    expandedChromosomes = expanded;
  } catch (err) {
    error = err.message || 'Failed to load genome diff';
    diffs = [];
    summary = null;
  } finally {
    loading = false;
  }
}

function toggleChromosome(chr) {
  expandedChromosomes = new Set(expandedChromosomes);
  if (expandedChromosomes.has(chr)) {
    expandedChromosomes.delete(chr);
  } else {
    expandedChromosomes.add(chr);
  }
}

function geneTypeLabel(type) {
  if (!type) return '·';
  return type;
}

function geneTypeClass(type) {
  if (type === 'D') return 'dominant';
  if (type === 'R') return 'recessive';
  if (type === 'x') return 'mixed';
  if (type === '?') return 'unknown';
  return 'empty';
}
</script>

<div class="genome-diff">
    {#if loading}
        <div class="loading-state">
            <div class="spinner"></div>
            <p>Computing genome diff...</p>
        </div>
    {:else if error}
        <div class="error-state">⚠️ {error}</div>
    {:else if summary}
        <div class="diff-summary">
            <span class="similarity-badge">
                {summary.similarityPercent}% identical
            </span>
            <span class="summary-detail">
                {summary.identicalGenes}/{summary.totalGenes} genes match
                · {summary.differentGenes} difference{summary.differentGenes !== 1 ? 's' : ''}
            </span>
            <label class="diff-toggle">
                <input type="checkbox" bind:checked={showDiffsOnly} />
                Show differences only
            </label>
        </div>

        <div class="chromosome-list">
            {#each diffs as chrDiff (chrDiff.chromosome)}
                {@const hasDiffs = chrDiff.differentGenes > 0}
                {@const isExpanded = expandedChromosomes.has(chrDiff.chromosome)}
                {@const visibleGenes = showDiffsOnly ? chrDiff.genes.filter(g => g.isDifferent) : chrDiff.genes}

                {#if !showDiffsOnly || hasDiffs}
                    <div class="chromosome-section" class:has-diffs={hasDiffs}>
                        <button class="chromosome-header" onclick={() => toggleChromosome(chrDiff.chromosome)}>
                            <span class="chr-expand">{isExpanded ? '▾' : '▸'}</span>
                            <span class="chr-name">Chromosome {chrDiff.chromosome}</span>
                            <span class="chr-stats">
                                {#if hasDiffs}
                                    <span class="chr-identical">{chrDiff.identicalGenes}/{chrDiff.totalGenes} identical</span>
                                    <span class="chr-different">{chrDiff.differentGenes} diff</span>
                                {:else}
                                    <span class="chr-match">✓ all match</span>
                                {/if}
                            </span>
                        </button>

                        {#if isExpanded && visibleGenes.length > 0}
                            <div class="chromosome-body">
                                <div class="gene-grid">
                                    <div class="gene-grid-header">
                                        <span class="gene-col-id">Gene</span>
                                        <span class="gene-col-type">{petA.name}</span>
                                        <span class="gene-col-type">{petB.name}</span>
                                        <span class="gene-col-effect">Effect</span>
                                    </div>
                                    {#each visibleGenes as gene (gene.geneId)}
                                        <div class="gene-row" class:diff-row={gene.isDifferent}>
                                            <span class="gene-col-id">{gene.geneId}</span>
                                            <span class="gene-col-type">
                                                <span class="gene-type-cell {geneTypeClass(gene.petAType)}">{geneTypeLabel(gene.petAType)}</span>
                                            </span>
                                            <span class="gene-col-type">
                                                <span class="gene-type-cell {geneTypeClass(gene.petBType)}">{geneTypeLabel(gene.petBType)}</span>
                                            </span>
                                            <span class="gene-col-effect">
                                                {#if gene.isDifferent && (gene.petAEffect || gene.petBEffect)}
                                                    {#if gene.petAEffect && gene.petAEffect !== 'None'}
                                                        <span class="effect-label effect-a" title="{petA.name}: {gene.petAEffect}">{gene.petAEffect}</span>
                                                    {/if}
                                                    {#if gene.petBEffect && gene.petBEffect !== 'None'}
                                                        <span class="effect-label effect-b" title="{petB.name}: {gene.petBEffect}">{gene.petBEffect}</span>
                                                    {/if}
                                                {/if}
                                            </span>
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        {/if}
                    </div>
                {/if}
            {/each}
        </div>
    {:else}
        <p class="empty-text">No genome data available for comparison.</p>
    {/if}
</div>

<style>
    .genome-diff {
        width: 100%;
    }

    .loading-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 40px;
        color: var(--text-muted);
        font-size: 13px;
    }

    .spinner {
        width: 24px;
        height: 24px;
        border: 3px solid var(--border-primary);
        border-top: 3px solid var(--accent);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    .error-state {
        padding: 12px 16px;
        background: var(--error-bg);
        border: 1px solid var(--error-border);
        border-radius: 6px;
        color: var(--error-text);
        font-size: 13px;
    }

    .diff-summary {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        background: var(--bg-secondary);
        border-radius: 8px;
        margin-bottom: 16px;
        flex-wrap: wrap;
    }

    .similarity-badge {
        font-size: 14px;
        font-weight: 700;
        color: var(--text-primary);
        padding: 4px 10px;
        background: var(--bg-tertiary);
        border-radius: 10px;
    }

    .summary-detail {
        font-size: 12px;
        color: var(--text-secondary);
    }

    .diff-toggle {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--text-secondary);
        cursor: pointer;
    }

    .diff-toggle input {
        cursor: pointer;
    }

    .chromosome-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .chromosome-section {
        border: 1px solid var(--border-primary);
        border-radius: 8px;
        overflow: hidden;
    }

    .chromosome-section.has-diffs {
        border-color: var(--warning-border, #f59e0b);
    }

    .chromosome-header {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 8px 12px;
        background: var(--bg-secondary);
        border: none;
        cursor: pointer;
        font-size: 13px;
        text-align: left;
        transition: background 0.15s ease;
    }

    .chromosome-header:hover {
        background: var(--bg-tertiary);
    }

    .chr-expand {
        color: var(--text-tertiary);
        font-size: 11px;
        width: 12px;
    }

    .chr-name {
        font-weight: 600;
        color: var(--text-primary);
    }

    .chr-stats {
        margin-left: auto;
        display: flex;
        gap: 8px;
        font-size: 11px;
    }

    .chr-identical {
        color: var(--text-tertiary);
    }

    .chr-different {
        color: #dc2626;
        font-weight: 600;
    }

    .chr-match {
        color: #16a34a;
    }

    .chromosome-body {
        border-top: 1px solid var(--border-primary);
        padding: 8px;
    }

    .gene-grid {
        display: flex;
        flex-direction: column;
        font-size: 11px;
    }

    .gene-grid-header {
        display: grid;
        grid-template-columns: 60px 50px 50px 1fr;
        gap: 4px;
        padding: 4px 8px;
        font-weight: 600;
        color: var(--text-tertiary);
        border-bottom: 1px solid var(--border-primary);
        margin-bottom: 2px;
    }

    .gene-row {
        display: grid;
        grid-template-columns: 60px 50px 50px 1fr;
        gap: 4px;
        padding: 2px 8px;
        align-items: center;
        border-radius: 4px;
    }

    .gene-row.diff-row {
        background: rgba(234, 179, 8, 0.1);
    }

    .gene-col-id {
        font-family: monospace;
        font-size: 11px;
        color: var(--text-secondary);
    }

    .gene-col-type {
        text-align: center;
    }

    .gene-type-cell {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        font-size: 11px;
        font-weight: 700;
        font-family: monospace;
    }

    .gene-type-cell.dominant {
        background: var(--accent);
        color: white;
    }

    .gene-type-cell.recessive {
        background: transparent;
        border: 2px solid var(--accent);
        color: var(--accent);
    }

    .gene-type-cell.mixed {
        background: linear-gradient(135deg, var(--accent) 50%, transparent 50%);
        border: 2px solid var(--accent);
        color: white;
    }

    .gene-type-cell.unknown {
        background: var(--bg-tertiary);
        color: var(--text-muted);
    }

    .gene-type-cell.empty {
        background: var(--bg-tertiary);
        color: var(--text-muted);
    }

    .gene-col-effect {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
    }

    .effect-label {
        font-size: 10px;
        padding: 1px 5px;
        border-radius: 6px;
        white-space: nowrap;
        max-width: 120px;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .effect-label.effect-a {
        background: rgba(59, 130, 246, 0.1);
        color: var(--accent);
    }

    .effect-label.effect-b {
        background: rgba(168, 85, 247, 0.1);
        color: #a855f7;
    }

    .empty-text {
        color: var(--text-muted);
        font-size: 13px;
        text-align: center;
        padding: 40px;
    }
</style>
