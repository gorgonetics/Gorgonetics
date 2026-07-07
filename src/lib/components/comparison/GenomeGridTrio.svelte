<script lang="ts">
import { onDestroy, onMount, untrack } from 'svelte';
import StatusPane from '$lib/components/shared/StatusPane.svelte';
import { getAttributeConfig, normalizeSpecies } from '$lib/services/configService.js';
import { getGeneEffectsCached } from '$lib/services/geneService.js';
import { computeOffspringTrio } from '$lib/services/offspringTrioService.js';
import { type AttributeInfo, HORSE_BREEDS, type OffspringTrioResult, type Pet } from '$lib/types/index.js';
import { attributeFilterCSS } from '$lib/utils/filterCSS.js';
import { triStateToggle } from '$lib/utils/filterToggle.js';
import { buildAppearanceLookup, createGeneCellBuilder, type GeneCell } from '$lib/utils/geneGridCells.js';
import { capitalize } from '$lib/utils/string.js';
import {
  buildTrioGrid,
  distBarBackground,
  isUnknownDist,
  type TrioGrid,
  type TrioLocusCell,
} from '$lib/utils/trioGrid.js';

interface Props {
  father: Pet;
  mother: Pet;
  offspringBreed?: string;
}

const { father, mother, offspringBreed = '' }: Props = $props();

const isHorse = $derived(normalizeSpecies(father.species) === 'horse');
const horseBreeds = Object.entries(HORSE_BREEDS);

let loading = $state(false);
let error = $state<string | null>(null);
let grid = $state<TrioGrid | null>(null);
let summary = $state<OffspringTrioResult['summary'] | null>(null);
let attributeDisplayInfo = $state<AttributeInfo[]>([]);

// Breed re-runs the projection (the service drops loci locked to other breeds,
// keeping the trio consistent with the breeding ranking). Attribute is a visual
// focus filter applied as CSS over the rendered grid — the same engine the
// 2-pet diff grid uses (select dims everything else, alt-click hides).
let selectedBreed = $state(untrack(() => offspringBreed));
let selectedAttributes = $state<string[]>([]);
let hiddenAttributes = $state<string[]>([]);

const ALLELE_LABEL: Record<string, string> = { D: 'Dominant', x: 'Mixed', R: 'Recessive', unknown: 'Unknown' };
const VERDICT_LABEL: Record<string, string> = { gain: 'Gain', risk: 'Risk', neutral: '' };

$effect(() => {
  if (father?.id && mother?.id) {
    load(father, mother, selectedBreed);
  }
});

// Dynamic filter stylesheet — the zero-rerender pattern from GenomeGridDiff,
// scoped to this modal's grid so it can't leak into the diff grid.
let filterStyleEl: HTMLStyleElement | null = null;
onMount(() => {
  filterStyleEl = document.createElement('style');
  filterStyleEl.id = 'trio-grid-filters';
  document.head.appendChild(filterStyleEl);
});
onDestroy(() => {
  filterStyleEl?.remove();
  filterStyleEl = null;
});
$effect(() => {
  if (!filterStyleEl) return;
  // `*` cell selector: the trio's three rows use different cell classes
  // (`.gene-cell` parents, `.dist-bar` offspring); all carry `data-attr`.
  filterStyleEl.textContent = attributeFilterCSS('.trio-grid-container', '*', selectedAttributes, hiddenAttributes);
});

function toggleAttributeFilter(attrKey: string, ctrlKey: boolean, altKey: boolean) {
  ({ selected: selectedAttributes, hidden: hiddenAttributes } = triStateToggle(
    attrKey,
    selectedAttributes,
    hiddenAttributes,
    ctrlKey,
    altKey,
  ));
}

