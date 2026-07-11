<script lang="ts">
import { onDestroy, onMount } from 'svelte';
import './geneCell.css';
import StatusPane from '$lib/components/shared/StatusPane.svelte';
import {
  getAllAppearanceDisplayInfo,
  getAllAttributeDisplayInfo,
  getAppearanceAttributes,
  getAppearanceConfig,
  getAttributeConfig,
  getAttributeMatcher,
  normalizeSpecies,
} from '$lib/services/configService.js';
import { getGeneEffectsCached } from '$lib/services/geneService.js';
import { loadPetGridFromDb } from '$lib/services/petService.js';
import { EFFECT_COLORS } from '$lib/theme/gene-colors.js';
import type { AppearanceInfo, Pet } from '$lib/types/index.js';
import { buildVisualizerFilterCSS, type ChrBreedRelevance, joinAttrs } from '$lib/utils/filterCSS.js';
import { resolveFilterClick } from '$lib/utils/filterToggle.js';
import {
  breedFor,
  effectFor,
  type GeneEffectData,
  isNoEffect,
  type ParsedChromosome,
  type ParsedGene,
} from '$lib/utils/geneAnalysis.js';
import { computeGeneCellSize } from '$lib/utils/geneGridCells.js';
import {
  updateStats as accumulateStats,
  initializeStats as buildEmptyStats,
  type StatsMap,
} from '$lib/utils/geneStats.js';
import { handleGridNavigation } from '$lib/utils/keyboard.js';
import { capitalize } from '$lib/utils/string.js';
import GeneTooltip from './GeneTooltip.svelte';

const ALL_ATTRIBUTES = getAllAttributeDisplayInfo();
const FALLBACK_APPEARANCE_KEYS = getAllAppearanceDisplayInfo('beewasp').map((a) => a.key.replace(/_/g, '-'));

// Build appearance category lookup maps from configService data (avoids long if/else chains)
function buildAppearanceLookup(species: string): Map<string, string> {
  const attrs = getAppearanceAttributes(species);
  const byName = new Map<string, string>();
  for (const [key, info] of Object.entries(attrs) as [string, { name: string }][]) {
    byName.set(info.name.toLowerCase(), key);
  }
  return byName;
}

const HORSE_APPEARANCE = buildAppearanceLookup('horse');
const BEEWASP_APPEARANCE = buildAppearanceLookup('beewasp');

function categorizeAppearance(species: string, appearance: string) {
  if (!appearance || appearance === 'None') return 'appearance-neutral';
  const lower = appearance.toLowerCase();

  if (species === 'horse') {
    for (const [name, key] of HORSE_APPEARANCE) {
      if (lower.startsWith(name)) return key;
    }
  } else {
    for (const [name, key] of BEEWASP_APPEARANCE) {
      if (lower.includes(name)) return key;
    }
  }
  return 'appearance-neutral';
}

interface Props {
  pet?: Pet | null;
  onStatsUpdated?: () => void;
  /**
   * Pre-built chromosome grid to render instead of loading from the local
   * DB by `pet.id`. Used for community-catalogue previews, whose genome
   * lives in the share blob (not `pet_genes`) — see `genomeTextToGrid`.
   * When set, `loadPetGridFromDb` is bypassed entirely.
   */
  gridOverride?: Record<string, ParsedChromosome> | null;
}

/**
 * One rendered grid cell. Built ONCE per pet load with every filter/colour
 * input precomputed as a CSS class or data attribute; filtering then happens
 * entirely through an injected stylesheet (`buildVisualizerFilterCSS`) with
 * zero component re-render or DOM rebuild. Both views' colour classes are
 * baked in so the attribute↔appearance toggle is a class swap, not a rebuild.
 */
interface VisCell {
  id: string;
  type: string;
  /** Colour class for the attribute view (`gene-cell gene-<effectType> gene-<zygosity>`). */
  attributeCls: string;
  /** Colour class for the appearance view. */
  appearanceCls: string;
  /** Active-allele attribute (attribute-view hidden filter + per-attribute stats). */
  attr: string;
  /** Delimited union of both alleles' attributes (attribute-view select filter). */
  attrs: string;
  /** Appearance category for the appearance-view filter ('' for inactive-breed). */
  appearance: string;
  /** Resolved/promoted effect type (attribute-view effect filter). */
  effectType: string;
  /** Appearance category used for appearance-view stats. */
  appearanceStatsType: string;
  /** `dominant` | `recessive` | `mixed` | `unknown` (value filter). */
  zygosity: string;
  /** Delimited attributes this cell recolours potential-positive for when singly selected. */
  ctxpos: string;
  /** Delimited attributes this cell recolours potential-negative for. */
  ctxneg: string;
  /** Active-allele effect string — the attribute-view tooltip's "Current Effect". */
  effect: string;
  /** Appearance string (or "Different breed") — the appearance-view tooltip's "Current Effect". */
  appearanceEffect: string;
}

interface ChromosomeRow {
  chromosome: string;
  cells: (VisCell | null)[][]; // [blockIndex][positionIndex]
}

interface HeaderStructure {
  sortedBlocks: string[];
  blockMaxGenes: Map<string, number>;
}

const { pet, onStatsUpdated, gridOverride = null }: Props = $props();

let loading = $state(false);
let error = $state<string | null>(null);
let currentPet = $state<{
  id: number;
  name: string;
  species: string;
  breed: string;
  grid: Record<string, ParsedChromosome>;
} | null>(null);
let currentView = $state<'attribute' | 'appearance'>('attribute');
let geneEffectsDB: Record<string, Record<string, GeneEffectData>> | null = null;

// Stats
let currentStats = $state<StatsMap | null>(null);
let totalGenes = $state(0);
let neutralGenes = $state(0);
let appearanceList = $state<AppearanceInfo[]>([]);
let attributeStatNames: string[] = [];
let appearanceStatNames: string[] = [];

// Filter state — plain reactive state; changing it only regenerates the
// injected stylesheet (see the $effect below), never rebuilds the grid.
let selectedAttributes = $state<string[]>([]);
let hiddenAttributes = $state<string[]>([]);
let selectedChromosomes = $state<string[]>([]);
let hiddenChromosomes = $state<string[]>([]);
let currentEffectFilter = $state<string[]>([]);
let hiddenEffectFilters = $state<string[]>([]);
let currentValueFilter = $state<string[]>([]);
let hiddenValueFilters = $state<string[]>([]);
let currentBreedFilter = $state('');

