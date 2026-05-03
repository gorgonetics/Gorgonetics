<script>
import { onDestroy, onMount } from 'svelte';
import GenomeDiffControls from '$lib/components/comparison/GenomeDiffControls.svelte';
import GeneTooltip from '$lib/components/gene/GeneTooltip.svelte';
import {
  getAppearanceAttributes,
  getAppearanceConfig,
  getAttributeConfig,
  normalizeSpecies,
} from '$lib/services/configService.js';
import { getGeneEffectsCached } from '$lib/services/geneService.js';
import { loadPetGridFromDb } from '$lib/services/petService.js';
import { settings } from '$lib/stores/settings.js';
import { HORSE_BREEDS } from '$lib/types/index.js';
import { buildFilterCSS } from '$lib/utils/filterCSS.js';
import { breedFor, effectFor, isNoEffect } from '$lib/utils/geneAnalysis.js';
import { capitalize } from '$lib/utils/string.js';

const { petA, petB } = $props();

let loading = $state(false);
let error = $state(null);
let summary = $state(null);
let showDiffsOnly = $state(false);
let currentView = $state('attribute');

let effectsDB = {};
let speciesKey = $state('');
const isHorse = $derived(speciesKey === 'horse');

let sortedBlocks = [];
let blockMaxGenes = new Map();
let blockIndices = $state({});

let allAttributeNames = [];
let attributeDisplayInfo = $state([]);
let appearanceDisplayInfo = $state([]);
let appearanceLookup = new Map();

let chromosomeRows = $state([]);
let chrBreedRelevance = {};

// Filters
let breedFilter = $state('');
let autoBreed = $state(false);
let selectedChromosomes = $state([]);
let hiddenChromosomes = $state([]);
let selectedAttributes = $state([]);
let hiddenAttributes = $state([]);
let selectedAppearances = $state([]);
let hiddenAppearances = $state([]);

// Auto-breed: use the shared setting and detect from pets' breeds
const petsHaveKnownBreed = $derived(
  isHorse && petA?.breed && HORSE_BREEDS[petA.breed] && petB?.breed && HORSE_BREEDS[petB.breed],
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
let tooltipPotentialEffects = $state([]);

// Dynamic filter style element — created programmatically (can't use <style> in Svelte template)
let filterStyleEl = null;

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

    const allBlks = new Set();
    const maxGenes = new Map();
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

    const indices = {};
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

    let totalGenes = 0;
    let identicalGenes = 0;
    let differentGenes = 0;

    chromosomeRows = chrKeys.map((chr) => {
      const dataA = parsedA[chr] || { blocks: [] };
      const dataB = parsedB[chr] || { blocks: [] };

      const genesByBlockA = new Map();
      const genesByBlockB = new Map();
      for (const b of dataA.blocks) genesByBlockA.set(b.letter, b.genes);
      for (const b of dataB.blocks) genesByBlockB.set(b.letter, b.genes);

      const cellsA = {};
      const cellsB = {};
      const diffs = {};
      let chrDiffs = 0;
      let chrTotal = 0;

      for (const block of sortedBlocks) {
        const genesA = genesByBlockA.get(block) || [];
        const genesB = genesByBlockB.get(block) || [];
        const maxLen = maxGenes.get(block) || 0;
        cellsA[block] = new Array(maxLen);
        cellsB[block] = new Array(maxLen);
        diffs[block] = new Array(maxLen);

        for (let i = 0; i < maxLen; i++) {
          const gA = genesA[i] || null;
          const gB = genesB[i] || null;
          // Pre-compute everything: static CSS class, attribute, breed
          cellsA[block][i] = gA ? makeCell(gA) : null;
          cellsB[block][i] = gB ? makeCell(gB) : null;
          const isDiff = (gA?.type || null) !== (gB?.type || null);
          diffs[block][i] = isDiff;
          chrTotal++;
          if (isDiff) chrDiffs++;
        }
      }

      totalGenes += chrTotal;
      differentGenes += chrDiffs;
      identicalGenes += chrTotal - chrDiffs;

      return { chr, cellsA, cellsB, diffs, chrTotal, chrDiffs, hasDiffs: chrDiffs > 0 };
    });

    const pct = totalGenes > 0 ? Math.round((identicalGenes / totalGenes) * 100) : 0;
    summary = { totalGenes, identicalGenes, differentGenes, similarityPercent: pct };
  } catch (err) {
    error = err.message || 'Failed to load genome data';
    chromosomeRows = [];
    summary = null;
  } finally {
    loading = false;
  }
}

