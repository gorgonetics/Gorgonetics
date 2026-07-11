<script lang="ts">
import { onDestroy, onMount } from 'svelte';
import '$lib/components/gene/geneCell.css';
import GenomeDiffControls from '$lib/components/comparison/GenomeDiffControls.svelte';
import GeneTooltip from '$lib/components/gene/GeneTooltip.svelte';
import DetailOverlay from '$lib/components/shared/DetailOverlay.svelte';
import StatusPane from '$lib/components/shared/StatusPane.svelte';
import { getAppearanceConfig, getAttributeConfig, normalizeSpecies } from '$lib/services/configService.js';
import { getGeneEffectsCached } from '$lib/services/geneService.js';
import { loadPetGridFromDb } from '$lib/services/petService.js';
import { settings } from '$lib/stores/settings.js';
import type { AppearanceInfo, AttributeInfo, GenomeDiffSummary, Pet } from '$lib/types/index.js';
import { HORSE_BREEDS } from '$lib/types/index.js';
import { buildFilterCSS, joinAttrs } from '$lib/utils/filterCSS.js';
import { triStateToggle } from '$lib/utils/filterToggle.js';
import { breedFor, effectFor, type GeneEffectData, isNoEffect } from '$lib/utils/geneAnalysis.js';
import { buildAppearanceLookup, createGeneCellBuilder, type GeneCell } from '$lib/utils/geneGridCells.js';
import { capitalize } from '$lib/utils/string.js';

interface ChromosomeRow {
  chr: string;
  cellsA: Record<string, (GeneCell | null)[]>;
  cellsB: Record<string, (GeneCell | null)[]>;
  diffs: Record<string, boolean[]>;
  /**
   * Delimited (`·Attr·Attr·`) potential-attribute set per locus, derived once
   * from the gene effect DB (both alleles) and shared by both pet rows — the
   * attribute filter keys off this, not each pet's resolved allele.
   */
  attrs: Record<string, string[]>;
  hasDiffs: boolean;
}

interface ChrBreedEntry {
  generic: boolean;
  breeds: Set<string>;
}

interface Props {
  petA: Pet;
  petB: Pet;
  /** Back out of the compare lens (→ Pets). */
  onBack: () => void;
}

const { petA, petB, onBack }: Props = $props();

let loading = $state(false);
let error = $state<string | null>(null);
let summary = $state<GenomeDiffSummary | null>(null);
let showDiffsOnly = $state(false);
let currentView = $state<'attribute' | 'appearance'>('attribute');

let effectsDB: Record<string, GeneEffectData> = {};
let speciesKey = $state('');
const isHorse = $derived(speciesKey === 'horse');

let sortedBlocks = $state<string[]>([]);
let blockMaxGenes = new Map<string, number>();
let blockIndices = $state<Record<string, number[]>>({});

let allAttributeNames: string[] = [];
let attributeDisplayInfo = $state<AttributeInfo[]>([]);
let appearanceDisplayInfo = $state<AppearanceInfo[]>([]);
let appearanceLookup = new Map<string, string>();

let chromosomeRows = $state<ChromosomeRow[]>([]);
let chrBreedRelevance: Record<string, ChrBreedEntry> = {};

// Filters
let breedFilter = $state('');
let autoBreed = $state(false);
let selectedChromosomes = $state<string[]>([]);
let hiddenChromosomes = $state<string[]>([]);
let selectedAttributes = $state<string[]>([]);
let hiddenAttributes = $state<string[]>([]);
let selectedAppearances = $state<string[]>([]);
let hiddenAppearances = $state<string[]>([]);

// Auto-breed: use the shared setting and detect from pets' breeds
const petsHaveKnownBreed = $derived(
  !!(isHorse && petA?.breed && HORSE_BREEDS[petA.breed] && petB?.breed && HORSE_BREEDS[petB.breed]),
);
const petsShareBreed = $derived(petsHaveKnownBreed && petA.breed === petB.breed);

let manualBreedOverride = $state(false);

$effect(() => {
  // Re-initialize autoBreed from setting when pets change, reset manual override
  const _a = petA?.id;
  const _b = petB?.id;
  manualBreedOverride = false;
  autoBreed = !!$settings['horse.autoSelectBreedFilter'];
});

// Sync with setting changes only when user hasn't manually toggled
$effect(() => {
  const settingValue = !!$settings['horse.autoSelectBreedFilter'];
  if (!manualBreedOverride) {
    autoBreed = settingValue;
  }
});

