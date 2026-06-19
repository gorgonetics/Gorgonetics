<script lang="ts">
import StatusPane from '$lib/components/shared/StatusPane.svelte';
import { getAttributeConfig, normalizeSpecies } from '$lib/services/configService.js';
import { getGeneEffectsCached } from '$lib/services/geneService.js';
import { computeOffspringTrio } from '$lib/services/offspringTrioService.js';
import type { OffspringTrioResult, Pet } from '$lib/types/index.js';
import { buildAppearanceLookup, createGeneCellBuilder, type GeneCell } from '$lib/utils/geneGridCells.js';
import { capitalize } from '$lib/utils/string.js';
import { buildTrioGrid, type TrioGrid, type TrioLocusCell } from '$lib/utils/trioGrid.js';

interface Props {
  father: Pet;
  mother: Pet;
  offspringBreed?: string;
}

const { father, mother, offspringBreed = '' }: Props = $props();

let loading = $state(false);
let error = $state<string | null>(null);
let grid = $state<TrioGrid | null>(null);
let summary = $state<OffspringTrioResult['summary'] | null>(null);

const ALLELE_LABEL: Record<string, string> = { D: 'Dominant', x: 'Mixed', R: 'Recessive', unknown: 'Unknown' };
const VERDICT_LABEL: Record<string, string> = { gain: 'Gain', risk: 'Risk', neutral: '' };

$effect(() => {
  if (father?.id && mother?.id) {
    load(father, mother, offspringBreed);
  }
});

async function load(f: Pet, m: Pet, breed: string) {
  try {
    loading = true;
    error = null;
    const species = normalizeSpecies(f.species);
    const [result, efData] = await Promise.all([
      computeOffspringTrio(f, m, { species, offspringBreed: breed }),
      getGeneEffectsCached(species),
    ]);

    const effectsDB = efData?.effects ?? {};
    const attributeNames = getAttributeConfig(species).all_attribute_names.map((n) => capitalize(n));
    const cellBuilder = createGeneCellBuilder({
      effectsDB,
      attributeNames,
      appearanceLookup: buildAppearanceLookup(species),
      speciesKey: species,
    });

    grid = buildTrioGrid(result, cellBuilder);
    summary = result.summary;
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : 'Failed to build the trio view';
    grid = null;
    summary = null;
  } finally {
    loading = false;
  }
}

/** Hover text for the offspring distribution cell. */
function offspringTitle(cell: TrioLocusCell) {
  const parts = [`Gene ${cell.geneId}`];
  if (cell.attribute) parts.push(cell.attribute);
  if (cell.verdict !== 'neutral') {
    const via = cell.source === 'both' ? 'both parents' : cell.source ? `the ${cell.source}` : '';
    const lock = cell.lockedIn ? ' (locked in)' : '';
    parts.push(`${VERDICT_LABEL[cell.verdict]}${lock}${via ? ` via ${via}` : ''}`);
  }
  parts.push(`P(+) ${Math.round(cell.pPositive * 100)}%  P(−) ${Math.round(cell.pNegative * 100)}%`);
  const dist = cell.segments.map((s) => `${ALLELE_LABEL[s.allele]} ${Math.round(s.pct)}%`).join(', ');
  parts.push(dist);
  return parts.join('\n');
}

function parentTitle(cell: GeneCell | null, label: string) {
  if (!cell) return '';
  return `${label} · Gene ${cell.id} (${ALLELE_LABEL[cell.type] ?? cell.type})\n${cell.effect || 'No effect'}`;
}
</script>