async function load(f: Pet, m: Pet, breed: string) {
  try {
    loading = true;
    error = null;
    // A new pair or breed changes which loci exist; a focus carried over from
    // the previous set could dim the whole grid, so start unfiltered.
    selectedAttributes = [];
    hiddenAttributes = [];
    const sp = normalizeSpecies(f.species);
    const [result, efData] = await Promise.all([
      computeOffspringTrio(f, m, { species: sp, offspringBreed: breed }),
      getGeneEffectsCached(sp),
    ]);

    const effectsDB = efData?.effects ?? {};
    const config = getAttributeConfig(sp);
    attributeDisplayInfo = config.attributes;
    const cellBuilder = createGeneCellBuilder({
      effectsDB,
      attributeNames: config.all_attribute_names.map((n) => capitalize(n)),
      appearanceLookup: buildAppearanceLookup(sp),
      speciesKey: sp,
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

/** One-line aggregate label for the bar — carries the distribution the
 * removed per-segment spans no longer describe. */
function offspringAria(cell: TrioLocusCell) {
  return offspringTitle(cell).replace(/\n/g, '; ');
}

function parentTitle(cell: GeneCell | null, label: string) {
  if (!cell) return '';
  return `${label} · Gene ${cell.id} (${ALLELE_LABEL[cell.type] ?? cell.type})\n${cell.effect || 'No effect'}`;
}
</script>

<div class="genome-grid-trio">
    {#if !error}
        <div class="trio-filters">
            {#if isHorse}
                <div class="breed-filter" data-testid="trio-breed-filter">
                    <span class="breed-label">Breed:</span>
                    <button
                        type="button"
                        class="breed-btn"
                        class:active={selectedBreed === ''}
                        onclick={() => { selectedBreed = ''; }}
                    >All</button>
                    {#each horseBreeds as [name, abbrev] (name)}
                        <button
                            type="button"
                            class="breed-btn"
                            class:active={selectedBreed === name}
                            onclick={() => { selectedBreed = name; }}
                            title={name}
                        >{abbrev}</button>
                    {/each}
                </div>
            {/if}
            {#if attributeDisplayInfo.length > 0}
                <div class="attribute-filter" data-testid="trio-attribute-filter">
                    <span class="attr-filter-label">Attribute:</span>
                    <button
                        type="button"
                        class="attr-filter-btn"
                        class:active={selectedAttributes.length === 0 && hiddenAttributes.length === 0}
                        onclick={() => { selectedAttributes = []; hiddenAttributes = []; }}
                    >All</button>
                    {#each attributeDisplayInfo as attr (attr.key)}
                        <button
                            type="button"
                            class="attr-filter-btn"
                            class:active={selectedAttributes.includes(attr.key)}
                            class:hidden-attr={hiddenAttributes.includes(attr.key)}
                            onclick={(e) => toggleAttributeFilter(attr.key, e.ctrlKey || e.metaKey, e.altKey)}
                            title={attr.name}
                        >{attr.icon} {attr.name}</button>
                    {/each}
                </div>
                <span class="filter-hint">Click to focus · Ctrl+click multi-select · Alt+click hide</span>
            {/if}
        </div>
    {/if}

    {#if loading}
        <StatusPane variant="loading" body="Building offspring projection…" />
    {:else if error}
        <StatusPane variant="error" icon="⚠️" body={error} />
    {:else if grid && summary && grid.rows.length > 0}
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

        <div class="grid-container trio-grid-container">
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
                                            <div class={cell.fatherCell.attributeCls} data-attr={cell.fatherCell.attribute} title={parentTitle(cell.fatherCell, 'Father')}>
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
                                                class:unknown-dist={isUnknownDist(cell.segments)}
                                                data-attr={cell.attribute ?? ''}
                                                title={offspringTitle(cell)}
                                                aria-label={offspringAria(cell)}
                                                style="background: {distBarBackground(cell.segments)}"
                                            ></div>
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
                                            <div class={cell.motherCell.attributeCls} data-attr={cell.motherCell.attribute} title={parentTitle(cell.motherCell, 'Mother')}>
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
    {:else if selectedBreed}
        <p class="empty-text">No loci for the {selectedBreed} breed in this pair.</p>
    {:else}
        <p class="empty-text">No genome data available for this pair.</p>
    {/if}
</div>

<style>
    .genome-grid-trio { width: 100%; }

    .trio-filters {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 12px;
    }
    .breed-filter,
    .attribute-filter {
        display: flex;
        align-items: center;
        gap: 3px;
        flex-wrap: wrap;
        padding: 0 4px;
    }
    .breed-label,
    .attr-filter-label {
        font-size: 11px;
        font-weight: 600;
        color: var(--text-tertiary);
        margin-right: 4px;
    }
    .breed-btn,
    .attr-filter-btn {
        padding: 3px 8px;
        border: 1px solid var(--border-primary);
        border-radius: 4px;
        background: var(--bg-primary);
        color: var(--text-tertiary);
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
        white-space: nowrap;
    }
    .breed-btn:hover,
    .attr-filter-btn:hover { border-color: var(--border-secondary); color: var(--text-secondary); }
    .breed-btn.active,
    .attr-filter-btn.active { background: var(--accent); border-color: var(--accent); color: white; }
    .attr-filter-btn.hidden-attr {
        background: var(--error-bg);
        border-color: var(--error-border);
        color: var(--error-text);
        text-decoration: line-through;
    }
    .filter-hint { font-size: 11px; color: var(--text-tertiary); font-style: italic; padding: 0 4px; }

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
        width: 20px;
        height: 20px;
        margin: 0 auto;
        border-radius: 3px;
        overflow: hidden;
        border: 2px solid transparent;
        box-sizing: border-box;
        /* Clip the gradient to the padding box so it fills the same interior
           the per-segment spans did (inside the 2px verdict border). */
        background-clip: padding-box;
    }
    .dist-bar.verdict-gain { border-color: var(--gene-positive); }
    .dist-bar.verdict-risk { border-color: var(--gene-negative); }
    .dist-bar.locked { box-shadow: inset 0 0 0 1px var(--bg-secondary); }
    /* All-unknown offspring: same dimming the old striped `.tone-unknown` span had. */
    .dist-bar.unknown-dist { opacity: 0.6; }

    .unknown-symbol { color: var(--text-muted); font-size: 1em; font-weight: 600; }
    .empty-text { color: var(--text-muted); font-size: 13px; text-align: center; padding: 40px; }
</style>