$effect(() => {
  if (autoBreed && isHorse) {
    if (petsShareBreed) {
      breedFilter = petA.breed;
    } else if (petsHaveKnownBreed) {
      // Different breeds — can't auto-select, clear
      breedFilter = '';
    }
  }
});

// Tooltip
let tooltipVisible = $state(false);
let tooltipX = $state(0);
let tooltipY = $state(0);
let tooltipGeneId = $state('');
let tooltipGeneType = $state('');
let tooltipEffect = $state('');
let tooltipPotentialEffects = $state<string[]>([]);

// Dynamic filter style element — created programmatically (a Svelte component can't declare a dynamic style block in its markup)
let filterStyleEl: HTMLStyleElement | null = null;

onMount(() => {
  filterStyleEl = document.createElement('style');
  filterStyleEl.id = 'genome-diff-filters';
  document.head.appendChild(filterStyleEl);
});

onDestroy(() => {
  filterStyleEl?.remove();
  filterStyleEl = null;
});

$effect(() => {
  if (petA?.id && petB?.id) {
    loadData();
  }
});

// --- Dynamic filter stylesheet (zero DOM traversal, zero Svelte re-render) ---
$effect(() => {
  if (!filterStyleEl) return;
  filterStyleEl.textContent = buildFilterCSS({
    selectedAttributes,
    hiddenAttributes,
    selectedAppearances,
    hiddenAppearances,
    breedFilter,
    selectedChromosomes,
    hiddenChromosomes,
    showDiffsOnly,
    isHorse,
    currentView,
    chrBreedRelevance,
  });
});

