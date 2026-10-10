<script lang="ts">
/**
 * The genes behind a pet's Quality score, most valuable first: the Stats
 * drawer body of the Quality lens. Picking a row outlines the gene on the
 * grid.
 */
import { type QualityRow, STANDING_HINT, STANDING_LABEL } from '$lib/utils/qualityLens.js';

interface Props {
  rows: readonly QualityRow[];
  share: number;
  total: number;
  inStable: boolean;
  meaningful: boolean;
  highlighted: string | null;
  onSelect: (gene: string) => void;
}

const { rows, share, total, inStable, meaningful, highlighted, onSelect }: Props = $props();

const value = (v: number) => v.toFixed(v < 0.1 ? 2 : 1);
</script>

<div class="quality-list" data-testid="quality-gene-list">
  {#if !meaningful}
    <p class="note">Too few stabled pets of this species to compare against each other.</p>
  {:else if rows.length === 0}
    <p class="note" data-testid="quality-none">
      Nothing here is irreplaceable: every benefit allele {inStable ? 'it carries' : 'it would bring'} is available from
      another stabled pet.
    </p>
  {:else}
    <p class="note">
      {value(total)} slot-units, {share.toFixed(0)}% of the stable's total{inStable ? '' : ' if added to it'}. 1 = the only
      pet breeding an allele true, 0.5 = the only carrier; alleles locked to a breed you are not breeding count less.
    </p>
    <table>
      <thead>
        <tr>
          <th scope="col">Gene</th>
          <th scope="col">Gives</th>
          <th scope="col">Why</th>
          <th scope="col" class="numeric">Value</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (`${row.gene}:${row.allele}`)}
          <tr
            class:selected={highlighted === row.gene}
            data-testid="quality-row-{row.gene}"
            tabindex="0"
            title="Show {row.gene} on the grid"
            onclick={() => onSelect(row.gene)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(row.gene);
              }
            }}
          >
            <td class="gene">{row.gene} {row.allele}</td>
            <td>
              {row.benefits.join(', ')}
              {#if !row.generic}<span class="muted">· breed-locked</span>{/if}
            </td>
            <td class="standing {row.standing}" title={STANDING_HINT[row.standing]}>{STANDING_LABEL[row.standing]}</td>
            <td class="numeric">{value(row.value)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .quality-list {
    padding: var(--space-sm) var(--space-md);
    font-size: 12px;
  }

  .note {
    margin: 0 0 var(--space-sm);
    line-height: 1.5;
    color: var(--text-tertiary);
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th {
    text-align: left;
    font-weight: 600;
    color: var(--text-secondary);
    padding: var(--space-2xs) var(--space-xs);
    border-bottom: 1px solid var(--border-primary);
    white-space: nowrap;
  }

  td {
    padding: var(--space-2xs) var(--space-xs);
    border-bottom: 1px solid var(--border-primary);
    vertical-align: top;
  }

  tbody tr {
    cursor: pointer;
  }

  tbody tr:hover,
  tbody tr:focus-visible {
    background: var(--bg-tertiary);
  }

  tbody tr.selected {
    background: color-mix(in oklab, var(--gene-positive) 14%, transparent);
  }

  .gene {
    font-family: ui-monospace, monospace;
    white-space: nowrap;
  }

  .standing {
    white-space: nowrap;
  }

  .standing.sole {
    font-weight: 600;
    color: var(--text-primary);
  }

  .numeric {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .muted {
    color: var(--text-tertiary);
  }
</style>
