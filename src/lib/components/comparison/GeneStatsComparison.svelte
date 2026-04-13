<script>
import { compareGeneStats } from '$lib/services/comparisonService.js';

const { petA, petB } = $props();

let results = $state([]);
let loading = $state(false);
let error = $state(null);

// Reload when pets change
$effect(() => {
  if (petA?.id && petB?.id) {
    loadStats();
  }
});

async function loadStats() {
  try {
    loading = true;
    error = null;
    results = await compareGeneStats(petA, petB);
  } catch (err) {
    error = err.message || 'Failed to load gene stats';
    results = [];
  } finally {
    loading = false;
  }
}

function sumEntry(entry) {
  return entry.positive + entry.negative;
}

const totalsA = $derived.by(() => {
  const t = { positive: 0, negative: 0, dominant: 0, recessive: 0, mixed: 0 };
  for (const r of results) {
    t.positive += r.petA.positive;
    t.negative += r.petA.negative;
    t.dominant += r.petA.dominant;
    t.recessive += r.petA.recessive;
    t.mixed += r.petA.mixed;
  }
  return t;
});

const totalsB = $derived.by(() => {
  const t = { positive: 0, negative: 0, dominant: 0, recessive: 0, mixed: 0 };
  for (const r of results) {
    t.positive += r.petB.positive;
    t.negative += r.petB.negative;
    t.dominant += r.petB.dominant;
    t.recessive += r.petB.recessive;
    t.mixed += r.petB.mixed;
  }
  return t;
});
</script>

<div class="gene-stats-comparison">
    {#if loading}
        <div class="loading-state">
            <div class="spinner"></div>
            <p>Loading gene stats...</p>
        </div>
    {:else if error}
        <div class="error-state">⚠️ {error}</div>
    {:else if results.length > 0}
        <table class="stats-table">
            <thead>
                <tr>
                    <th class="attr-col">Attribute</th>
                    <th class="group-header pet-a-header" colspan="5">{petA.name}</th>
                    <th class="group-header pet-b-header" colspan="5">{petB.name}</th>
                </tr>
                <tr class="sub-header">
                    <th></th>
                    <th class="num pos" title="Positive genes">+</th>
                    <th class="num neg" title="Negative genes">−</th>
                    <th class="num" title="Dominant">●</th>
                    <th class="num" title="Recessive">○</th>
                    <th class="num" title="Mixed">◐</th>
                    <th class="num pos" title="Positive genes">+</th>
                    <th class="num neg" title="Negative genes">−</th>
                    <th class="num" title="Dominant">●</th>
                    <th class="num" title="Recessive">○</th>
                    <th class="num" title="Mixed">◐</th>
                </tr>
            </thead>
            <tbody>
                {#each results as row (row.key)}
                    <tr class="data-row">
                        <td class="attr-cell">
                            <span class="attr-icon">{row.icon}</span>
                            {row.name}
                        </td>
                        <td class="num pos" class:better={row.petA.positive > row.petB.positive}>{row.petA.positive}</td>
                        <td class="num neg" class:worse={row.petA.negative > row.petB.negative}>{row.petA.negative}</td>
                        <td class="num">{row.petA.dominant}</td>
                        <td class="num">{row.petA.recessive}</td>
                        <td class="num border-right">{row.petA.mixed}</td>
                        <td class="num pos" class:better={row.petB.positive > row.petA.positive}>{row.petB.positive}</td>
                        <td class="num neg" class:worse={row.petB.negative > row.petA.negative}>{row.petB.negative}</td>
                        <td class="num">{row.petB.dominant}</td>
                        <td class="num">{row.petB.recessive}</td>
                        <td class="num">{row.petB.mixed}</td>
                    </tr>
                {/each}
                <tr class="totals-row">
                    <td><strong>Total</strong></td>
                    <td class="num pos"><strong>{totalsA.positive}</strong></td>
                    <td class="num neg"><strong>{totalsA.negative}</strong></td>
                    <td class="num"><strong>{totalsA.dominant}</strong></td>
                    <td class="num"><strong>{totalsA.recessive}</strong></td>
                    <td class="num border-right"><strong>{totalsA.mixed}</strong></td>
                    <td class="num pos"><strong>{totalsB.positive}</strong></td>
                    <td class="num neg"><strong>{totalsB.negative}</strong></td>
                    <td class="num"><strong>{totalsB.dominant}</strong></td>
                    <td class="num"><strong>{totalsB.recessive}</strong></td>
                    <td class="num"><strong>{totalsB.mixed}</strong></td>
                </tr>
            </tbody>
        </table>
    {:else}
        <p class="empty-text">No gene data available for comparison.</p>
    {/if}
</div>

<style>
    .gene-stats-comparison {
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

    .stats-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
        background: var(--bg-primary);
        border-radius: 8px;
        overflow: hidden;
        box-shadow: var(--shadow-sm);
    }

    .stats-table th,
    .stats-table td {
        padding: 8px 6px;
        text-align: left;
        border-bottom: 1px solid var(--border-primary);
        white-space: nowrap;
    }

    .stats-table th {
        background: var(--bg-tertiary);
        font-weight: 600;
        color: var(--text-secondary);
    }

    .group-header {
        text-align: center;
        font-size: 12px;
        font-weight: 700;
        border-bottom: 2px solid var(--border-primary);
    }

    .pet-a-header {
        border-right: 2px solid var(--border-primary);
    }

    .sub-header th {
        font-size: 11px;
        font-weight: 600;
        text-align: center;
        padding: 4px 6px;
    }

    .num {
        text-align: center;
    }

    .pos { color: #16a34a; }
    .neg { color: #dc2626; }

    .better {
        font-weight: 700;
        background: rgba(22, 163, 74, 0.08);
    }

    .worse {
        font-weight: 700;
        background: rgba(220, 38, 38, 0.08);
    }

    .border-right {
        border-right: 2px solid var(--border-primary);
    }

    .attr-cell {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .attr-icon {
        font-size: 13px;
    }

    .data-row {
        transition: background-color 0.15s ease;
    }

    .data-row:hover {
        background: var(--bg-secondary);
    }

    .totals-row {
        border-top: 2px solid var(--border-primary);
        background: var(--bg-secondary);
    }

    .empty-text {
        color: var(--text-muted);
        font-size: 13px;
        text-align: center;
        padding: 40px;
    }
</style>