async function loadData() {
  try {
    loading = true;
    error = null;
    breedFilter = '';
    selectedChromosomes = [];
    hiddenChromosomes = [];
    selectedAttributes = [];
    hiddenAttributes = [];
    selectedAppearances = [];
    hiddenAppearances = [];

    speciesKey = normalizeSpecies(petA.species);
    const [parsedA, parsedB, efData] = await Promise.all([
      loadPetGridFromDb(petA.id),
      loadPetGridFromDb(petB.id),
      getGeneEffectsCached(speciesKey),
    ]);

    if (Object.keys(parsedA).length === 0 || Object.keys(parsedB).length === 0) {
      throw new Error('Failed to load genome data');
    }
    effectsDB = efData?.effects ?? {};

    const config = getAttributeConfig(speciesKey);
    allAttributeNames = config.all_attribute_names.map((n) => capitalize(n));
    attributeDisplayInfo = config.attributes;

    const apConfig = getAppearanceConfig(speciesKey);
    appearanceDisplayInfo = apConfig.appearance_attributes.map((a) => ({
      ...a,
      key: a.key.replace(/_/g, '-'),
    }));
    appearanceLookup = buildAppearanceLookup(speciesKey);
    const cellBuilder = createGeneCellBuilder({
      effectsDB,
      attributeNames: allAttributeNames,
      appearanceLookup,
      speciesKey,
    });

    const allBlks = new Set<string>();
    const maxGenes = new Map<string, number>();
    for (const parsed of [parsedA, parsedB]) {
      for (const chrData of Object.values(parsed)) {
        for (const block of chrData.blocks) {
          allBlks.add(block.letter);
          const cur = maxGenes.get(block.letter) || 0;
          maxGenes.set(block.letter, Math.max(cur, block.genes.length));
        }
      }
    }
    sortedBlocks = [...allBlks].sort();
    blockMaxGenes = maxGenes;

    const indices: Record<string, number[]> = {};
    for (const block of sortedBlocks) {
      indices[block] = Array.from({ length: maxGenes.get(block) || 0 }, (_, i) => i);
    }
    blockIndices = indices;

    // Pre-compute breed relevance per chromosome
    chrBreedRelevance = {};
    if (speciesKey === 'horse') {
      for (const [geneId, data] of Object.entries(effectsDB)) {
        const chr = geneId.replace(/[A-Z].*/i, '');
        if (!chrBreedRelevance[chr]) chrBreedRelevance[chr] = { generic: false, breeds: new Set() };
        if (!data.breed || data.breed === '') chrBreedRelevance[chr].generic = true;
        else chrBreedRelevance[chr].breeds.add(data.breed);
      }
    }

    const chrKeys = [...new Set([...Object.keys(parsedA), ...Object.keys(parsedB)])].sort((a, b) => {
      const nA = Number.parseInt(a, 10);
      const nB = Number.parseInt(b, 10);
      if (!Number.isNaN(nA) && !Number.isNaN(nB)) return nA - nB;
      return a.localeCompare(b);
    });

    // Total is a per-species constant — the gene catalog (loaded once and
    // cached by `getGeneEffectsCached`) has one entry per genome position.
    // Don't try to derive it from the display grid: `sortedBlocks` × `maxGenes`
    // is a padded layout shape, not a gene count.
    const totalGenes = Object.keys(effectsDB).length;
    let differentGenes = 0;

    chromosomeRows = chrKeys.map((chr) => {
      const dataA = parsedA[chr] || { blocks: [] };
      const dataB = parsedB[chr] || { blocks: [] };

      const genesByBlockA = new Map<string, { id: string; type: string }[]>();
      const genesByBlockB = new Map<string, { id: string; type: string }[]>();
      for (const b of dataA.blocks) genesByBlockA.set(b.letter, b.genes);
      for (const b of dataB.blocks) genesByBlockB.set(b.letter, b.genes);

      const cellsA: Record<string, (GeneCell | null)[]> = {};
      const cellsB: Record<string, (GeneCell | null)[]> = {};
      const diffs: Record<string, boolean[]> = {};
      const attrs: Record<string, string[]> = {};
      let chrDiffs = 0;

      for (const block of sortedBlocks) {
        const genesA = genesByBlockA.get(block) || [];
        const genesB = genesByBlockB.get(block) || [];
        const maxLen = maxGenes.get(block) || 0;
        cellsA[block] = new Array(maxLen);
        cellsB[block] = new Array(maxLen);
        diffs[block] = new Array(maxLen);
        attrs[block] = new Array(maxLen);

        for (let i = 0; i < maxLen; i++) {
          const gA = genesA[i] || null;
          const gB = genesB[i] || null;
          // Pre-compute everything: static CSS class, attribute, breed
          cellsA[block][i] = gA ? cellBuilder.makeCell(gA) : null;
          cellsB[block][i] = gB ? cellBuilder.makeCell(gB) : null;
          // Both pets share the locus gene, so resolve its potential attributes
          // once (from the effect DB) and use the same value for both rows.
          const geneId = (gA ?? gB)?.id;
          const list = geneId ? cellBuilder.attributesForGene(geneId) : [];
          attrs[block][i] = joinAttrs(list);
          const isDiff = (gA?.type || null) !== (gB?.type || null);
          diffs[block][i] = isDiff;
          if (isDiff) chrDiffs++;
        }
      }

      differentGenes += chrDiffs;
      return { chr, cellsA, cellsB, diffs, attrs, hasDiffs: chrDiffs > 0 };
    });

    const identicalGenes = totalGenes - differentGenes;
    const pct = totalGenes > 0 ? Math.round((identicalGenes / totalGenes) * 100) : 0;
    summary = { totalGenes, identicalGenes, differentGenes, similarityPercent: pct };
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : 'Failed to load genome data';
    chromosomeRows = [];
    summary = null;
  } finally {
    loading = false;
  }
}

// --- Filter UI actions ---

function toggleChromosomeFilter(chr: string, ctrlKey: boolean, altKey: boolean) {
  ({ selected: selectedChromosomes, hidden: hiddenChromosomes } = triStateToggle(
    chr,
    selectedChromosomes,
    hiddenChromosomes,
    ctrlKey,
    altKey,
  ));
}

function toggleAttributeFilter(attrKey: string, ctrlKey: boolean, altKey: boolean) {
  ({ selected: selectedAttributes, hidden: hiddenAttributes } = triStateToggle(
    attrKey,
    selectedAttributes,
    hiddenAttributes,
    ctrlKey,
    altKey,
  ));
}

function toggleAppearanceFilter(key: string, ctrlKey: boolean, altKey: boolean) {
  ({ selected: selectedAppearances, hidden: hiddenAppearances } = triStateToggle(
    key,
    selectedAppearances,
    hiddenAppearances,
    ctrlKey,
    altKey,
  ));
}

// --- Tooltip ---