// Per-chromosome breed relevance (horse) — drives the breed row-hide in CSS.
// $state so buildGrid()'s reassignment on a pet switch retriggers the filter
// stylesheet $effect (a plain `let` would leave stale row-hiding when the breed
// filter is active and the other reactive inputs are unchanged).
let chrBreedRelevance = $state<Record<string, ChrBreedRelevance>>({});
const isHorse = $derived(normalizeSpecies(currentPet?.species ?? '') === 'horse');

// Tooltip state
let tooltipVisible = $state(false);
let tooltipX = $state(0);
let tooltipY = $state(0);
let tooltipGeneId = $state('');
let tooltipGeneType = $state('');
let tooltipEffect = $state('');
let tooltipPotentialEffects = $state<string[]>([]);

// Built grid
let headerStructure = $state<HeaderStructure | null>(null);
let chromosomeData = $state<ChromosomeRow[]>([]);

// Responsive cell sizing — scale the fixed-cell grid to fill its container.
let gridContainerEl = $state<HTMLDivElement>();
let gridContainerWidth = $state(0);
const totalGeneColumns = $derived.by(() => {
  const hs = headerStructure;
  if (!hs) return 0;
  let total = 0;
  for (const block of hs.sortedBlocks) total += hs.blockMaxGenes.get(block) ?? 0;
  return total;
});
const cellSize = $derived(
  computeGeneCellSize({
    containerWidth: gridContainerWidth,
    totalColumns: totalGeneColumns,
    blockCount: headerStructure?.sortedBlocks.length ?? 0,
  }),
);

$effect(() => {
  const el = gridContainerEl;
  if (!el) return;
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) gridContainerWidth = entry.contentRect.width;
  });
  ro.observe(el);
  gridContainerWidth = el.clientWidth;
  return () => ro.disconnect();
});

// Tooltip + keyboard-nav listeners are delegated on the grid container (rather
// than per-cell inline handlers) — attaching them here instead of as inline
// attributes keeps the 1576-cell grid handler-free and sidesteps the
// mouse/focus a11y lint (the keyboard path is covered via focusin/keydown).
$effect(() => {
  const el = gridContainerEl;
  if (!el) return;
  el.addEventListener('mouseover', handleGridPointerOver);
  el.addEventListener('mouseout', handleGridPointerOut);
  el.addEventListener('focusin', handleGridFocusIn);
  el.addEventListener('focusout', handleGridFocusOut);
  el.addEventListener('keydown', handleGridKeydown);
  return () => {
    el.removeEventListener('mouseover', handleGridPointerOver);
    el.removeEventListener('mouseout', handleGridPointerOut);
    el.removeEventListener('focusin', handleGridFocusIn);
    el.removeEventListener('focusout', handleGridFocusOut);
    el.removeEventListener('keydown', handleGridKeydown);
  };
});

// Gene effects DB — persists across pet selections.
let globalGeneEffectsDB: Record<string, Record<string, GeneEffectData>> = {};

// --- Injected filter stylesheet (zero rebuild / zero re-render) --------------
// A GeneVisualizer never coexists with another (pet detail OR community detail),
// so a single shared `.gene-grid-container`-scoped sheet is safe.
let filterStyleEl: HTMLStyleElement | null = null;

onMount(() => {
  filterStyleEl = document.createElement('style');
  filterStyleEl.id = 'gene-visualizer-filters';
  document.head.appendChild(filterStyleEl);
  // Warm the effect cache for the common species; the load path also loads
  // on demand, so this is a best-effort optimisation only.
  void preloadGeneEffects();
});

onDestroy(() => {
  filterStyleEl?.remove();
  filterStyleEl = null;
  cleanup();
});

$effect(() => {
  if (!filterStyleEl) return;
  filterStyleEl.textContent = buildVisualizerFilterCSS({
    selectedChromosomes,
    hiddenChromosomes,
    selectedAttributes,
    hiddenAttributes,
    currentEffectFilter,
    hiddenEffectFilters,
    currentValueFilter,
    hiddenValueFilters,
    currentView,
    breedFilter: currentBreedFilter,
    isHorse,
    chrBreedRelevance,
  });
});

async function preloadGeneEffects() {
  const commonSpecies = ['horse', 'beewasp'];
  await Promise.all(
    commonSpecies.map(async (species) => {
      try {
        const normalizedSpecies = normalizeSpecies(species);
        if (!globalGeneEffectsDB[normalizedSpecies]) {
          const data = await getGeneEffectsCached(species);
          if (data) globalGeneEffectsDB[normalizedSpecies] = data.effects;
        }
      } catch (err) {
        console.warn(`Failed to preload gene effects for ${species}:`, err);
      }
    }),
  );
}

// --- Single load path -------------------------------------------------------
// One trigger only. The old component loaded from BOTH onMount and a reactive
// $effect, so the initial mount raced two loads (the "About to render N DOM
// elements" warning fired twice). A single keyed effect guarantees one build.
//
// `loadedKey` is the pet actually built and displayed — set only when a load
// *finishes* (not when it starts), so a pet that changes mid-load is not
// silently acknowledged and dropped. The effect reads `loading`, so it re-runs
// when an in-flight load settles and reconciles to the latest requested pet;
// loads stay serialized (the `loading` guard) so completions can't interleave.
let loadedKey: string | null = null;
$effect(() => {
  const key = pet ? String(pet.id) : null;
  if (key === null) {
    if (loadedKey !== null || currentPet) {
      loadedKey = null;
      cleanup();
    }
    return;
  }
  // Reading `loading` makes this effect re-run when a load settles, so a pet
  // switched during an in-flight load is picked up once the earlier load ends.
  if (loading) return;
  if (key !== loadedKey) loadPetData();
});