/** Build a cell object with pre-computed static CSS class strings for both views. */
function makeCell(gene) {
  const analysis = analyzeGene(gene.id, gene.type);
  const appearance = categorizeAppearance(gene.id);

  let zygosity;
  if (gene.type === 'D') zygosity = 'gene-dominant';
  else if (gene.type === 'R') zygosity = 'gene-recessive';
  else if (gene.type === 'x') zygosity = 'gene-mixed';
  else zygosity = 'gene-recessive';

  const attributeCls =
    gene.type === '?' ? 'gene-cell gene-neutral gene-unknown' : `gene-cell gene-${analysis.effectType} ${zygosity}`;
  const appearanceCls =
    gene.type === '?'
      ? 'gene-cell gene-neutral gene-unknown'
      : `gene-cell gene-${appearance || 'appearance-neutral'} ${zygosity}`;

  return {
    id: gene.id,
    type: gene.type,
    attributeCls,
    appearanceCls,
    attribute: analysis.attribute || '',
    appearance,
    breed: analysis.breed || '',
    effect: analysis.effect || '',
  };
}

function buildAppearanceLookup(species) {
  const attrs = getAppearanceAttributes(species);
  const byName = new Map();
  for (const [key, info] of Object.entries(attrs)) {
    byName.set(info.name.toLowerCase(), key);
  }
  return byName;
}

function categorizeAppearance(geneId) {
  const raw = effectsDB[geneId]?.appearance;
  if (!raw || raw === 'None' || raw.includes('String for me to fill')) return '';
  const lower = raw.toLowerCase();
  const matcher = speciesKey === 'horse' ? (name) => lower.startsWith(name) : (name) => lower.includes(name);
  for (const [name, key] of appearanceLookup) {
    if (matcher(name)) return key;
  }
  return '';
}

// --- Gene analysis (once per gene) ---

function analyzeGene(geneId, geneType) {
  const geneData = effectsDB[geneId];
  const effect = effectFor(geneData, geneType);
  const breed = breedFor(geneData);

  if (isNoEffect(effect)) return { effectType: 'neutral', attribute: null, effect, breed };

  const effectStr = effect || '';
  let attribute = null;
  for (const attrName of allAttributeNames) {
    if (effectStr.includes(attrName)) {
      attribute = attrName;
      break;
    }
  }

  const isPotential = effectStr.includes('?') || effectStr.toLowerCase().includes('potential');
  const hasPlus = effectStr.includes('+');
  const hasMinus = effectStr.includes('-');

  let effectType = 'neutral';
  if (isPotential && hasPlus) effectType = 'potential-positive';
  else if (isPotential && hasMinus) effectType = 'potential-negative';
  else if (!isPotential && hasPlus) effectType = 'positive';
  else if (!isPotential && hasMinus) effectType = 'negative';

  return { effectType, attribute, effect, breed };
}

// --- Filter UI actions ---

function triStateToggle(key, selected, hidden, ctrlKey, altKey) {
  if (altKey) {
    const nextHidden = hidden.includes(key)
      ? hidden.filter((k) => k !== key)
      : [...hidden.filter((k) => k !== key), key];
    return { selected: selected.filter((k) => k !== key), hidden: nextHidden };
  }
  if (ctrlKey) {
    const nextSelected = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
    return { selected: nextSelected, hidden: hidden.filter((k) => k !== key) };
  }
  const nextSelected = selected.length === 1 && selected[0] === key ? [] : [key];
  return { selected: nextSelected, hidden: hidden.filter((k) => k !== key) };
}