function handleCellEnter(event: MouseEvent, cell: GeneCell) {
  if (!cell) return;
  const potentialEffects: string[] = [];
  const cellData = effectsDB[cell.id];
  const dominantEffect = effectFor(cellData, 'D');
  const recessiveEffect = effectFor(cellData, 'R');

  if (cell.type !== 'D' && !isNoEffect(dominantEffect)) {
    const color = dominantEffect.includes('+') ? '#34d399' : dominantEffect.includes('-') ? '#f87171' : '#666';
    potentialEffects.push(`If Dominant: <span style="color: ${color}">${dominantEffect}</span>`);
  }
  if (cell.type !== 'R' && !isNoEffect(recessiveEffect)) {
    const color = recessiveEffect.includes('+') ? '#34d399' : recessiveEffect.includes('-') ? '#f87171' : '#666';
    potentialEffects.push(`If Recessive: <span style="color: ${color}">${recessiveEffect}</span>`);
  }

  const breed = breedFor(cellData);
  if (breed && speciesKey === 'horse') {
    if (breedFilter && breed !== breedFilter) {
      potentialEffects.push(
        `<span style="color: #9ca3af">⚬ ${breed} breed only — inactive for ${breedFilter} filter</span>`,
      );
    } else if (!breedFilter) {
      potentialEffects.push(`<span style="color: #9ca3af">⚬ ${breed} breed gene</span>`);
    }
  }

  const offset = 12;
  let x = event.clientX + offset;
  let y = event.clientY - offset - 60;
  if (x + 250 > window.innerWidth) x = event.clientX - 250 - offset;
  if (y < 0) y = event.clientY + offset;

  tooltipX = x;
  tooltipY = y;
  tooltipGeneId = cell.id;
  tooltipGeneType = cell.type;
  tooltipEffect = cell.effect || '';
  tooltipPotentialEffects = potentialEffects;
  tooltipVisible = true;
}

function handleCellLeave() {
  tooltipVisible = false;
}
</script>

<DetailOverlay
    testid="pet-compare"
    backTestid="pet-compare-back"
    backLabel="← Pets"
    ariaLabel="Pet comparison"
    {onBack}