function cleanup() {
  currentPet = null;
  currentStats = null;
  totalGenes = 0;
  neutralGenes = 0;
  selectedAttributes = [];
  hiddenAttributes = [];
  selectedChromosomes = [];
  hiddenChromosomes = [];
  currentEffectFilter = [];
  hiddenEffectFilters = [];
  currentValueFilter = [];
  hiddenValueFilters = [];
  headerStructure = null;
  chromosomeData = [];
  error = null;
}

async function loadPetData() {
  // Capture the pet at entry so a mid-load prop change can't scramble this
  // build; the effect reconciles to the newer pet once this load settles.
  const p = pet;
  if (!p || loading) return;
  try {
    loading = true;
    error = null;

    const grid = gridOverride ?? (await loadPetGridFromDb(p.id));
    currentPet = { id: p.id, name: p.name, species: p.species, breed: p.breed, grid };

    await loadGeneEffectsForSpecies(p.species);
    loadAppearanceConfigForSpecies(p.species);

    buildGrid();
  } catch (err: unknown) {
    error = `Failed to load pet: ${err instanceof Error ? err.message : String(err)}`;
    console.error('❌ Error loading pet data:', err);
    headerStructure = null;
    chromosomeData = [];
  } finally {
    // Mark this pet as built (success or error) so the effect won't re-load it,
    // then drop `loading` — that flip re-runs the effect, which reconciles to a
    // pet that changed while this load was in flight.
    loadedKey = String(p.id);
    loading = false;
  }
}

async function loadGeneEffectsForSpecies(species: string) {
  const normalizedSpecies = normalizeSpecies(species);
  if (globalGeneEffectsDB[normalizedSpecies]) {
    geneEffectsDB = globalGeneEffectsDB;
    return;
  }
  const data = await getGeneEffectsCached(species);
  if (data) globalGeneEffectsDB[normalizedSpecies] = data.effects;
  geneEffectsDB = globalGeneEffectsDB;
}

function loadAppearanceConfigForSpecies(species: string) {
  if (!species) {
    appearanceList = [];
    return;
  }
  const config = getAppearanceConfig(normalizeSpecies(species));
  appearanceList = config.appearance_attributes || [];
}

// --- Effect / breed helpers (shared by cell build + tooltip) ----------------

function getGeneEffect(speciesKey: string, geneId: string, geneType: string) {
  return effectFor(geneEffectsDB?.[speciesKey]?.[geneId], geneType);
}

function getGeneAppearance(speciesKey: string, geneId: string) {
  if (!geneEffectsDB) return 'No appearance effect';
  const geneData = geneEffectsDB[speciesKey]?.[geneId];
  if (
    !geneData?.appearance ||
    geneData.appearance === 'None' ||
    geneData.appearance.includes('String for me to fill')
  ) {
    return 'No appearance effect';
  }
  return geneData.appearance;
}

function getGeneBreed(speciesKey: string, geneId: string) {
  return breedFor(geneEffectsDB?.[speciesKey]?.[geneId]);
}

/** Breed-inactive styling is a property of the PET's own breed, not the filter. */
function isGeneRelevantToBreed(speciesKey: string, geneId: string) {
  if (speciesKey !== 'horse') return true;
  const petBreed = pet?.breed;
  if (!petBreed || petBreed === 'Mixed') return true;
  const geneBreed = getGeneBreed(speciesKey, geneId);
  return !geneBreed || geneBreed === petBreed;
}

/** Whether either allele carries a real (non-neutral) effect. */
function hasAnyPotentialEffect(speciesKey: string, geneId: string) {
  const d = getGeneEffect(speciesKey, geneId, 'D');
  const r = getGeneEffect(speciesKey, geneId, 'R');
  return (!isNoEffect(d) && d.trim() !== '') || (!isNoEffect(r) && r.trim() !== '');
}

/** The promoted potential type for a neutral gene, or null. */
function analyzePotentialEffectType(speciesKey: string, geneId: string): string | null {
  const d = getGeneEffect(speciesKey, geneId, 'D');
  const r = getGeneEffect(speciesKey, geneId, 'R');
  let hasPositive = false;
  let hasNegative = false;
  if (!isNoEffect(d)) {
    if (d.includes('+')) hasPositive = true;
    if (d.includes('-')) hasNegative = true;
  }
  if (!isNoEffect(r)) {
    if (r.includes('+')) hasPositive = true;
    if (r.includes('-')) hasNegative = true;
  }
  if (hasPositive) return 'potential-positive';
  if (hasNegative) return 'potential-negative';
  return null;
}

// --- Build the grid (once per pet) ------------------------------------------

