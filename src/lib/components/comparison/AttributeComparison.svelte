<script>
import { compareAttributes } from '$lib/services/comparisonService.js';

const { petA, petB } = $props();

const results = $derived(petA && petB ? compareAttributes(petA, petB) : []);

const summary = $derived.by(() => {
  let aWins = 0;
  let bWins = 0;
  let ties = 0;
  for (const r of results) {
    if (r.winner === 'a') aWins++;
    else if (r.winner === 'b') bWins++;
    else ties++;
  }
  return { aWins, bWins, ties };
});
</script>

<div class="attribute-comparison">
    {#each results as attr (attr.key)}
        <div class="attr-row">
            <div class="attr-header">
                <span class="attr-icon">{attr.icon}</span>
                <span class="attr-name">{attr.name}</span>
                {#if attr.winner !== 'tie'}
                    <span class="diff-badge" class:positive={attr.diff > 0} class:negative={attr.diff < 0}>
                        {attr.diff > 0 ? '+' : ''}{attr.diff}
                    </span>
                {/if}
            </div>
            <div class="attr-bars">
                <div class="bar-row">
                    <span class="bar-label pet-a-label">{petA.name}</span>
                    <div class="bar-track">
                        <div
                            class="bar-fill"
                            class:winner={attr.winner === 'a'}
                            class:loser={attr.winner === 'b'}
                            style="width: {attr.petAValue}%"
                        ></div>
                    </div>
                    <span class="bar-value" class:winner-text={attr.winner === 'a'}>{attr.petAValue}</span>
                </div>
                <div class="bar-row">
                    <span class="bar-label pet-b-label">{petB.name}</span>
                    <div class="bar-track">
                        <div
                            class="bar-fill"
                            class:winner={attr.winner === 'b'}
                            class:loser={attr.winner === 'a'}
                            style="width: {attr.petBValue}%"
                        ></div>
                    </div>
                    <span class="bar-value" class:winner-text={attr.winner === 'b'}>{attr.petBValue}</span>
                </div>
            </div>
        </div>
    {/each}

    <div class="summary-row">
        <span class="summary-item winner-text">
            {petA.name}: {summary.aWins} win{summary.aWins !== 1 ? 's' : ''}
        </span>
        <span class="summary-divider">·</span>
        <span class="summary-item tie-text">
            {summary.ties} tie{summary.ties !== 1 ? 's' : ''}
        </span>
        <span class="summary-divider">·</span>
        <span class="summary-item loser-text">
            {petB.name}: {summary.bWins} win{summary.bWins !== 1 ? 's' : ''}
        </span>
    </div>
</div>

<style>
    .attribute-comparison {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .attr-row {
        background: var(--bg-secondary);
        border-radius: 8px;
        padding: 12px 16px;
    }

    .attr-header {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 8px;
    }

    .attr-icon {
        font-size: 14px;
    }

    .attr-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary);
    }

    .diff-badge {
        margin-left: auto;
        font-size: 11px;
        font-weight: 700;
        padding: 1px 6px;
        border-radius: 8px;
    }

    .diff-badge.positive {
        background: rgba(22, 163, 74, 0.1);
        color: #16a34a;
    }

    .diff-badge.negative {
        background: rgba(220, 38, 38, 0.1);
        color: #dc2626;
    }

    .attr-bars {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .bar-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .bar-label {
        font-size: 11px;
        color: var(--text-tertiary);
        width: 80px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex-shrink: 0;
    }

    .bar-track {
        flex: 1;
        height: 14px;
        background: var(--bg-tertiary);
        border-radius: 7px;
        overflow: hidden;
    }

    .bar-fill {
        height: 100%;
        border-radius: 7px;
        background: var(--border-secondary);
        transition: width 0.3s ease;
        min-width: 2px;
    }

    .bar-fill.winner {
        background: #16a34a;
    }

    .bar-fill.loser {
        background: var(--border-secondary);
    }

    .bar-value {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-secondary);
        width: 32px;
        text-align: right;
        flex-shrink: 0;
    }

    .bar-value.winner-text {
        color: #16a34a;
    }

    .summary-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 12px;
        background: var(--bg-tertiary);
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
    }

    .summary-item.winner-text {
        color: #16a34a;
    }

    .summary-item.tie-text {
        color: var(--text-tertiary);
    }

    .summary-item.loser-text {
        color: #dc2626;
    }

    .summary-divider {
        color: var(--text-muted);
    }
</style>
