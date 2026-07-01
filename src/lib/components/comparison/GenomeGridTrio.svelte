<script lang="ts">
import { onDestroy, onMount, untrack } from 'svelte';
import BreedSelector from '$lib/components/shared/BreedSelector.svelte';
import GeneFilterPills, { type FilterPillItem } from '$lib/components/shared/GeneFilterPills.svelte';
import StatusPane from '$lib/components/shared/StatusPane.svelte';
import { getAttributeConfig, normalizeSpecies } from '$lib/services/configService.js';
import { getGeneEffectsCached } from '$lib/services/geneService.js';
import { computeOffspringTrio } from '$lib/services/offspringTrioService.js';
import { type AttributeInfo, GeneType, HORSE_BREEDS, type OffspringTrioResult, type Pet } from '$lib/types/index.js';
import { attributeFilterCSS } from '$lib/utils/filterCSS.js';
import { triStateToggle } from '$lib/utils/filterToggle.js';
import { buildAppearanceLookup, createGeneCellBuilder, type GeneCell } from '$lib/utils/geneGridCells.js';
import { capitalize } from '$lib/utils/string.js';
import { buildTrioGrid, type TrioGrid, type TrioLocusCell } from '$lib/utils/trioGrid.js';

interface Props {
  father: Pet;
  mother: Pet;
  offspringBreed?: string;
}

const { father, mother, offspringBreed = '' }: Props = $props();

const isHorse = $derived(normalizeSpecies(father.species) === 'horse');

let loading = $state(false);
let error = $state<string | null>(null);
let grid = $state<TrioGrid | null>(null);
let summary = $state<OffspringTrioResult['summary'] | null>(null);
let attributeDisplayInfo = $state<AttributeInfo[]>([]);
const attributeItems = $derived<FilterPillItem[]>(
  attributeDisplayInfo.map((a) => ({ key: a.key, name: a.name, icon: a.icon })),
);

// Breed re-runs the projection (the service drops loci locked to other breeds,
// keeping the trio consistent with the breeding ranking). Attribute is a visual
// focus filter applied as CSS over the rendered grid — the same engine the
// 2-pet diff grid uses (select dims everything else, alt-click hides).
let selectedBreed = $state(untrack(() => offspringBreed));
let selectedAttributes = $state<string[]>([]);
let hiddenAttributes = $state<string[]>([]);
// "New gains only": hide locked loci — those where both parents share the same
// homozygous allele (both dominant or both recessive), so every offspring is
// fixed to that same genotype and nothing new can appear. This is broader than
// a "locked-in gain" (it includes neutral loci with no attribute effect), which
// is what the player means by "won't change in the offspring".
let hideLocked = $state(false);

/** Locked = both parents the same homozygous allele → offspring can't differ. */
function isLocked(cell: TrioLocusCell): boolean {
  const f = cell.fatherType;
  return f !== null && f === cell.motherType && (f === GeneType.DOMINANT || f === GeneType.RECESSIVE);
}

const lockedCount = $derived.by(() => {
  if (!grid) return 0;
  let n = 0;
  for (const row of grid.rows) for (const key in row.cells) if (isLocked(row.cells[key])) n++;
  return n;
});