function buildGrid() {
  const petData = currentPet;
  if (!petData?.grid || Object.keys(petData.grid).length === 0) {
    headerStructure = null;
    chromosomeData = [];
    currentStats = null;
    totalGenes = 0;
    neutralGenes = 0;
    return;
  }

  if (import.meta.env.DEV) console.time('🚀 Gene Visualization Build');

  const speciesKey = normalizeSpecies(petData.species);
  const parsedGenes = petData.grid;
  const matcher = getAttributeMatcher(speciesKey);

  // Resolve the per-view stat attribute name lists once.
  const attrConfig = getAttributeConfig(speciesKey);
  attributeStatNames = attrConfig ? attrConfig.all_attribute_names.map(capitalize) : ALL_ATTRIBUTES.map((a) => a.key);
  const apConfig = getAppearanceConfig(speciesKey);
  appearanceStatNames = apConfig ? apConfig.appearance_attribute_names : FALLBACK_APPEARANCE_KEYS;

  // Per-chromosome breed relevance (horse only) → row hide via CSS.
  chrBreedRelevance = {};
  if (speciesKey === 'horse') {
    const speciesEffects = geneEffectsDB?.[speciesKey] ?? {};
    for (const [geneId, data] of Object.entries(speciesEffects)) {
      const chr = geneId.replace(/[A-Z].*/i, '');
      if (!chrBreedRelevance[chr]) chrBreedRelevance[chr] = { generic: false, breeds: new Set() };
      if (!data.breed) chrBreedRelevance[chr].generic = true;
      else chrBreedRelevance[chr].breeds.add(data.breed);
    }
  }

  const cellCache = new Map<string, VisCell>();
  const makeCell = (gene: ParsedGene): VisCell => {
    const cacheKey = `${gene.id}_${gene.type}`;
    const cached = cellCache.get(cacheKey);
    if (cached) return cached;

    const zygosity =
      gene.type === 'D'
        ? 'dominant'
        : gene.type === 'R'
          ? 'recessive'
          : gene.type === 'x'
            ? 'mixed'
            : gene.type === '?'
              ? 'unknown'
              : 'recessive';

    const relevant = isGeneRelevantToBreed(speciesKey, gene.id);
    const activeEffect = getGeneEffect(speciesKey, gene.id, gene.type);

    // Attribute-view type + active attribute (mirrors the old analyzeGeneEffect
    // attribute branch, plus the neutral→potential promotion done afterwards).
    let effectType: string;
    let activeAttr = '';
    if (!relevant) {
      effectType = 'inactive-breed';
    } else if (isNoEffect(activeEffect)) {
      effectType = 'neutral';
    } else {
      activeAttr = matcher.findFirst(activeEffect) ?? '';
      const isPotential = activeEffect.includes('?') || activeEffect.toLowerCase().includes('potential');
      const hasPlus = activeEffect.includes('+');
      const hasMinus = activeEffect.includes('-');
      if (isPotential && hasPlus) effectType = 'potential-positive';
      else if (isPotential && hasMinus) effectType = 'potential-negative';
      else if (!isPotential && hasPlus) effectType = 'positive';
      else if (!isPotential && hasMinus) effectType = 'negative';
      else effectType = 'neutral';
    }
    if (effectType === 'neutral' && hasAnyPotentialEffect(speciesKey, gene.id)) {
      const pt = analyzePotentialEffectType(speciesKey, gene.id);
      if (pt) effectType = pt;
    }
    const inactiveBreed = effectType === 'inactive-breed';

    // Appearance-view category + the appearance-view tooltip string (the old
    // analyzeGeneEffect appearance branch used the appearance text, or
    // "Different breed" for an inactive-breed gene).
    const appearanceString = getGeneAppearance(speciesKey, gene.id);
    const appearanceCategory = categorizeAppearance(speciesKey, appearanceString);
    const appearance = inactiveBreed ? '' : appearanceCategory;
    const appearanceStatsType = inactiveBreed ? 'inactive-breed' : appearanceCategory;
    const appearanceEffect = inactiveBreed ? 'Different breed' : appearanceString;

    // Both alleles' attributes (either-allele attribute select filter) + the
    // contextual-recolor targets (old getContextualAnalysis).
    const dEff = getGeneEffect(speciesKey, gene.id, 'D');
    const rEff = getGeneEffect(speciesKey, gene.id, 'R');
    const attrSet = new Set<string>();
    if (!isNoEffect(dEff)) for (const a of matcher.findAll(dEff)) attrSet.add(a);
    if (!isNoEffect(rEff)) for (const a of matcher.findAll(rEff)) attrSet.add(a);
    const attrs = joinAttrs(attrSet);

    const ctxPosSet = new Set<string>();
    const ctxNegSet = new Set<string>();
    if (!inactiveBreed) {
      for (const a of attrSet) {
        if (a === activeAttr) continue;
        for (const eff of [dEff, rEff]) {
          if (isNoEffect(eff)) continue;
          if (eff.includes(a)) {
            if (eff.includes('+')) {
              ctxPosSet.add(a);
              break;
            }
            if (eff.includes('-')) {
              ctxNegSet.add(a);
              break;
            }
          }
        }
      }
    }
    const ctxpos = joinAttrs(ctxPosSet);
    const ctxneg = joinAttrs(ctxNegSet);

    const zygCls = `gene-${zygosity}`;
    let attributeCls: string;
    let appearanceCls: string;
    if (gene.type === '?') {
      attributeCls = 'gene-cell gene-neutral gene-unknown';
      appearanceCls = 'gene-cell gene-neutral gene-unknown';
    } else {
      attributeCls = `gene-cell gene-${effectType} ${zygCls}`;
      const appType = inactiveBreed ? 'inactive-breed' : appearanceCategory || 'appearance-neutral';
      appearanceCls = `gene-cell gene-${appType} ${zygCls}`;
    }

    const cell: VisCell = {
      id: gene.id,
      type: gene.type,
      attributeCls,
      appearanceCls,
      attr: activeAttr,
      attrs,
      appearance,
      effectType,
      appearanceStatsType,
      zygosity,
      ctxpos,
      ctxneg,
      effect: activeEffect,
      appearanceEffect,
    };
    cellCache.set(cacheKey, cell);
    return cell;
  };

  // Collect block shape.
  const allBlocks = new Set<string>();
  const blockMaxGenes = new Map<string, number>();
  for (const chromosome of Object.values(parsedGenes)) {
    const perBlock = new Map<string, number>();
    for (const gene of chromosome.allGenes) {
      allBlocks.add(gene.block);
      perBlock.set(gene.block, (perBlock.get(gene.block) || 0) + 1);
    }
    for (const [block, count] of perBlock) {
      blockMaxGenes.set(block, Math.max(blockMaxGenes.get(block) || 0, count));
    }
  }

  const sortedBlocks = Array.from(allBlocks).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const sortedChromosomes = Object.entries(parsedGenes).sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10));

  const rows: ChromosomeRow[] = sortedChromosomes.map(([chromosome, data]) => {
    const genesByBlock = new Map<string, ParsedGene[]>();
    for (const gene of data.allGenes) {
      const list = genesByBlock.get(gene.block);
      if (list) list.push(gene);
      else genesByBlock.set(gene.block, [gene]);
    }
    const cells: (VisCell | null)[][] = sortedBlocks.map((block) => {
      const genesInBlock = genesByBlock.get(block) || [];
      const max = blockMaxGenes.get(block) || 0;
      const out: (VisCell | null)[] = new Array(max);
      for (let i = 0; i < max; i++) out[i] = genesInBlock[i] ? makeCell(genesInBlock[i]) : null;
      return out;
    });
    return { chromosome, cells };
  });

  if (import.meta.env.DEV) {
    let totalDOMElements = 0;
    const chromosomeCount = Object.keys(parsedGenes).length;
    for (const maxGenes of blockMaxGenes.values()) totalDOMElements += chromosomeCount * maxGenes;
    console.warn(`ℹ️ Rendering ${totalDOMElements} gene cells (${chromosomeCount} chromosomes × blocks × genes)`);
  }

  headerStructure = { sortedBlocks, blockMaxGenes };
  chromosomeData = rows;
  computeStats();

  if (import.meta.env.DEV) console.timeEnd('🚀 Gene Visualization Build');
}