function toggleChromosomeFilter(chr, ctrlKey, altKey) {
  ({ selected: selectedChromosomes, hidden: hiddenChromosomes } = triStateToggle(
    chr,
    selectedChromosomes,
    hiddenChromosomes,
    ctrlKey,
    altKey,
  ));
}

function toggleAttributeFilter(attrKey, ctrlKey, altKey) {
  ({ selected: selectedAttributes, hidden: hiddenAttributes } = triStateToggle(
    attrKey,
    selectedAttributes,
    hiddenAttributes,
    ctrlKey,
    altKey,
  ));
}

function toggleAppearanceFilter(key, ctrlKey, altKey) {
  ({ selected: selectedAppearances, hidden: hiddenAppearances } = triStateToggle(
    key,
    selectedAppearances,
    hiddenAppearances,
    ctrlKey,
    altKey,
  ));
}

// --- Tooltip ---

function handleCellEnter(event, cell) {
  if (!cell) return;
  const potentialEffects = [];
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

<div class="genome-grid-diff">
    {#if loading}
        <div class="loading-state"><div class="spinner"></div><p>Loading genomes...</p></div>
    {:else if error}
        <div class="error-state">⚠️ {error}</div>
    {:else if summary}
        <GenomeDiffControls
            {summary}
            {isHorse}
            {breedFilter}
            {autoBreed}
            {petsHaveKnownBreed}
            {petsShareBreed}
            {showDiffsOnly}
            {selectedAttributes}
            {hiddenAttributes}
            {attributeDisplayInfo}
            {selectedAppearances}
            {hiddenAppearances}
            {appearanceDisplayInfo}
            {currentView}
            onViewChange={(v) => { currentView = v; }}
            onBreedChange={(name) => { breedFilter = breedFilter === name ? '' : name; }}
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
            onDiffsOnlyChange={(val) => { showDiffsOnly = val; }}
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
                                            <div class={currentView === 'appearance' ? cell.appearanceCls : cell.attributeCls} data-attr={cell.attribute} data-appearance={cell.appearance} data-breed={cell.breed}
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
                                            <div class={currentView === 'appearance' ? cell.appearanceCls : cell.attributeCls} data-attr={cell.attribute} data-appearance={cell.appearance} data-breed={cell.breed}
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

<style>
    .genome-grid-diff { width: 100%; }
    .loading-state { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 40px; color: var(--text-muted); font-size: 13px; }
    .spinner { width: 24px; height: 24px; border: 3px solid var(--border-primary); border-top: 3px solid var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .error-state { padding: 12px 16px; background: var(--error-bg); border: 1px solid var(--error-border); border-radius: 6px; color: var(--error-text); font-size: 13px; }

    .grid-container { overflow: auto; border: 1px solid var(--border-primary); border-radius: 6px; background: var(--bg-secondary); }
    .gene-grid-table { width: auto; border-collapse: collapse; table-layout: fixed; }
    .gene-headers { position: sticky; top: 0; z-index: 10; background: var(--bg-secondary); }
    .gene-headers th { background: var(--bg-secondary); border-bottom: 1px solid var(--border-primary); padding: 2px 4px; font-size: 9px; font-weight: normal; color: var(--text-secondary); text-align: center; white-space: nowrap; }
    .chromosome-header { position: sticky; left: 0; z-index: 11; background: var(--bg-secondary); font-weight: bold; width: 28px; min-width: 28px; max-width: 28px; }
    .pet-label-header { position: sticky; left: 28px; z-index: 11; background: var(--bg-secondary); font-weight: bold; width: 60px; min-width: 60px; max-width: 60px; }
    .position-header { width: 16px; min-width: 16px; max-width: 16px; }
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
    .pet-b-label { background: color-mix(in srgb, #a855f7 8%, var(--bg-secondary)); color: #a855f7; }

    .gene-cell-container { padding: 1px; text-align: center; vertical-align: middle; }
    .gene-cell-container.empty { opacity: 0.3; }
    .gene-cell-container.block-start { padding-left: 8px; }
    .gene-cell-container.diff-cell { background: rgba(234, 179, 8, 0.15); }
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
