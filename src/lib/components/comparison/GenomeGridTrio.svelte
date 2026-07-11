<script lang="ts">
import { onDestroy, onMount, untrack } from 'svelte';
import '$lib/components/gene/geneCell.css';
import BreedSelector from '$lib/components/shared/BreedSelector.svelte';
import DetailOverlay from '$lib/components/shared/DetailOverlay.svelte';
import GeneFilterPills, { type FilterPillItem } from '$lib/components/shared/GeneFilterPills.svelte';
import StatusPane from '$lib/components/shared/StatusPane.svelte';
import { getAttributeConfig, normalizeSpecies } from '$lib/services/configService.js';
import { getGeneEffectsCached } from '$lib/services/geneService.js';
import { computeOffspringTrio } from '$lib/services/offspringTrioService.js';
import {
  type AttributeInfo,
  GeneType,
  HORSE_BREEDS,
  type OffspringTrioResult,
  type Pet,
  type TrioGainMode,
} from '$lib/types/index.js';
import { attributePotentialFilterCSS } from '$lib/utils/filterCSS.js';
import { triStateToggle } from '$lib/utils/filterToggle.js';
import { buildAppearanceLookup, createGeneCellBuilder, type GeneCell } from '$lib/utils/geneGridCells.js';
import { getSpeciesEmoji } from '$lib/utils/species.js';
import { capitalize } from '$lib/utils/string.js';
import { buildTrioGrid, outcomeBoxBackground, type TrioGrid, type TrioLocusCell } from '$lib/utils/trioGrid.js';

interface Props {
  father: Pet;
  mother: Pet;
  offspringBreed?: string;
  /** Back out of the trio lens (→ Pairs). */
  onClose: () => void;
}

const { father, mother, offspringBreed = '', onClose }: Props = $props();

const isHorse = $derived(normalizeSpecies(father.species) === 'horse');
const speciesLabel = $derived(normalizeSpecies(father.species));

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
// Which improvement the offspring boxes highlight as the vivid gain: expressing
// a new positive attribute, or "Clarification" (clearing a mixed gene to
// homozygous, so it breeds true). The other collapses into the muted keep shade.
let gainMode = $state<TrioGainMode>('attributes');

/** The gain bucket the current mode highlights. */
function activeGain(cell: TrioLocusCell): number {
  return gainMode === 'attributes' ? cell.buckets.newPositive : cell.buckets.clarifiedPositive;
}

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

// Loci where the offspring could gain what the current mode highlights.
const gainCount = $derived.by(() => {
  if (!grid) return 0;
  let n = 0;
  for (const row of grid.rows) for (const key in row.cells) if (activeGain(row.cells[key]) > 0) n++;
  return n;
});

// Loci where the offspring risks a loss (new negative, or losing a parent's positive).
const lossCount = $derived.by(() => {
  if (!grid) return 0;
  let n = 0;
  for (const row of grid.rows) for (const key in row.cells) if (row.cells[key].buckets.loss > 0) n++;
  return n;
});

const ALLELE_LABEL: Record<string, string> = { D: 'Dominant', x: 'Mixed', R: 'Recessive', unknown: 'Unknown' };

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
  // (`.gene-cell` parents, `.dist-bar` offspring); all carry `data-attrs`.
  // Potential-attribute match keeps both parents + the offspring lit at every
  // locus whose gene could affect the attribute, even where a parent's current
  // allele is neutral.
  filterStyleEl.textContent = attributePotentialFilterCSS(
    '.trio-grid-container',
    '*',
    selectedAttributes,
    hiddenAttributes,
  );
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

const BUCKET_LABEL: { key: keyof TrioLocusCell['buckets']; label: string }[] = [
  { key: 'newPositive', label: 'new positive' },
  { key: 'clarifiedPositive', label: 'clarify a positive' },
  { key: 'keepPositive', label: 'keep a positive' },
  { key: 'neutral', label: 'neutral' },
  { key: 'keepNegative', label: 'keep a negative' },
  { key: 'loss', label: 'lose / worsen' },
];

/** Hover text for the offspring outcome cell — the Punnett breakdown vs parents. */
function offspringTitle(cell: TrioLocusCell) {
  const parts = [`Gene ${cell.geneId}`];
  if (cell.attribute) parts.push(cell.attribute);
  if (cell.buckets.unknown >= 1) {
    parts.push('Unknown — not visible at your genetics skill');
    return parts.join('\n');
  }
  const outcomes = BUCKET_LABEL.map(({ key, label }) => {
    const pct = Math.round(cell.buckets[key] * 100);
    return pct > 0 ? `${pct}% ${label}` : null;
  }).filter(Boolean);
  parts.push(`Of the offspring: ${outcomes.join(', ')}`);
  parts.push(`♂ ${cell.fatherEffect || '—'} · ♀ ${cell.motherEffect || '—'}`);
  return parts.join('\n');
}