<div class="genome-grid-trio">
    {#if loading}
        <StatusPane variant="loading" body="Building offspring projection…" />
    {:else if error}
        <StatusPane variant="error" icon="⚠️" body={error} />
    {:else if grid && summary}
        <div class="trio-summary">
            <span class="chip chip-gain">{summary.gains} gains</span>
            <span class="chip chip-risk">{summary.risks} risks</span>
            <span class="chip chip-lock">{summary.lockedIn} locked in</span>
            {#if summary.unknownLoci > 0}
                <span class="chip chip-unknown">{summary.unknownLoci} unknown</span>
            {/if}
            <span class="legend">
                <span class="legend-item"><span class="swatch swatch-gain"></span>gain</span>
                <span class="legend-item"><span class="swatch swatch-risk"></span>risk</span>
            </span>
        </div>

        <div class="grid-container">
            <table class="trio-table">
                <thead>
                    <tr>
                        <th class="chr-header">Chr</th>
                        <th class="role-header">&nbsp;</th>
                        {#each grid.blocks as block (block)}
                            {#each grid.positionsByBlock[block] as pos (pos)}
                                <th class="pos-header {pos === 1 ? 'block-start' : ''}">{pos === 1 ? block : ''}</th>
                            {/each}
                        {/each}
                    </tr>
                </thead>
                <tbody>
                    {#each grid.rows as row (row.chromosome)}
                        <tr class="role-row father-row">
                            <td class="chr-label" rowspan="3">{row.chromosome}</td>
                            <td class="role-label">♂ Father</td>
                            {#each grid.blocks as block (block)}
                                {#each grid.positionsByBlock[block] as pos (pos)}
                                    {@const cell = row.cells[`${block}${pos}`]}
                                    <td class="grid-cell {pos === 1 ? 'block-start' : ''}">
                                        {#if cell?.fatherCell}
                                            <div class={cell.fatherCell.attributeCls} title={parentTitle(cell.fatherCell, 'Father')}>
                                                {#if cell.fatherCell.type === '?'}<span class="unknown-symbol">?</span>{/if}
                                            </div>
                                        {/if}
                                    </td>
                                {/each}
                            {/each}
                        </tr>
                        <tr class="role-row offspring-row">
                            <td class="role-label offspring-label">⚲ Offspring</td>
                            {#each grid.blocks as block (block)}
                                {#each grid.positionsByBlock[block] as pos (pos)}
                                    {@const cell = row.cells[`${block}${pos}`]}
                                    <td class="grid-cell offspring-cell {pos === 1 ? 'block-start' : ''}">
                                        {#if cell}
                                            <div
                                                class="dist-bar verdict-{cell.verdict}"
                                                class:locked={cell.lockedIn}
                                                title={offspringTitle(cell)}
                                            >
                                                {#each cell.segments as seg, i (i)}
                                                    <span class="seg tone-{seg.tone}" style="flex: {seg.pct} 0 0"></span>
                                                {/each}
                                            </div>
                                        {/if}
                                    </td>
                                {/each}
                            {/each}
                        </tr>
                        <tr class="role-row mother-row">
                            <td class="role-label">♀ Mother</td>
                            {#each grid.blocks as block (block)}
                                {#each grid.positionsByBlock[block] as pos (pos)}
                                    {@const cell = row.cells[`${block}${pos}`]}
                                    <td class="grid-cell {pos === 1 ? 'block-start' : ''}">
                                        {#if cell?.motherCell}
                                            <div class={cell.motherCell.attributeCls} title={parentTitle(cell.motherCell, 'Mother')}>
                                                {#if cell.motherCell.type === '?'}<span class="unknown-symbol">?</span>{/if}
                                            </div>
                                        {/if}
                                    </td>
                                {/each}
                            {/each}
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    {:else}
        <p class="empty-text">No genome data available for this pair.</p>
    {/if}
</div>

<style>
    .genome-grid-trio { width: 100%; }

    .trio-summary {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
        flex-wrap: wrap;
    }
    .chip {
        font-size: 12px;
        font-weight: 600;
        padding: 2px 10px;
        border-radius: 10px;
        background: var(--bg-tertiary);
        color: var(--text-secondary);
    }
    .chip-gain { background: color-mix(in srgb, var(--gene-positive) 18%, transparent); color: var(--gene-positive); }
    .chip-risk { background: color-mix(in srgb, var(--gene-negative) 18%, transparent); color: var(--gene-negative); }
    .legend { display: flex; gap: 10px; margin-left: auto; font-size: 11px; color: var(--text-tertiary); }
    .legend-item { display: inline-flex; align-items: center; gap: 4px; }
    .swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
    .swatch-gain { border: 2px solid var(--gene-positive); }
    .swatch-risk { border: 2px solid var(--gene-negative); }

    .grid-container {
        overflow: auto;
        border: 1px solid var(--border-primary);
        border-radius: 6px;
        background: var(--bg-secondary);
    }
    .trio-table { width: auto; border-collapse: collapse; table-layout: fixed; }

    thead th {
        position: sticky;
        top: 0;
        z-index: 10;
        background: var(--bg-secondary);
        border-bottom: 1px solid var(--border-primary);
        padding: 2px 4px;
        font-size: 9px;
        font-weight: normal;
        color: var(--text-secondary);
        text-align: center;
        white-space: nowrap;
    }
    .chr-header { position: sticky; left: 0; z-index: 11; width: 28px; min-width: 28px; font-weight: bold; }
    .role-header { position: sticky; left: 28px; z-index: 11; width: 72px; min-width: 72px; }
    .pos-header { width: 22px; min-width: 22px; max-width: 22px; }
    .pos-header.block-start { font-weight: bold; padding-left: 8px; }

    .chr-label {
        position: sticky;
        left: 0;
        z-index: 1;
        background: var(--bg-secondary);
        font-size: 10px;
        font-weight: 700;
        color: var(--text-secondary);
        text-align: center;
        vertical-align: middle;
        border-right: 1px solid var(--border-primary);
    }
    .role-label {
        position: sticky;
        left: 28px;
        z-index: 1;
        background: var(--bg-secondary);
        font-size: 9px;
        font-weight: 600;
        padding: 1px 6px;
        white-space: nowrap;
        border-right: 1px solid var(--border-primary);
        color: var(--text-secondary);
        width: 72px;
        min-width: 72px;
    }
    .offspring-label { color: var(--accent); font-weight: 700; }
    .mother-row { border-bottom: 2px solid var(--border-primary); }

    .grid-cell { padding: 1px; text-align: center; vertical-align: middle; }
    .grid-cell.block-start { padding-left: 8px; }

    /* Offspring row is taller and its cells host the distribution bar. */
    .offspring-cell { height: 26px; }
    .dist-bar {
        display: flex;
        width: 20px;
        height: 20px;
        margin: 0 auto;
        border-radius: 3px;
        overflow: hidden;
        border: 2px solid transparent;
        box-sizing: border-box;
    }
    .dist-bar.verdict-gain { border-color: var(--gene-positive); }
    .dist-bar.verdict-risk { border-color: var(--gene-negative); }
    .dist-bar.locked { box-shadow: inset 0 0 0 1px var(--bg-secondary); }
    .seg { display: block; height: 100%; }

    .tone-positive { background: var(--gene-positive); }
    .tone-negative { background: var(--gene-negative); }
    .tone-potential-positive { background: var(--gene-potential-positive); }
    .tone-potential-negative { background: var(--gene-potential-negative); }
    .tone-neutral { background: var(--gene-neutral); }
    .tone-unknown {
        background: repeating-linear-gradient(45deg, var(--gene-neutral) 0 2px, transparent 2px 4px);
        opacity: 0.6;
    }

    .unknown-symbol { color: var(--text-muted); font-size: 1em; font-weight: 600; }
    .empty-text { color: var(--text-muted); font-size: 13px; text-align: center; padding: 40px; }
</style>