>
    {#snippet title()}⚖️ {petA.name || 'Pet A'} vs {petB.name || 'Pet B'}{/snippet}

    <!-- Summary + view / diffs-only ride in the header bar next to the names;
         the filter row sits below — two rows of chrome, matching the trio. -->
    {#snippet headerActions()}
        {#if summary}
            <div class="diff-summary">
                <span class="similarity-badge">{summary.similarityPercent}% identical</span>
                <span class="summary-detail">{summary.identicalGenes}/{summary.totalGenes} genes match · {summary.differentGenes} diff</span>
                <div class="view-toggle">
                    <button type="button" class="view-btn" class:active={currentView === 'attribute'} onclick={() => { currentView = 'attribute'; }}>Attributes</button>
                    <button type="button" class="view-btn" class:active={currentView === 'appearance'} onclick={() => { currentView = 'appearance'; }}>Appearance</button>
                </div>
                <label class="diff-toggle">
                    <input type="checkbox" checked={showDiffsOnly} onchange={(e) => { showDiffsOnly = (e.target as HTMLInputElement).checked; }} />
                    Differences only
                </label>
            </div>
        {/if}
    {/snippet}

    <div class="genome-grid-diff">
    {#if loading}
        <StatusPane variant="loading" body="Loading genomes..." />
    {:else if error}
        <StatusPane variant="error" icon="⚠️" body={error} />
    {:else if summary}
        <GenomeDiffControls
            {isHorse}
            {breedFilter}
            {autoBreed}
            {petsHaveKnownBreed}
            {petsShareBreed}
            {selectedAttributes}
            {hiddenAttributes}
            {attributeDisplayInfo}
            {selectedAppearances}
            {hiddenAppearances}
            {appearanceDisplayInfo}
            {currentView}
            onBreedChange={(name) => { breedFilter = name; }}
            onAutoBreedToggle={() => {
                manualBreedOverride = true;
                autoBreed = !autoBreed;
                if (autoBreed && petsShareBreed) {
                    breedFilter = petA.breed;
                } else if (!autoBreed) {
                    breedFilter = '';
                }
            }}
            onAttributeToggle={toggleAttributeFilter}
            onAppearanceToggle={toggleAppearanceFilter}
            onResetAttributes={() => { selectedAttributes = []; hiddenAttributes = []; }}
            onResetAppearances={() => { selectedAppearances = []; hiddenAppearances = []; }}
        />

        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="grid-container" onmouseleave={handleCellLeave}>
            <table class="gene-grid-table">
                <thead class="gene-headers">
                    <tr>
                        <th class="chromosome-header">Chr</th>
                        <th class="pet-label-header">Pet</th>
                        {#each sortedBlocks as block (block)}
                            {#each blockIndices[block] as i (i)}
                                <th class="position-header {i === 0 ? 'block-start block-label' : ''}">{i === 0 ? block : ''}</th>
                            {/each}
                        {/each}
                    </tr>
                </thead>
                <tbody class="gene-rows">
                    {#each chromosomeRows as row (row.chr)}
                        <tr class="chromosome-row pet-a-row" data-chr={row.chr} data-hasdiffs={row.hasDiffs}>
                            <td class="chromosome-label" rowspan="2"
                                onclick={(e) => toggleChromosomeFilter(row.chr, e.ctrlKey || e.metaKey, e.altKey)}
                            >{row.chr}</td>
                            <td class="pet-label pet-a-label">{petA.name}</td>
                            {#each sortedBlocks as block (block)}
                                {#each blockIndices[block] as i (i)}
                                    {@const cell = row.cellsA[block][i]}
                                    {@const isDiff = row.diffs[block][i]}
                                    <td class="gene-cell-container {i === 0 ? 'block-start' : ''} {!cell ? 'empty' : ''} {isDiff ? 'diff-cell' : ''}"
                                        data-isdiff={isDiff} data-hascell={!!cell}>
                                        {#if cell}
                                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                                            <div class={currentView === 'appearance' ? cell.appearanceCls : cell.attributeCls} data-attrs={row.attrs[block][i]} data-appearance={cell.appearance} data-breed={cell.breed}
                                                onmouseenter={(e) => handleCellEnter(e, cell)} onmouseleave={handleCellLeave}
                                            >{#if cell.type === '?'}<span class="gene-unknown-symbol">?</span>{/if}</div>
                                        {/if}
                                    </td>
                                {/each}
                            {/each}
                        </tr>
                        <tr class="chromosome-row pet-b-row" data-chr={row.chr} data-hasdiffs={row.hasDiffs}>
                            <td class="pet-label pet-b-label">{petB.name}</td>
                            {#each sortedBlocks as block (block)}
                                {#each blockIndices[block] as i (i)}
                                    {@const cell = row.cellsB[block][i]}
                                    {@const isDiff = row.diffs[block][i]}
                                    <td class="gene-cell-container {i === 0 ? 'block-start' : ''} {!cell ? 'empty' : ''} {isDiff ? 'diff-cell' : ''}"
                                        data-isdiff={isDiff} data-hascell={!!cell}>
                                        {#if cell}
                                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                                            <div class={currentView === 'appearance' ? cell.appearanceCls : cell.attributeCls} data-attrs={row.attrs[block][i]} data-appearance={cell.appearance} data-breed={cell.breed}
                                                onmouseenter={(e) => handleCellEnter(e, cell)} onmouseleave={handleCellLeave}
                                            >{#if cell.type === '?'}<span class="gene-unknown-symbol">?</span>{/if}</div>
                                        {/if}
                                    </td>
                                {/each}
                            {/each}
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>

        <GeneTooltip visible={tooltipVisible} x={tooltipX} y={tooltipY} geneId={tooltipGeneId} geneType={tooltipGeneType} effect={tooltipEffect} potentialEffects={tooltipPotentialEffects} />
    {:else}
        <p class="empty-text">No genome data available for comparison.</p>
    {/if}
    </div>
</DetailOverlay>

<style>
    /* Fills the overlay body. */
    .genome-grid-diff { width: 100%; height: 100%; display: flex; flex-direction: column; min-height: 0; padding: 8px 14px; box-sizing: border-box; }

    /* Summary band content now lives in the DetailOverlay header (headerActions). */
    .diff-summary { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .similarity-badge { font-size: 14px; font-weight: 700; color: var(--text-primary); padding: 4px 10px; background: var(--bg-tertiary); border-radius: 10px; }
    .summary-detail { font-size: 12px; color: var(--text-secondary); }
    .diff-toggle { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); cursor: pointer; }
    .diff-toggle input { cursor: pointer; }
    .view-toggle { display: inline-flex; border: 1px solid var(--border-primary); border-radius: 4px; overflow: hidden; }
    .view-btn { padding: 3px 10px; border: none; background: var(--bg-primary); color: var(--text-tertiary); font-size: 11px; font-weight: 500; cursor: pointer; transition: all 0.15s; }
    .view-btn + .view-btn { border-left: 1px solid var(--border-primary); }
    .view-btn:hover { color: var(--text-secondary); }
    .view-btn.active { background: var(--accent); color: white; }

    /* --cell-size 18px → 16px gene cells (calc subtracts the 2px border), the
       same density as the trio view. flex:1 makes the grid the single scroll
       region so the filter row stays pinned above it. */
    .grid-container { --cell-size: 18px; flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--border-primary); border-radius: 6px; background: var(--bg-secondary); }
    .gene-grid-table { width: auto; border-collapse: collapse; table-layout: fixed; }
    .gene-headers { position: sticky; top: 0; z-index: 10; background: var(--bg-secondary); }
    .gene-headers th { background: var(--bg-secondary); border-bottom: 1px solid var(--border-primary); padding: 2px 4px; font-size: 9px; font-weight: normal; color: var(--text-secondary); text-align: center; white-space: nowrap; }
    .chromosome-header { position: sticky; left: 0; z-index: 11; background: var(--bg-secondary); font-weight: bold; width: 28px; min-width: 28px; max-width: 28px; }
    .pet-label-header { position: sticky; left: 28px; z-index: 11; background: var(--bg-secondary); font-weight: bold; width: 60px; min-width: 60px; max-width: 60px; }
    .position-header { width: 18px; min-width: 18px; max-width: 18px; }
    .position-header.block-label { font-weight: bold; }
    .position-header.block-start { padding-left: 10px; }

    .gene-rows { background: var(--bg-secondary); }
    .chromosome-row { border-bottom: 1px solid var(--bg-tertiary); }
    .chromosome-row.pet-a-row { border-bottom: none; }
    .chromosome-row.pet-b-row { border-bottom: 2px solid var(--border-primary); }

    .chromosome-label { position: sticky; left: 0; z-index: 1; background: var(--bg-secondary); font-size: 10px; font-weight: 700; color: var(--text-secondary); padding: 2px 4px; text-align: center; vertical-align: middle; border-right: 1px solid var(--border-primary); white-space: nowrap; cursor: pointer; user-select: none; }
    .chromosome-label:hover { background: var(--bg-tertiary); color: var(--text-primary); }

    .pet-label { position: sticky; left: 28px; z-index: 1; font-size: 9px; font-weight: 600; padding: 1px 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-right: 1px solid var(--border-primary); width: 60px; min-width: 60px; max-width: 60px; }
    .pet-a-label { background: color-mix(in srgb, var(--accent) 8%, var(--bg-secondary)); color: var(--accent); }
    .pet-b-label { background: color-mix(in srgb, var(--pet-b) 8%, var(--bg-secondary)); color: var(--pet-b); }

    .gene-cell-container { padding: 1px; text-align: center; vertical-align: middle; }
    .gene-cell-container.empty { opacity: 0.3; }
    .gene-cell-container.block-start { padding-left: 8px; }
    /* Confine the diff tint to the gene square (content box) so it doesn't
       paint the cell padding — otherwise it bleeds across the 8px inter-block
       gap on block-start cells and merges adjacent diffs into one band. */
    .gene-cell-container.diff-cell { background-color: rgba(234, 179, 8, 0.15); background-clip: content-box; }
    .gene-cell-container.identical-dimmed { opacity: 0.2; }

    /* Breed override — applied via direct DOM manipulation */
    :global(.gene-inactive-breed-override) {
        background-color: #e8e8ec !important;
        border-color: #d0d0d6 !important;
        opacity: 0.5;
    }
    :global(.gene-inactive-breed-override.gene-recessive) {
        background-color: rgba(208, 208, 214, 0.15) !important;
        border-color: #d0d0d6 !important;
    }
    :global(.gene-inactive-breed-override.gene-mixed) {
        background: linear-gradient(135deg, transparent 50%, #d0d0d6 50%) !important;
        border-color: #d0d0d6 !important;
    }

    .gene-unknown-symbol { color: var(--text-muted); font-size: 1em; font-weight: 600; }
    .empty-text { color: var(--text-muted); font-size: 13px; text-align: center; padding: 40px; }
</style>