/** One-line aggregate label for the box (the per-quarter fills carry no text). */
function offspringAria(cell: TrioLocusCell) {
  return offspringTitle(cell).replace(/\n/g, '; ');
}

function parentTitle(cell: GeneCell | null, label: string) {
  if (!cell) return '';
  return `${label} · Gene ${cell.id} (${ALLELE_LABEL[cell.type] ?? cell.type})\n${cell.effect || 'No effect'}`;
}
</script>

<DetailOverlay
    testid="trio-view"
    backTestid="trio-view-back"
    backLabel="← Pairs"
    ariaLabel="Offspring trio"
    onBack={onClose}
>
    {#snippet title()}
        <span class="parent-name father">♂ {father?.name}</span>
        <span class="cross">×</span>
        <span class="parent-name mother">♀ {mother?.name}</span>
        {#if speciesLabel}
            <span class="species-badge">{getSpeciesEmoji(father?.species)} {speciesLabel}</span>
        {/if}
    {/snippet}

    <!-- Stat pills ride in the header bar alongside the parent names; the filter
         row + legend sit below — two rows of chrome instead of three. -->
    {#snippet headerActions()}
        {#if grid && summary && grid.rows.length > 0}
            <div class="trio-stats">
                <span class="chip chip-gain" title="Loci where the offspring could {gainMode === 'attributes' ? 'express a positive attribute neither parent has' : 'clarify a mixed gene to homozygous (breeds true)'}.">{gainCount} {gainMode === 'attributes' ? 'gains' : 'clarifications'}</span>
                <span class="chip chip-risk" title="Loci where the offspring risks a new negative, or losing a positive a parent has.">{lossCount} losses</span>
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
            </div>
        {/if}
    {/snippet}

    <div class="trio-body">
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
                    testid="trio-attribute-filter"
                />
            {/if}
            {#if grid && summary && grid.rows.length > 0}
                <div class="seg gain-mode" role="group" aria-label="Highlight which gain">
                    <button
                        type="button"
                        class="seg-btn"
                        class:active={gainMode === 'attributes'}
                        aria-pressed={gainMode === 'attributes'}
                        data-testid="trio-gain-attributes"
                        title="Highlight loci where the offspring can express a positive attribute neither parent has."
                        onclick={() => { gainMode = 'attributes'; }}
                    >New attributes</button>
                    <button
                        type="button"
                        class="seg-btn"
                        class:active={gainMode === 'clarification'}
                        aria-pressed={gainMode === 'clarification'}
                        data-testid="trio-gain-clarification"
                        title="Highlight loci where the offspring can clear a mixed gene to homozygous, so it breeds true (Clarification)."
                        onclick={() => { gainMode = 'clarification'; }}
                    >Clarification</button>
                </div>
                <span class="legend">
                    <span class="legend-item"><span class="swatch swatch-gain"></span>{gainMode === 'attributes' ? 'new +' : 'clarify'}</span>
                    <span class="legend-item"><span class="swatch swatch-keep"></span>keep</span>
                    <span class="legend-item"><span class="swatch swatch-neutral"></span>neutral</span>
                    <span class="legend-item"><span class="swatch swatch-loss"></span>loss</span>
                </span>
            {/if}
        </div>
        {#if attributeItems.length > 0}
            <div class="grid-instructions">Click attribute to focus · Ctrl+click multi · Alt+click hide</div>
        {/if}
    {/if}

    {#if loading}
        <StatusPane variant="loading" body="Building offspring projection…" />
    {:else if error}
        <StatusPane variant="error" icon="⚠️" body={error} />
    {:else if grid && summary && grid.rows.length > 0}
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
                                            <div class={cell.fatherCell.attributeCls} class:fixed={isLocked(cell)} data-attrs={cell.attrs} title={parentTitle(cell.fatherCell, 'Father')}>
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
                                                class="outcome-box"
                                                class:hatch={cell.buckets.unknown >= 1}
                                                class:fixed={isLocked(cell)}
                                                data-attrs={cell.attrs}
                                                role="img"
                                                title={offspringTitle(cell)}
                                                aria-label={offspringAria(cell)}
                                                style={cell.buckets.unknown >= 1 ? undefined : `background: ${outcomeBoxBackground(cell.buckets, gainMode)}`}
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
                                            <div class={cell.motherCell.attributeCls} class:fixed={isLocked(cell)} data-attrs={cell.attrs} title={parentTitle(cell.motherCell, 'Mother')}>
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
</DetailOverlay>

<style>
    /* Title (header bar) — parent names + species badge, moved here now that
       this component owns its DetailOverlay. */
    .parent-name { font-weight: 700; }
    .parent-name.father { color: var(--accent); }
    .parent-name.mother { color: var(--pet-b); }
    .cross { color: var(--text-muted); font-weight: 500; }
    .species-badge {
        font-size: 12px;
        font-weight: 500;
        padding: 2px 8px;
        background: var(--bg-tertiary);
        border-radius: 10px;
        color: var(--text-secondary);
        white-space: nowrap;
    }

    /* Stat pills that ride in the header bar (DetailOverlay's headerActions). No
       band background — the header itself is the bar. */
    .trio-stats { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

    /* Body fills the overlay; a flex column so the grid is the single scroll
       region and the filter row stays pinned above it. */
    .trio-body {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        padding: 8px 14px;
        /* Offspring-outcome palette, derived from the shared gene colours so the
           trio stays coherent with the rest of the app. Vivid = a change vs the
           parents (gain / loss); muted (mixed toward neutral) = a hold. */
        --trio-gain: var(--gene-positive);
        --trio-keep-pos: color-mix(in srgb, var(--gene-positive) 42%, var(--gene-neutral));
        --trio-neutral: color-mix(in srgb, var(--gene-neutral) 60%, transparent);
        --trio-keep-neg: color-mix(in srgb, var(--gene-negative) 42%, var(--gene-neutral));
        --trio-loss: var(--gene-negative);
    }
    /* Compact the shared segmented control to sit in the dense filter row. */
    .gain-mode { font-size: 11px; }
    /* Filter row: breed + attribute pills on the left, legend pushed right. */
    .trio-filters {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 14px;
        margin-bottom: 6px;
        flex-shrink: 0;
    }
    /* Attribute pills → GeneFilterPills; breed picker → shared BreedSelector. */
    .breed-filter { display: flex; padding: 0 4px; }

    /* Shared instruction line (identical to GenomeGridDiff's .grid-instructions). */
    .grid-instructions { font-size: 10px; color: var(--text-muted); margin-bottom: 4px; font-style: italic; padding: 0 4px; }
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
    .swatch { width: 11px; height: 11px; border-radius: 2px; display: inline-block; box-shadow: inset 0 0 0 1px rgba(127, 127, 127, 0.25); }
    .swatch-gain { background: var(--trio-gain); }
    .swatch-keep { background: var(--trio-keep-pos); }
    .swatch-neutral { background: var(--trio-neutral); }
    .swatch-loss { background: var(--trio-loss); }

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
    .pos-header { width: 18px; min-width: 18px; max-width: 18px; }
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

    /* Offspring row is taller and its cells host the outcome box. */
    .offspring-cell { height: 22px; }
    /* One box per locus: a hard-stop vertical gradient of the outcome buckets
       (gain / keep / neutral / keep-negative / loss), quartered by the Punnett
       odds. No verdict border — the fill carries direction, magnitude and the
       gain/hold distinction on its own. */
    .outcome-box {
        width: 16px;
        height: 16px;
        margin: 0 auto;
        border-radius: 3px;
        overflow: hidden;
        box-sizing: border-box;
        box-shadow: inset 0 0 0 1px rgba(127, 127, 127, 0.22);
    }
    .outcome-box.hatch {
        background: repeating-linear-gradient(45deg, color-mix(in srgb, var(--gene-neutral) 60%, transparent) 0 2px, transparent 2px 4px);
    }

    /* Parent cells share the offspring bar's box size so the three rows line up
       column-for-column, at the same 16px density as the compare view. */
    .trio-table :global(.gene-cell) { width: 16px; height: 16px; }

    /* "New gains only": fade locked loci out of ALL three rows (both parents and
       the offspring) so the remaining gain-coloured bars are only new gains. */
    .trio-grid-container.hide-locked .fixed { opacity: 0.12; }
    .trio-grid-container.hide-locked .outcome-box.fixed { box-shadow: none; }

    .unknown-symbol { color: var(--text-muted); font-size: 1em; font-weight: 600; }
    .empty-text { color: var(--text-muted); font-size: 13px; text-align: center; padding: 40px; }
</style>