// Gains the offspring could newly acquire — a gain at a non-locked locus.
const newGainCount = $derived.by(() => {
  if (!grid) return 0;
  let n = 0;
  for (const row of grid.rows)
    for (const key in row.cells) {
      const c = row.cells[key];
      if (c.verdict === 'gain' && !isLocked(c)) n++;
    }
  return n;
});

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
                    <BreedSelector
                        value={selectedBreed}
                        breeds={HORSE_BREEDS}
                        label="Offspring breed"
                        onChange={(v) => { selectedBreed = v; }}
                    />
                </div>
            {/if}
            {#if attributeItems.length > 0}
                <GeneFilterPills
                    label="Attribute"
                    items={attributeItems}
                    selected={selectedAttributes}
                    hidden={hiddenAttributes}
                    onToggle={toggleAttributeFilter}
                    onReset={() => { selectedAttributes = []; hiddenAttributes = []; }}
                    hint="Click to focus · Ctrl+click multi-select · Alt+click hide"
                    testid="trio-attribute-filter"
                />
            {/if}
        </div>
    {/if}

    {#if loading}
        <StatusPane variant="loading" body="Building offspring projection…" />
    {:else if error}
        <StatusPane variant="error" icon="⚠️" body={error} />
    {:else if grid && summary && grid.rows.length > 0}
        <div class="trio-summary">
            <span class="chip chip-gain">{hideLocked ? newGainCount : summary.gains} {hideLocked ? 'new gains' : 'gains'}</span>
            <span class="chip chip-risk">{summary.risks} risks</span>
            {#if lockedCount > 0}
                <button
                    type="button"
                    class="chip chip-lock toggle"
                    class:active={hideLocked}
                    aria-pressed={hideLocked}
                    data-testid="trio-hide-locked"
                    title="Locked: both parents share the same allele (both dominant or both recessive), so the offspring can't differ here. Toggle to hide these and show new gains only."
                    onclick={() => { hideLocked = !hideLocked; }}
                >
                    {lockedCount} locked{hideLocked ? ' · hidden' : ''}
                </button>
            {/if}
            {#if summary.unknownLoci > 0}
                <span class="chip chip-unknown">{summary.unknownLoci} unknown</span>
            {/if}
            <span class="legend">
                <span class="legend-item"><span class="swatch swatch-gain"></span>gain</span>
                <span class="legend-item"><span class="swatch swatch-risk"></span>risk</span>
            </span>
        </div>

        <div class="grid-container trio-grid-container" class:hide-locked={hideLocked}>
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
                                            <div class={cell.fatherCell.attributeCls} class:fixed={isLocked(cell)} data-attr={cell.fatherCell.attribute} title={parentTitle(cell.fatherCell, 'Father')}>
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
                                                class:fixed={isLocked(cell)}
                                                data-attr={cell.attribute ?? ''}
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
                                            <div class={cell.motherCell.attributeCls} class:fixed={isLocked(cell)} data-attr={cell.motherCell.attribute} title={parentTitle(cell.motherCell, 'Mother')}>
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
    /* Flex column so the grid-container can be the single scroll region while
       the filters + summary stay pinned above it. */
    .genome-grid-trio { width: 100%; height: 100%; display: flex; flex-direction: column; min-height: 0; }

    .trio-filters {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 12px;
        flex-shrink: 0;
    }
    /* Attribute pills → GeneFilterPills; breed picker → shared BreedSelector. */
    .breed-filter { display: flex; padding: 0 4px; }

    .trio-summary {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
        flex-wrap: wrap;
        flex-shrink: 0;
    }
    .chip {
        font-size: 12px;
        font-weight: 600;
        padding: 2px 10px;
        border-radius: 10px;
        background: var(--bg-tertiary);
        color: var(--text-secondary);
    }
    .chip.toggle { cursor: pointer; border: 1px solid transparent; }
    .chip.toggle:hover { border-color: var(--border-secondary); }
    .chip.toggle.active { border-color: var(--accent); color: var(--text-primary); background: color-mix(in srgb, var(--accent) 16%, transparent); }
    .chip-gain { background: color-mix(in srgb, var(--gene-positive) 18%, transparent); color: var(--gene-positive); }
    .chip-risk { background: color-mix(in srgb, var(--gene-negative) 18%, transparent); color: var(--gene-negative); }
    .legend { display: flex; gap: 10px; margin-left: auto; font-size: 11px; color: var(--text-tertiary); }
    .legend-item { display: inline-flex; align-items: center; gap: 4px; }
    .swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
    .swatch-gain { border: 2px solid var(--gene-positive); }
    .swatch-risk { border: 2px solid var(--gene-negative); }

    .grid-container {
        flex: 1;
        min-height: 0;
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

    /* Parent cells share the offspring bar's box size so the three rows line up
       column-for-column (the shared .gene-cell is 14px elsewhere). */
    .trio-table :global(.gene-cell) { width: 20px; height: 20px; }

    /* "New gains only": fade locked loci out of ALL three rows (both parents and
       the offspring) so the remaining gain-coloured bars are only new gains. */
    .trio-grid-container.hide-locked .fixed { opacity: 0.12; }
    .trio-grid-container.hide-locked .dist-bar.fixed { border-color: transparent; box-shadow: none; }

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