// Stats depend on (pet, view) only — never on filters — so they recompute on
// load and on view change, not per filter click.
function computeStats() {
  const view = currentView;
  const names = view === 'attribute' ? attributeStatNames : appearanceStatNames;
  const stats = buildEmptyStats(view, names);
  let total = 0;
  for (const row of chromosomeData) {
    for (const block of row.cells) {
      for (const cell of block) {
        if (!cell) continue;
        total++;
        const analysis =
          view === 'attribute'
            ? { type: cell.effectType, attribute: cell.attr || null }
            : { type: cell.appearanceStatsType, attribute: cell.appearanceStatsType };
        accumulateStats(stats, analysis, cell.type, view);
      }
    }
  }
  currentStats = stats;
  const inactiveRaw = stats['inactive-breed'];
  const inactiveCount = typeof inactiveRaw === 'number' ? inactiveRaw : 0;
  totalGenes = total - inactiveCount;
  if (view === 'attribute') {
    neutralGenes = typeof stats.neutral === 'number' ? stats.neutral : 0;
  } else {
    neutralGenes = typeof stats['appearance-neutral'] === 'number' ? stats['appearance-neutral'] : 0;
  }
  onStatsUpdated?.();
}

// --- Tooltip (event-delegated; no per-cell components / handlers) -----------

// The potential-effect lines are rendered via {@html} in GeneTooltip, so any
// DB/genome-file text interpolated into them is escaped. (The "Current Effect"
// itself is a plain text binding in GeneTooltip and needs no escaping here.)
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showTooltipForCell(cell: HTMLElement, clientX: number, clientY: number) {
  const geneId = cell.dataset.geneId ?? '';
  const geneType = cell.dataset.geneType ?? '';
  // "Current Effect" is view-specific: the attribute-view effect string in the
  // attribute view, the appearance string (or "Different breed") in appearance.
  const effectInfo = currentView === 'appearance' ? (cell.dataset.appearanceEffect ?? '') : (cell.dataset.effect ?? '');

  const potentialEffects: string[] = [];
  if (currentPet) {
    const sk = normalizeSpecies(currentPet.species);
    const dominantEffect = getGeneEffect(sk, geneId, 'D');
    const recessiveEffect = getGeneEffect(sk, geneId, 'R');

    if (geneType !== 'D' && !isNoEffect(dominantEffect)) {
      const color = dominantEffect.includes('+')
        ? EFFECT_COLORS.positive
        : dominantEffect.includes('-')
          ? EFFECT_COLORS.negative
          : '#666';
      potentialEffects.push(`If Dominant: <span style="color: ${color}">${escapeHtml(dominantEffect)}</span>`);
    }
    if (geneType !== 'R' && !isNoEffect(recessiveEffect)) {
      const color = recessiveEffect.includes('+')
        ? EFFECT_COLORS.positive
        : recessiveEffect.includes('-')
          ? EFFECT_COLORS.negative
          : '#666';
      potentialEffects.push(`If Recessive: <span style="color: ${color}">${escapeHtml(recessiveEffect)}</span>`);
    }

    const geneBreed = getGeneBreed(sk, geneId);
    if (!isGeneRelevantToBreed(sk, geneId) && geneBreed) {
      potentialEffects.push(
        `<span style="color: #9ca3af">⚬ ${escapeHtml(geneBreed)} breed only — no effect on this pet</span>`,
      );
    }
  }

  const tooltipWidth = 250;
  const baseHeight = 45;
  const effectHeight = 20;
  const potentialEffectHeight = 15;
  const tooltipHeight =
    baseHeight + (!isNoEffect(effectInfo) ? effectHeight : 0) + potentialEffects.length * potentialEffectHeight;
  const offset = 12;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let x = clientX + offset;
  let y = clientY + offset;
  if (x + tooltipWidth > viewportWidth) x = clientX - tooltipWidth - offset;
  if (y + tooltipHeight > viewportHeight) y = clientY - tooltipHeight - offset;
  if (y < 0) y = clientY + offset;
  if (x < 0) x = clientX + offset;

  tooltipX = x;
  tooltipY = y;
  tooltipGeneId = geneId;
  tooltipGeneType = geneType;
  tooltipEffect = effectInfo;
  tooltipPotentialEffects = potentialEffects;
  tooltipVisible = true;
}

function cellFromEvent(e: Event): HTMLElement | null {
  const target = e.target as HTMLElement | null;
  return target?.closest?.('.gene-cell[data-gene-id]') ?? null;
}

function handleGridPointerOver(e: MouseEvent) {
  const cell = cellFromEvent(e);
  if (cell) showTooltipForCell(cell, e.clientX, e.clientY);
}

function handleGridPointerOut(e: MouseEvent) {
  const cell = cellFromEvent(e);
  if (!cell) return;
  const to = e.relatedTarget as Node | null;
  if (to && cell.contains(to)) return;
  tooltipVisible = false;
}

function handleGridFocusIn(e: FocusEvent) {
  const cell = cellFromEvent(e);
  if (!cell) return;
  const rect = cell.getBoundingClientRect();
  showTooltipForCell(cell, rect.left + rect.width / 2, rect.top);
}

function handleGridFocusOut() {
  tooltipVisible = false;
}

function handleGridKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    tooltipVisible = false;
    return;
  }
  const active = document.activeElement as HTMLElement | null;
  const activeCell = (active?.closest?.('.gene-cell[data-gene-id]') as HTMLElement | null) ?? null;
  if ((e.key === 'Enter' || e.key === ' ') && activeCell) {
    e.preventDefault();
    const rect = activeCell.getBoundingClientRect();
    showTooltipForCell(activeCell, rect.left + rect.width / 2, rect.top);
    return;
  }
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;

  const container = e.currentTarget as HTMLElement;
  const cells = Array.from(container.querySelectorAll<HTMLElement>('.gene-cell[role="button"]'));
  const current = activeCell ? cells.indexOf(activeCell) : -1;
  if (current < 0) return;
  const row = activeCell?.closest('tr');
  const cols = row ? row.querySelectorAll('.gene-cell[role="button"]').length : 1;
  handleGridNavigation(cells, current, e, cols);
}

// --- Filter actions (state-only; the injected sheet reacts) -----------------

function toggleChromosomeFilter(chromosome: string, ctrlKey = false, altKey = false) {
  if (altKey) {
    hiddenChromosomes = hiddenChromosomes.includes(chromosome)
      ? hiddenChromosomes.filter((c) => c !== chromosome)
      : [...hiddenChromosomes, chromosome];
  } else if (ctrlKey) {
    selectedChromosomes = selectedChromosomes.includes(chromosome)
      ? selectedChromosomes.filter((c) => c !== chromosome)
      : [...selectedChromosomes, chromosome];
  } else {
    selectedChromosomes = selectedChromosomes.length === 1 && selectedChromosomes[0] === chromosome ? [] : [chromosome];
  }
}

function handleLegendFilterClick(filterType: string, event: MouseEvent | KeyboardEvent) {
  const isCtrlClick = event.ctrlKey || event.metaKey;
  const isAltClick = event.altKey;

  if (currentView === 'attribute') {
    if (['positive', 'negative', 'neutral', 'potential-positive', 'potential-negative'].includes(filterType)) {
      handleEffectFilter(filterType, isCtrlClick, isAltClick);
    } else if (['dominant', 'recessive', 'mixed', 'unknown'].includes(filterType)) {
      handleValueFilter(filterType, isCtrlClick, isAltClick);
    }
  } else {
    handleAppearanceFilter(filterType, isCtrlClick, isAltClick);
  }
}

function handleEffectFilter(effectType: string, isCtrlClick = false, isAltClick = false) {
  const result = resolveFilterClick(currentEffectFilter, hiddenEffectFilters, effectType, isCtrlClick, isAltClick);
  currentEffectFilter = result.selected;
  hiddenEffectFilters = result.hidden;
}

function handleValueFilter(valueType: string, isCtrlClick = false, isAltClick = false) {
  const valueMap: Record<string, string> = {
    dominant: 'gene-dominant',
    recessive: 'gene-recessive',
    mixed: 'gene-mixed',
    unknown: 'gene-unknown',
  };
  const mappedValueType = valueMap[valueType] || valueType;
  const result = resolveFilterClick(currentValueFilter, hiddenValueFilters, mappedValueType, isCtrlClick, isAltClick);
  currentValueFilter = result.selected;
  hiddenValueFilters = result.hidden;
}

function handleAppearanceFilter(appearanceType: string, isCtrlClick = false, isAltClick = false) {
  let attributeGroups: string[] = [];
  switch (appearanceType) {
    case 'body-color':
      attributeGroups = ['body-color-hue', 'body-color-saturation', 'body-color-intensity'];
      break;
    case 'wing-color':
      attributeGroups = ['wing-color-hue', 'wing-color-saturation', 'wing-color-intensity'];
      break;
    case 'deformity':
      attributeGroups = ['leg-deformity', 'antenna-deformity'];
      break;
    case 'particles':
      attributeGroups = ['particles', 'particle-location'];
      break;
    case 'glow':
      attributeGroups = ['glow'];
      break;
    case 'neutral':
      attributeGroups = ['appearance-neutral'];
      break;
    case 'scale':
      attributeGroups = ['scale'];
      break;
    case 'attributes':
      attributeGroups = ['attributes'];
      break;
    case 'selector':
      attributeGroups = ['selector'];
      break;
    case 'horn':
      attributeGroups = ['horn'];
      break;
    case 'aura':
      attributeGroups = ['aura'];
      break;
    case 'coat':
      attributeGroups = ['coat'];
      break;
    case 'face-markings':
      attributeGroups = ['face-markings'];
      break;
    case 'hair':
      attributeGroups = ['hair'];
      break;
    case 'leg-markings':
      attributeGroups = ['leg-markings'];
      break;
    case 'magical':
      attributeGroups = ['magical'];
      break;
    case 'markings':
      attributeGroups = ['markings'];
      break;
    case 'body-scale':
    case 'wing-scale':
    case 'head-scale':
    case 'tail-scale':
    case 'antenna-scale':
      attributeGroups = ['body-scale', 'wing-scale', 'head-scale', 'tail-scale', 'antenna-scale'];
      break;
  }

  for (const attr of attributeGroups) {
    if (isAltClick) {
      hiddenAttributes = hiddenAttributes.includes(attr)
        ? hiddenAttributes.filter((a) => a !== attr)
        : [...hiddenAttributes, attr];
    } else if (isCtrlClick) {
      selectedAttributes = selectedAttributes.includes(attr)
        ? selectedAttributes.filter((a) => a !== attr)
        : [...selectedAttributes, attr];
    }
  }
  if (!isAltClick && !isCtrlClick) {
    const allSelected = attributeGroups.every((a) => selectedAttributes.includes(a));
    if (allSelected) {
      selectedAttributes = selectedAttributes.filter((a) => !attributeGroups.includes(a));
    } else {
      const next = [...selectedAttributes];
      for (const a of attributeGroups) if (!next.includes(a)) next.push(a);
      selectedAttributes = next;
    }
  }
}

// --- Exported API (unchanged signatures for PetVisualization / community) ----

export function handleAttributeFilter(event: CustomEvent<{ attribute: string; ctrlKey: boolean; altKey: boolean }>) {
  const { attribute, ctrlKey, altKey } = event.detail;
  const result = resolveFilterClick(selectedAttributes, hiddenAttributes, attribute, ctrlKey, altKey);
  selectedAttributes = result.selected;
  hiddenAttributes = result.hidden;
}

export function handleViewChange(view: string) {
  currentView = view === 'appearance' ? 'appearance' : 'attribute';
  computeStats();
}

export function setBreedFilter(breed: string) {
  currentBreedFilter = breed;
}

export function getStatsData() {
  return {
    currentStats,
    currentView,
    selectedAttributes,
    hiddenAttributes,
    totalGenes,
    neutralGenes,
    petSpecies: currentPet?.species,
  };
}

const blockIndices = $derived.by(() => {
  const hs = headerStructure;
  if (!hs) return {} as Record<string, number[]>;
  const out: Record<string, number[]> = {};
  for (const block of hs.sortedBlocks) {
    out[block] = Array.from({ length: hs.blockMaxGenes.get(block) ?? 0 }, (_, i) => i);
  }
  return out;
});
</script>

<div class="gene-visualizer">
    {#if loading}
        <div class="visualizer-state"><StatusPane variant="loading" body="Loading gene data..." /></div>
    {:else if error}
        <div class="visualizer-state"><StatusPane variant="error" body={`Error: ${error}`} /></div>
    {:else if !currentPet}
        <div class="visualizer-state"><StatusPane variant="empty" body="Select a pet to visualize its genes" /></div>
    {:else}
        <div class="visualizer-content">
            <div class="gene-section">
                <!-- Legend — clickable dual-encoding (effect colour / value zygosity) filters -->
                <div class="gene-legend">
                    <div class="legend-items">
                        {#if currentView === "attribute"}
                            <div class="legend-row">
                                <span class="legend-label legend-label-effect">Effect:</span>

                                {#each [["positive", "Positive", "dominant"], ["potential-positive", "Potential Positive", "dominant"], ["neutral", "Neutral", "dominant"], ["potential-negative", "Potential Negative", "dominant"], ["negative", "Negative", "dominant"]] as [key, label, zyg] (key)}
                                    <span
                                        class="legend-item effect-legend-item {currentEffectFilter.includes(key) ? 'selected' : ''} {hiddenEffectFilters.includes(key) ? 'hidden-effect' : ''}"
                                        role="button"
                                        tabindex="0"
                                        onclick={(e) => handleLegendFilterClick(key, e)}
                                        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLegendFilterClick(key, e); }}
                                    >
                                        <span class="gene-cell gene-{key} gene-{zyg}"></span>
                                        <span>{label}</span>
                                    </span>
                                {/each}

                                <span class="legend-label legend-label-value">Value:</span>

                                {#each [["dominant", "Dominant"], ["recessive", "Recessive"], ["mixed", "Mixed"], ["unknown", "Unknown"]] as [key, label] (key)}
                                    {@const stateKey = `gene-${key}`}
                                    <span
                                        class="legend-item value-legend-item {currentValueFilter.includes(stateKey) ? 'selected' : ''} {hiddenValueFilters.includes(stateKey) ? 'hidden-effect' : ''}"
                                        role="button"
                                        tabindex="0"
                                        onclick={(e) => handleLegendFilterClick(key, e)}
                                        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLegendFilterClick(key, e); }}
                                    >
                                        <span class="gene-cell gene-neutral gene-{key}"></span>
                                        <span>{label}</span>
                                    </span>
                                {/each}
                            </div>
                        {:else}
                            <div class="legend-row">
                                <span class="legend-label legend-label-appearance">Appearance:</span>

                                {#each appearanceList as appearance (appearance.key)}
                                    {@const attrKey = appearance.key.replace(/_/g, "-")}
                                    <span
                                        class="legend-item appearance-legend-item {selectedAttributes.includes(attrKey) ? 'selected' : ''} {hiddenAttributes.includes(attrKey) ? 'hidden-effect' : ''}"
                                        role="button"
                                        tabindex="0"
                                        onclick={(e) => handleLegendFilterClick(attrKey, e)}
                                        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLegendFilterClick(attrKey, e); }}
                                    >
                                        <span class="gene-cell gene-{attrKey} gene-dominant"></span>
                                        <span>{appearance.name}</span>
                                    </span>
                                {/each}
                            </div>
                        {/if}
                    </div>
                </div>

                <!-- Gene grid — plain divs built once; filtering is CSS-only.
                     Tooltip + keyboard-nav listeners are delegated on this
                     container via addEventListener (see the $effect above). -->
                <div
                    class="gene-grid-container"
                    bind:this={gridContainerEl}
                    style="--cell-size: {cellSize}px"
                >
                    {#if headerStructure && chromosomeData.length > 0}
                        {#key headerStructure}
                            <table class="gene-grid-table">
                                <thead class="gene-headers">
                                    <tr>
                                        <th class="chromosome-header">Chr</th>
                                        {#each headerStructure.sortedBlocks as block (block)}
                                            {#each blockIndices[block] as i (i)}
                                                <th class="position-header {i === 0 ? 'block-label block-start' : ''}">{i === 0 ? block : ""}</th>
                                            {/each}
                                        {/each}
                                    </tr>
                                </thead>
                                <tbody class="gene-rows">
                                    {#each chromosomeData as row (row.chromosome)}
                                        <tr class="chromosome-row" data-chromosome={row.chromosome}>
                                            <td
                                                class="chromosome-label {selectedChromosomes.includes(row.chromosome) ? 'selected' : ''} {hiddenChromosomes.includes(row.chromosome) ? 'hidden-chromosome' : ''}"
                                                data-chromosome={row.chromosome}
                                                onclick={(e) => toggleChromosomeFilter(row.chromosome, e.ctrlKey || e.metaKey, e.altKey)}
                                            >{row.chromosome}</td>
                                            {#each headerStructure.sortedBlocks as block, bi (block)}
                                                {#each blockIndices[block] as i (i)}
                                                    {@const cell = row.cells[bi]?.[i] ?? null}
                                                    <td class="gene-cell-container {i === 0 ? 'block-start' : ''} {!cell ? 'empty' : ''}">
                                                        {#if cell}
                                                            <div
                                                                class={currentView === "appearance" ? cell.appearanceCls : cell.attributeCls}
                                                                data-gene-id={cell.id}
                                                                data-gene-type={cell.type}
                                                                data-effect={cell.effect}
                                                                data-appearance-effect={cell.appearanceEffect}
                                                                data-attrs={cell.attrs}
                                                                data-appearance={cell.appearance}
                                                                data-effecttype={cell.effectType}
                                                                data-zygosity={cell.zygosity}
                                                                data-ctxpos={cell.ctxpos}
                                                                data-ctxneg={cell.ctxneg}
                                                                role="button"
                                                                tabindex="0"
                                                                aria-label={`Gene ${cell.id}${cell.effect ? ': ' + cell.effect : ''}`}
                                                            >{#if cell.type === "?"}<span class="gene-unknown-symbol" title="Unknown gene">?</span>{/if}</div>
                                                        {/if}
                                                    </td>
                                                {/each}
                                            {/each}
                                        </tr>
                                    {/each}
                                </tbody>
                            </table>
                        {/key}
                    {/if}
                </div>
            </div>
        </div>
    {/if}

    <GeneTooltip
        visible={tooltipVisible}
        x={tooltipX}
        y={tooltipY}
        geneId={tooltipGeneId}
        geneType={tooltipGeneType}
        effect={tooltipEffect}
        potentialEffects={tooltipPotentialEffects}
    />
</div>

<style>
    /* Gene colors defined as --gene-* CSS vars in :root in src/app.css.
       Shared .gene-cell visuals live in ./geneCell.css (imported above). */

    .visualizer-state {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .gene-visualizer {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--bg-primary);
        min-height: 0;
    }

    .visualizer-content {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
    }

    .gene-section {
        padding: 6px 8px;
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
    }

    .gene-legend {
        margin-bottom: 6px;
        flex-shrink: 0;
    }

    .legend-items {
        width: 100%;
    }

    .legend-row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.5em;
    }

    .legend-label-effect {
        font-weight: 600;
        margin-right: 1em;
    }

    .legend-label-value {
        font-weight: 600;
        margin-left: 2em;
        margin-right: 1em;
    }

    .legend-label-appearance {
        font-weight: 600;
        margin-right: 1em;
    }

    .legend-item {
        display: flex;
        align-items: center;
        gap: 0.3em;
        font-size: 10px;
        color: var(--text-tertiary);
        white-space: nowrap;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 4px;
        transition: background-color 0.2s ease;
    }

    .legend-item:hover {
        background-color: var(--bg-hover);
    }

    /* Sample swatch sizing for the legend (a plain .gene-cell with no grid --cell-size) */
    .legend-item :global(.gene-cell) {
        width: 14px;
        height: 14px;
        margin: 0 4px 0 0;
        pointer-events: none;
    }

    .effect-legend-item,
    .value-legend-item,
    .appearance-legend-item {
        cursor: pointer;
        transition:
            background 0.2s,
            box-shadow 0.2s,
            outline 0.2s;
    }

    .effect-legend-item.selected,
    .value-legend-item.selected,
    .appearance-legend-item.selected {
        background: var(--accent-soft) !important;
        border-radius: 6px;
        box-shadow: 0 2px 8px var(--accent-soft);
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }

    .effect-legend-item.hidden-effect,
    .value-legend-item.hidden-effect,
    .appearance-legend-item.hidden-effect {
        opacity: 0.7;
        color: var(--error-text) !important;
        text-decoration: line-through;
        filter: grayscale(0.7);
        pointer-events: auto;
        background: var(--error-bg);
        border-radius: 6px;
        box-shadow: 0 2px 8px var(--error-bg);
        outline: 2px solid var(--error);
        outline-offset: 2px;
        transition:
            opacity 0.2s,
            color 0.2s,
            outline 0.2s;
    }

    .gene-grid-container {
        flex: 1;
        min-height: 0;
        overflow: auto;
        border: 1px solid var(--border-primary);
        border-radius: 6px;
        background: var(--bg-secondary);
    }

    .gene-grid-table {
        width: auto;
        border-collapse: collapse;
        table-layout: fixed;
    }

    .gene-headers {
        position: sticky;
        top: 0;
        z-index: 10;
        background: var(--bg-secondary);
    }

    .gene-headers th {
        background: var(--bg-secondary);
        border-bottom: 1px solid var(--border-primary);
        padding: 2px 4px;
        font-size: 9px;
        font-weight: normal;
        color: var(--text-secondary);
        text-align: center;
        white-space: nowrap;
    }

    .chromosome-header {
        position: sticky;
        left: 0;
        z-index: 11;
        background: var(--bg-secondary);
        font-weight: bold;
        width: 28px;
        min-width: 28px;
        max-width: 28px;
    }

    .position-header {
        width: var(--cell-size, 16px);
        min-width: var(--cell-size, 16px);
        max-width: var(--cell-size, 16px);
        font-weight: normal;
    }

    .position-header.block-label {
        font-weight: bold;
    }

    .position-header.block-start {
        padding-left: 10px;
    }

    .position-header.block-start:first-of-type {
        padding-left: 2px;
    }

    .gene-rows {
        background: var(--bg-secondary);
    }

    .chromosome-row {
        border-bottom: 1px solid var(--bg-tertiary);
    }

    .chromosome-row:hover {
        background: var(--bg-secondary);
    }

    .chromosome-label {
        position: sticky;
        left: 0;
        z-index: 1;
        background: var(--bg-secondary);
        border-right: 1px solid var(--border-primary);
        padding: 3px 2px;
        font-size: 10px;
        font-weight: 600;
        color: var(--text-secondary);
        text-align: center;
        cursor: pointer;
        transition: background-color 0.2s ease;
        user-select: none;
        /* KEEP IN SYNC with CHR_COL_WIDTH in utils/geneGridCells.ts */
        width: 28px;
        min-width: 28px;
        max-width: 28px;
    }

    .chromosome-label:hover {
        background: var(--bg-hover);
    }

    .chromosome-label.selected {
        background: #f3e8ff;
        color: #7c3aed;
        border-left: 3px solid #7c3aed;
        font-weight: 600;
    }

    .chromosome-label.hidden-chromosome {
        background: #fff7ed;
        color: #ea580c;
        border-left: 3px solid #ea580c;
        font-weight: 600;
    }

    .gene-cell-container {
        padding: 1px;
        text-align: center;
        vertical-align: middle;
        position: relative;
        width: var(--cell-size, 16px);
    }

    .gene-cell-container.empty {
        background: var(--bg-secondary);
    }

    .gene-cell-container.block-start {
        /* KEEP IN SYNC with BLOCK_GAP in utils/geneGridCells.ts */
        padding-left: 8px;
    }

    .gene-cell-container.block-start:first-of-type {
        padding-left: 1px;
    }
</style>
