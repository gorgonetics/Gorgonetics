<script lang="ts">
import { onDestroy, onMount } from 'svelte';
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
import { resolveFilterClick } from '$lib/utils/filterToggle.js';
import {
  breedFor,
  effectFor,
  type GeneEffectData,
  isNoEffect,
  type ParsedChromosome,
  type ParsedGene,
} from '$lib/utils/geneAnalysis.js';
import { type GeneEffectLookup, type GeneFilterState, isGeneVisible } from '$lib/utils/geneFilter.js';
import { computeGeneCellSize } from '$lib/utils/geneGridCells.js';
import {
  updateStats as accumulateStats,
  initializeStats as buildEmptyStats,
  type StatsMap,
} from '$lib/utils/geneStats.js';
import { handleGridNavigation } from '$lib/utils/keyboard.js';
import { capitalize } from '$lib/utils/string.js';
import GeneCell from './GeneCell.svelte';
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
}

interface GeneAnalysisResult {
  type: string;
  attribute: string | null;
  effect: string;
}

interface ProcessedGene extends ParsedGene {
  geneAnalysis: GeneAnalysisResult;
  isVisible: boolean;
}

interface SpeciesTemplate {
  species: string;
  chromosomeCount: number;
  blockCount: number;
  sortedBlocks: string[];
  blockMaxGenes: Map<string, number>;
  timestamp: number;
}

interface HeaderStructure {
  sortedBlocks: string[];
  blockMaxGenes: Map<string, number>;
}

interface ChromosomeRow {
  chromosome: string;
  data: ParsedChromosome;
  processedBlocks: Record<string, (ProcessedGene | null)[]>;
}

const { pet, onStatsUpdated }: Props = $props();

let containerElement = $state<HTMLElement | undefined>(undefined);

let loading = $state(false);
let error = $state<string | null>(null);
let currentPet = $state<{
  id: number;
  name: string;
  species: string;
  breed: string;
  grid: Record<string, ParsedChromosome>;
} | null>(null);
let currentView = $state('attribute');
let geneEffectsDB: Record<string, Record<string, GeneEffectData>> | null = null;

// Stats-related reactive variables
let currentStats = $state<StatsMap | null>(null);
let totalGenes = $state(0);
let neutralGenes = $state(0);
let appearanceList = $state<AppearanceInfo[]>([]);
let selectedAttributes = $state<string[]>([]);
let hiddenAttributes = $state<string[]>([]);
let selectedChromosomes = $state<string[]>([]);
let hiddenChromosomes = $state<string[]>([]);

// Filter states
let currentEffectFilter = $state<string[]>([]);
let hiddenEffectFilters = $state<string[]>([]);
let currentValueFilter = $state<string[]>([]);
let hiddenValueFilters = $state<string[]>([]);

// Breed filter state (horse only)
let currentBreedFilter = $state('');

function chromosomeHasBreed(chromosome: string, breedName: string) {
  if (!geneEffectsDB || !currentPet) return true;
  const speciesKey = normalizeSpecies(currentPet.species);
  const speciesEffects = geneEffectsDB[speciesKey];
  if (!speciesEffects) return true;
  // A chromosome matches if it has generic genes (no breed) or genes for this breed
  for (const [geneId, data] of Object.entries(speciesEffects)) {
    if (geneId.startsWith(chromosome)) {
      if (!data.breed || data.breed === '' || data.breed === breedName) {
        return true;
      }
    }
  }
  return false;
}

// Tooltip state
let tooltipVisible = $state(false);
let tooltipX = $state(0);
let tooltipY = $state(0);
let tooltipGeneId = $state('');
let tooltipGeneType = $state('');

// Template system state (disabled)
let tooltipEffect = $state('');
let tooltipPotentialEffects = $state<string[]>([]);

// Parsed gene data
let headerStructure = $state<HeaderStructure | null>(null);
let chromosomeData = $state<ChromosomeRow[]>([]);

// Responsive cell sizing — scale the fixed-cell grid to fill its container
// width instead of leaving a large dead zone (wide window) or overflowing
// with a scrollbar (narrow window / stats drawer open). A ResizeObserver
// tracks the live container width; cell size is clamped for readability.
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

// Global gene effects database - persists across pet selections
let globalGeneEffectsDB: Record<string, Record<string, GeneEffectData>> = {};

// DOM template cache - stores pre-built table structures per species
const speciesTemplateCache = new Map<string, SpeciesTemplate>();
let currentSpeciesTemplate = $state<SpeciesTemplate | null>(null);
let isUsingCachedTemplate = false;

onMount(async () => {
  // Preload gene effects for common species to improve performance
  await preloadGeneEffects();

  if (pet) {
    await loadPetData();
  }
});

async function preloadGeneEffects() {
  const commonSpecies = ['horse', 'beewasp'];

  // Load in parallel for better performance
  const loadPromises = commonSpecies.map(async (species) => {
    try {
      const normalizedSpecies = normalizeSpecies(species);
      if (!globalGeneEffectsDB[normalizedSpecies]) {
        const data = await getGeneEffectsCached(species);
        if (data) {
          globalGeneEffectsDB[normalizedSpecies] = data.effects;
        }
      }
    } catch (error) {
      console.warn(`Failed to preload gene effects for ${species}:`, error);
    }
  });

  await Promise.all(loadPromises);
}

function createSpeciesTemplate(species: string, hs: HeaderStructure, chromosomeCount: number): SpeciesTemplate {
  return {
    species,
    chromosomeCount,
    blockCount: hs.sortedBlocks.length,
    sortedBlocks: [...hs.sortedBlocks],
    blockMaxGenes: new Map(hs.blockMaxGenes),
    timestamp: Date.now(),
  };
}

function getOrCreateSpeciesTemplate(species: string, hs: HeaderStructure, chromosomeCount: number): SpeciesTemplate {
  // sortedBlocks.length is fully derived from species + chromosomeCount, so
  // it adds nothing to cache identity. Drop it from the key.
  const cacheKey = `${species}_${chromosomeCount}`;

  if (speciesTemplateCache.has(cacheKey)) {
    const cached = speciesTemplateCache.get(cacheKey);
    if (cached) {
      isUsingCachedTemplate = true;
      return cached;
    }
  }

  const template = createSpeciesTemplate(species, hs, chromosomeCount);
  speciesTemplateCache.set(cacheKey, template);
  isUsingCachedTemplate = false;
  return template;
}

onDestroy(() => {
  cleanup();
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
  headerStructure = null;
  chromosomeData = [];
  // NOTE: We keep globalGeneEffectsDB intact for performance

  error = null;
}

async function loadPetData() {
  if (!pet || loading) {
    return;
  }

  try {
    loading = true;
    error = null;

    const grid = await loadPetGridFromDb(pet.id);
    const loaded = { id: pet.id, name: pet.name, species: pet.species, breed: pet.breed, grid };
    currentPet = loaded;

    // Load gene effects and appearance config in parallel for better performance
    await loadGeneEffectsForSpecies(loaded.species);
    loadAppearanceConfigForSpecies(loaded.species);

    await updateVisualization();
  } catch (err: unknown) {
    error = `Failed to load pet: ${err instanceof Error ? err.message : String(err)}`;
    console.error('❌ Error loading pet data:', err);
  } finally {
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
  if (data) {
    globalGeneEffectsDB[normalizedSpecies] = data.effects;
    geneEffectsDB = globalGeneEffectsDB;
  } else {
    geneEffectsDB = globalGeneEffectsDB;
  }
}

function loadAppearanceConfigForSpecies(species: string) {
  if (!species) {
    appearanceList = [];
    return;
  }
  const config = getAppearanceConfig(normalizeSpecies(species));
  appearanceList = config.appearance_attributes || [];
}

// Resolve the per-view attribute names then delegate to the pure stats builder.
// Kept async (awaited by the caller) so the heavy synchronous state writes in
// createGeneVisualization stay on a later microtask — collapsing that boundary
// reintroduces an effect_update_depth_exceeded loop.
async function initializeStats(): Promise<StatsMap> {
  if (currentView === 'attribute') {
    let attrNames = ALL_ATTRIBUTES.map((a) => a.key);
    if (currentPet?.species) {
      const config = getAttributeConfig(normalizeSpecies(currentPet.species));
      if (config) {
        attrNames = config.all_attribute_names.map((name) => capitalize(name));
      }
    }
    return buildEmptyStats('attribute', attrNames);
  }

  let attrNames = FALLBACK_APPEARANCE_KEYS;
  if (currentPet?.species) {
    const config = getAppearanceConfig(normalizeSpecies(currentPet.species));
    if (config) {
      attrNames = config.appearance_attribute_names;
    }
  }
  return buildEmptyStats('appearance', attrNames);
}

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

function extractAttributeFromEffect(species: string, effectStr: string) {
  return getAttributeMatcher(species).findFirst(effectStr);
}

function extractAttributesFromEffect(species: string, effectStr: string) {
  return getAttributeMatcher(species).findAll(effectStr);
}

function getGeneBreed(speciesKey: string, geneId: string) {
  return breedFor(geneEffectsDB?.[speciesKey]?.[geneId]);
}

function isGeneRelevantToBreed(speciesKey: string, geneId: string) {
  if (speciesKey !== 'horse') return true;
  // If pet has no breed set or it's "Mixed", all genes are relevant
  // Use the pet prop (has breed) rather than currentPet (genome data only)
  const petBreed = pet?.breed;
  if (!petBreed || petBreed === 'Mixed') return true;
  // Gene is relevant if it's generic (no breed) or matches pet's breed
  const geneBreed = getGeneBreed(speciesKey, geneId);
  return !geneBreed || geneBreed === petBreed;
}

function analyzeGeneEffect(species: string, geneId: string, geneType: string): GeneAnalysisResult {
  if (currentView === 'attribute') {
    const effect = getGeneEffect(species, geneId, geneType);

    // Check if gene belongs to a different breed — mark as inactive
    if (!isGeneRelevantToBreed(species, geneId)) {
      return {
        type: 'inactive-breed',
        attribute: null,
        effect: effect,
      };
    }

    if (isNoEffect(effect)) {
      return {
        type: 'neutral',
        attribute: null,
        effect: effect,
      };
    }

    // Robust potential/neutral/positive/negative detection
    let type = 'neutral';
    const effectStr = effect || '';

    // Dynamic attribute detection using centralized config
    const attribute = extractAttributeFromEffect(species, effectStr);

    // Potential effect detection
    const isPotential = effectStr.includes('?') || effectStr.toLowerCase().includes('potential');
    const hasPlus = effectStr.includes('+');
    const hasMinus = effectStr.includes('-');

    if (isPotential && hasPlus) type = 'potential-positive';
    else if (isPotential && hasMinus) type = 'potential-negative';
    else if (!isPotential && hasPlus) type = 'positive';
    else if (!isPotential && hasMinus) type = 'negative';
    // else remains "neutral"

    return {
      type,
      attribute: attribute,
      effect: effect,
    };
  } else {
    // Appearance mode
    if (!isGeneRelevantToBreed(species, geneId)) {
      return {
        type: 'inactive-breed',
        attribute: null,
        effect: 'Different breed',
      };
    }

    const appearance = getGeneAppearance(species, geneId);
    const appearanceCategory = categorizeAppearance(species, appearance);

    return {
      type: appearanceCategory,
      attribute: appearanceCategory,
      effect: appearance,
    };
  }
}

function hasAnyPotentialEffect(species: string, geneId: string) {
  if (currentView === 'attribute') {
    const dominantEffect = getGeneEffect(species, geneId, 'D');
    const recessiveEffect = getGeneEffect(species, geneId, 'R');

    const dominantHasEffect = !isNoEffect(dominantEffect) && dominantEffect.trim() !== '';
    const recessiveHasEffect = !isNoEffect(recessiveEffect) && recessiveEffect.trim() !== '';

    return dominantHasEffect || recessiveHasEffect;
  } else {
    const appearance = getGeneAppearance(species, geneId);
    return appearance !== 'No appearance effect';
  }
}

function analyzePotentialEffectType(species: string, geneId: string) {
  const dominantEffect = getGeneEffect(species, geneId, 'D');
  const recessiveEffect = getGeneEffect(species, geneId, 'R');

  let hasPositive = false;
  let hasNegative = false;

  if (!isNoEffect(dominantEffect)) {
    if (dominantEffect.includes('+')) hasPositive = true;
    if (dominantEffect.includes('-')) hasNegative = true;
  }

  if (!isNoEffect(recessiveEffect)) {
    if (recessiveEffect.includes('+')) hasPositive = true;
    if (recessiveEffect.includes('-')) hasNegative = true;
  }

  if (hasPositive) return 'potential-positive';
  if (hasNegative) return 'potential-negative';
  return null;
}

function getContextualAnalysis(species: string, geneId: string, geneAnalysis: GeneAnalysisResult): GeneAnalysisResult {
  if (selectedAttributes.length !== 1 || currentView !== 'attribute' || geneAnalysis.type === 'inactive-breed') {
    return geneAnalysis;
  }
  const attr = selectedAttributes[0];
  if (geneAnalysis.attribute === attr) {
    return geneAnalysis;
  }
  // Gene's active effect is on a different attribute — check if it potentially
  // affects the selected attribute via the other allele
  const dominantEffect = getGeneEffect(species, geneId, 'D');
  const recessiveEffect = getGeneEffect(species, geneId, 'R');
  for (const eff of [dominantEffect, recessiveEffect]) {
    if (isNoEffect(eff)) continue;
    if (eff.includes(attr)) {
      const hasPlus = eff.includes('+');
      const hasMinus = eff.includes('-');
      if (hasPlus) return { ...geneAnalysis, type: 'potential-positive', attribute: attr };
      if (hasMinus) return { ...geneAnalysis, type: 'potential-negative', attribute: attr };
    }
  }
  return geneAnalysis;
}

function genePotentiallyAffectsSelectedAttributes(species: string, geneId: string, selectedAttributes: string[]) {
  if (selectedAttributes.length === 0) {
    return true;
  }

  const dominantEffect = getGeneEffect(species, geneId, 'D');
  const recessiveEffect = getGeneEffect(species, geneId, 'R');

  const allPotentialAttributes = [];

  if (!isNoEffect(dominantEffect)) {
    allPotentialAttributes.push(...extractAttributesFromEffect(species, dominantEffect));
  }
  if (!isNoEffect(recessiveEffect)) {
    allPotentialAttributes.push(...extractAttributesFromEffect(species, recessiveEffect));
  }

  return allPotentialAttributes.some((attr) => selectedAttributes.includes(attr));
}

async function updateVisualization() {
  if (!currentPet) {
    return;
  }

  try {
    await createGeneVisualization();
  } catch (err) {
    console.error('Error updating visualization:', err);
    error = 'Failed to update gene visualization';
  }
}

async function createGeneVisualization() {
  if (!currentPet?.grid) {
    // Reset to empty state with proper structure
    headerStructure = null;
    chromosomeData = [];
    currentStats = null;
    totalGenes = 0;
    neutralGenes = 0;

    return;
  }

  try {
    if (import.meta.env.DEV) console.time('🚀 Gene Visualization Processing');
    const pet = currentPet;
    const speciesKey = normalizeSpecies(pet.species);
    const parsedGenes = pet.grid;

    if (!parsedGenes || Object.keys(parsedGenes).length === 0) {
      headerStructure = null;
      chromosomeData = [];
      return;
    }

    const allStats = await initializeStats();

    // OPTIMIZED SINGLE-PASS PROCESSING - Everything done in one loop!
    if (import.meta.env.DEV) console.time('📊 Single-pass gene analysis');

    const allBlocks = new Set<string>();
    const blockMaxGenes = new Map<string, number>();
    const geneAnalysisCache = new Map<string, GeneAnalysisResult>();
    let totalGenesCount = 0;

    // SINGLE PASS: Analyze genes, collect blocks, and update stats - all at once!
    Object.values(parsedGenes).forEach((chromosomeData) => {
      // Count genes per block for this chromosome
      const thisChromosomeBlockCount = new Map<string, number>();

      chromosomeData.allGenes.forEach((gene) => {
        allBlocks.add(gene.block);
        totalGenesCount++;

        // Track genes per block for this chromosome
        const currentCount = thisChromosomeBlockCount.get(gene.block) || 0;
        thisChromosomeBlockCount.set(gene.block, currentCount + 1);

        // Pre-compute and cache gene analysis once
        const cacheKey = `${gene.id}_${gene.type}`;
        if (!geneAnalysisCache.has(cacheKey)) {
          const geneAnalysis = analyzeGeneEffect(speciesKey, gene.id, gene.type);

          // Handle potential effects in the same pass
          let effectType = geneAnalysis.type;
          if (geneAnalysis.type === 'neutral' && hasAnyPotentialEffect(speciesKey, gene.id)) {
            const potentialType = analyzePotentialEffectType(speciesKey, gene.id);
            if (potentialType) {
              effectType = potentialType;
            }
          }

          const processedAnalysis = {
            ...geneAnalysis,
            type: effectType,
          };

          geneAnalysisCache.set(cacheKey, processedAnalysis);
          accumulateStats(allStats, processedAnalysis, gene.type, currentView as 'attribute' | 'appearance');
        }
      });

      // Update global max for each block based on this chromosome
      thisChromosomeBlockCount.forEach((count, block) => {
        const currentMax = blockMaxGenes.get(block) || 0;
        blockMaxGenes.set(block, Math.max(currentMax, count));
      });
    });

    if (import.meta.env.DEV) console.timeEnd('📊 Single-pass gene analysis');

    // Calculate potential DOM elements to be rendered
    const chromosomeCount = Object.keys(parsedGenes).length;
    let totalDOMElements = 0;
    blockMaxGenes.forEach((maxGenes) => {
      totalDOMElements += chromosomeCount * maxGenes;
    });
    if (import.meta.env.DEV) {
      console.warn(
        `⚠️ About to render ${totalDOMElements} DOM elements (${chromosomeCount} chromosomes × blocks × genes)`,
      );
      if (totalDOMElements > 5000) {
        console.warn('🚨 This will likely cause DOM rendering delays!');
      }
    }

    currentStats = allStats;
    const inactiveRaw = allStats['inactive-breed'];
    const inactiveCount = typeof inactiveRaw === 'number' ? inactiveRaw : 0;
    totalGenes = totalGenesCount - inactiveCount;

    if (currentView === 'attribute') {
      neutralGenes = typeof allStats.neutral === 'number' ? allStats.neutral : 0;
    } else {
      neutralGenes = typeof allStats['appearance-neutral'] === 'number' ? allStats['appearance-neutral'] : 0;
    }

    onStatsUpdated?.();

    const sortedBlocks = Array.from(allBlocks).sort((a, b) => {
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      return numA - numB;
    });

    const sortedChromosomes = Object.entries(parsedGenes).sort(([a], [b]) => {
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      return numA - numB;
    });

    const newHeaderStructure: HeaderStructure = {
      sortedBlocks,
      blockMaxGenes,
    };
    headerStructure = newHeaderStructure;

    // Create or reuse species template
    currentSpeciesTemplate = getOrCreateSpeciesTemplate(pet.species, newHeaderStructure, chromosomeCount);

    // Build chromosome data using cached analysis
    const buildTime = isUsingCachedTemplate ? '🔄 Updating chromosome data' : '🏗️ Building chromosome data';
    if (import.meta.env.DEV) console.time(buildTime);

    // Lift component filter state + effect helpers into the pure predicate's inputs.
    const filterState: GeneFilterState = {
      selectedChromosomes,
      hiddenChromosomes,
      selectedAttributes,
      hiddenAttributes,
      currentEffectFilter,
      hiddenEffectFilters,
      currentValueFilter,
      hiddenValueFilters,
      currentView: currentView as 'attribute' | 'appearance',
    };
    const effectLookup: GeneEffectLookup = {
      affectsSelectedAttributes: (geneId, selected) =>
        genePotentiallyAffectsSelectedAttributes(speciesKey, geneId, selected),
      hasAnyPotentialEffect: (geneId) => hasAnyPotentialEffect(speciesKey, geneId),
      potentialEffectType: (geneId) => analyzePotentialEffectType(speciesKey, geneId),
    };

    chromosomeData = sortedChromosomes.map(([chromosome, data]) => {
      const processedBlocks: Record<string, (ProcessedGene | null)[]> = {};

      // Pre-group genes by block for efficiency
      const genesByBlock = new Map<string, ParsedGene[]>();
      data.allGenes.forEach((gene) => {
        if (!genesByBlock.has(gene.block)) {
          genesByBlock.set(gene.block, []);
        }
        (genesByBlock.get(gene.block) ?? []).push(gene);
      });

      sortedBlocks.forEach((block) => {
        const genesInBlock = genesByBlock.get(block) || [];
        processedBlocks[block] = [];

        for (let i = 0; i < (blockMaxGenes.get(block) || 0); i++) {
          const gene = genesInBlock[i];
          if (gene) {
            const cacheKey = `${gene.id}_${gene.type}`;
            const geneAnalysis = geneAnalysisCache.get(cacheKey) ?? { type: 'neutral', attribute: null, effect: '' };
            const displayAnalysis = getContextualAnalysis(pet.species, gene.id, geneAnalysis);

            processedBlocks[block][i] = {
              ...gene,
              geneAnalysis: displayAnalysis,
              isVisible: isGeneVisible(chromosome, gene, geneAnalysis, filterState, effectLookup),
            };
          } else {
            processedBlocks[block][i] = null;
          }
        }
      });

      return {
        chromosome,
        data,
        processedBlocks,
      };
    });
    if (import.meta.env.DEV) console.timeEnd(buildTime);

    if (import.meta.env.DEV) console.timeEnd('🚀 Gene Visualization Processing');
  } catch (err: unknown) {
    console.error('Error in createGeneVisualization:', err);
    error = `Failed to create gene visualization: ${err instanceof Error ? err.message : String(err)}`;
    headerStructure = null;
    chromosomeData = [];
  }
}

function handleTooltipShow(
  event: CustomEvent<{ geneId: string; geneType: string; effect: string; event: { clientX: number; clientY: number } }>,
) {
  const detail = event.detail;
  const geneId = detail.geneId;
  const geneType = detail.geneType;

  const effectInfo = detail.effect;

  const potentialEffects: string[] = [];
  if (currentPet) {
    const sk = normalizeSpecies(currentPet.species);
    const dominantEffect = getGeneEffect(sk, geneId, 'D');
    const recessiveEffect = getGeneEffect(sk, geneId, 'R');

    if (geneType !== 'D' && !isNoEffect(dominantEffect)) {
      const isPositive = dominantEffect.includes('+');
      const isNegative = dominantEffect.includes('-');
      const color = isPositive ? EFFECT_COLORS.positive : isNegative ? EFFECT_COLORS.negative : '#666';
      potentialEffects.push(`If Dominant: <span style="color: ${color}">${dominantEffect}</span>`);
    }

    if (geneType !== 'R' && !isNoEffect(recessiveEffect)) {
      const isPositive = recessiveEffect.includes('+');
      const isNegative = recessiveEffect.includes('-');
      const color = isPositive ? EFFECT_COLORS.positive : isNegative ? EFFECT_COLORS.negative : '#666';
      potentialEffects.push(`If Recessive: <span style="color: ${color}">${recessiveEffect}</span>`);
    }
  }

  // Add breed relevance note if gene belongs to a different breed
  const sk = normalizeSpecies(currentPet?.species || '');
  const geneBreed = getGeneBreed(sk, geneId);
  const isRelevant = isGeneRelevantToBreed(sk, geneId);
  if (!isRelevant && geneBreed) {
    potentialEffects.push(`<span style="color: #9ca3af">⚬ ${geneBreed} breed only — no effect on this pet</span>`);
  }

  const mouseEvent = detail.event;

  // Calculate smart positioning to stay close to mouse cursor while avoiding edge cropping
  const tooltipWidth = 250; // max-width from CSS
  // Calculate actual height based on content
  const baseHeight = 45; // base height for gene ID and type
  const effectHeight = 20; // height per effect line
  const potentialEffectHeight = 15; // height per potential effect
  const tooltipHeight =
    baseHeight + (!isNoEffect(effectInfo) ? effectHeight : 0) + potentialEffects.length * potentialEffectHeight;
  const offset = 12; // Small offset from cursor

  // Get viewport dimensions
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Use viewport (fixed) coordinates — avoids all scroll offset issues
  let x = mouseEvent.clientX + offset;
  let y = mouseEvent.clientY + offset;

  // Keep tooltip within viewport
  if (x + tooltipWidth > viewportWidth) {
    x = mouseEvent.clientX - tooltipWidth - offset;
  }
  if (y + tooltipHeight > viewportHeight) {
    y = mouseEvent.clientY - tooltipHeight - offset;
  }
  if (y < 0) {
    y = mouseEvent.clientY + offset;
  }
  if (x < 0) {
    x = mouseEvent.clientX + offset;
  }

  tooltipX = x;
  tooltipY = y;

  tooltipGeneId = geneId;
  tooltipGeneType = geneType;
  tooltipEffect = effectInfo;
  tooltipPotentialEffects = potentialEffects;
  tooltipVisible = true;
}

function handleTooltipHide() {
  tooltipVisible = false;
}

function handleGridKeydown(e: KeyboardEvent) {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;

  const container = e.currentTarget as HTMLElement;
  const cells = Array.from(container.querySelectorAll<HTMLElement>('.gene-cell[role="button"]'));
  const activeCell = document.activeElement?.closest('.gene-cell') as HTMLElement | null;
  const current = activeCell ? cells.indexOf(activeCell) : -1;
  if (current < 0) return;

  const row = activeCell?.closest('tr');
  const cols = row ? row.querySelectorAll('.gene-cell[role="button"]').length : 1;
  handleGridNavigation(cells, current, e, cols);
}

export function handleAttributeFilter(event: CustomEvent<{ attribute: string; ctrlKey: boolean; altKey: boolean }>) {
  const { attribute, ctrlKey, altKey } = event.detail;
  const result = resolveFilterClick(selectedAttributes, hiddenAttributes, attribute, ctrlKey, altKey);
  selectedAttributes = result.selected;
  hiddenAttributes = result.hidden;
  updateVisualization();
}

function toggleChromosomeFilter(chromosome: string, ctrlKey = false, altKey = false) {
  if (altKey) {
    const index = hiddenChromosomes.indexOf(chromosome);
    if (index === -1) {
      hiddenChromosomes = [...hiddenChromosomes, chromosome];
    } else {
      hiddenChromosomes = hiddenChromosomes.filter((c) => c !== chromosome);
    }
  } else if (ctrlKey) {
    const index = selectedChromosomes.indexOf(chromosome);
    if (index === -1) {
      selectedChromosomes = [...selectedChromosomes, chromosome];
    } else {
      selectedChromosomes = selectedChromosomes.filter((c) => c !== chromosome);
    }
  } else {
    if (selectedChromosomes.length === 1 && selectedChromosomes[0] === chromosome) {
      selectedChromosomes = [];
    } else {
      selectedChromosomes = [chromosome];
    }
  }
  updateVisualization();
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
  updateVisualization();
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
  updateVisualization();
}

function handleAppearanceFilter(appearanceType: string, isCtrlClick = false, isAltClick = false) {
  let attributeGroups: string[] = [];
  switch (appearanceType) {
    // BeeWasp appearance categories
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

    // Horse appearance categories
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

    // BeeWasp scale categories (keeping for compatibility)
    case 'body-scale':
    case 'wing-scale':
    case 'head-scale':
    case 'tail-scale':
    case 'antenna-scale':
      attributeGroups = ['body-scale', 'wing-scale', 'head-scale', 'tail-scale', 'antenna-scale'];
      break;
  }

  attributeGroups.forEach((attr) => {
    if (isAltClick) {
      const index = hiddenAttributes.indexOf(attr);
      if (index === -1) {
        hiddenAttributes = [...hiddenAttributes, attr];
      } else {
        hiddenAttributes = hiddenAttributes.filter((a) => a !== attr);
      }
    } else if (isCtrlClick) {
      const index = selectedAttributes.indexOf(attr);
      if (index === -1) {
        selectedAttributes = [...selectedAttributes, attr];
      } else {
        selectedAttributes = selectedAttributes.filter((a) => a !== attr);
      }
    } else {
      const allSelected = attributeGroups.every((a) => selectedAttributes.includes(a));
      if (allSelected) {
        selectedAttributes = selectedAttributes.filter((a) => !attributeGroups.includes(a));
      } else {
        const newSelected = [...selectedAttributes];
        attributeGroups.forEach((a) => {
          if (!newSelected.includes(a)) {
            newSelected.push(a);
          }
        });
        selectedAttributes = newSelected;
      }
    }
  });
  updateVisualization();
}

// Track the last processed pet ID to prevent loops
let lastProcessedPetId = $state<number | null>(null);

// Use $effect for pet change detection
$effect(() => {
  if (pet && pet.id !== lastProcessedPetId && !loading) {
    lastProcessedPetId = pet.id;
    loadPetData();
  } else if (!pet && lastProcessedPetId !== null) {
    lastProcessedPetId = null;
    cleanup();
  }
});

// Export functions for parent component
export function handleViewChange(view: string) {
  currentView = view;
  updateVisualization();
}

export function setBreedFilter(breed: string) {
  currentBreedFilter = breed;
  updateVisualization();
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
</script>

<div class="gene-visualizer" bind:this={containerElement}>
    {#if loading}
        <div class="visualizer-state"><StatusPane variant="loading" body="Loading gene data..." /></div>
    {:else if error}
        <div class="visualizer-state"><StatusPane variant="error" body={`Error: ${error}`} /></div>
    {:else if !currentPet}
        <div class="visualizer-state"><StatusPane variant="empty" body="Select a pet to visualize its genes" /></div>
    {:else}
        <div class="visualizer-content">
            <div class="gene-section">
                <!-- Legend -->
                <div class="gene-legend">
                    <div class="legend-items">
                        {#if currentView === "attribute"}
                            <div class="legend-row">
                                <span class="legend-label legend-label-effect"
                                    >Effect:</span
                                >

                                <span
                                    class="legend-item effect-legend-item {currentEffectFilter.includes(
                                        'positive',
                                    )
                                        ? 'selected'
                                        : ''} {hiddenEffectFilters.includes(
                                        'positive',
                                    )
                                        ? 'hidden-effect'
                                        : ''}"
                                    role="button"
                                    tabindex="0"
                                    onclick={(e) =>
                                        handleLegendFilterClick("positive", e)}
                                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLegendFilterClick("positive", e); }}
                                >
                                    <GeneCell
                                        gene={{ id: "sample", type: "D" }}
                                        geneAnalysis={{
                                            type: "positive",
                                            attribute: null,
                                        }}
                                        currentView="attribute"
                                        isVisible={true}
                                    />
                                    <span>Positive</span>
                                </span>

                                <span
                                    class="legend-item effect-legend-item {currentEffectFilter.includes(
                                        'potential-positive',
                                    )
                                        ? 'selected'
                                        : ''} {hiddenEffectFilters.includes(
                                        'potential-positive',
                                    )
                                        ? 'hidden-effect'
                                        : ''}"
                                    role="button"
                                    tabindex="0"
                                    onclick={(e) =>
                                        handleLegendFilterClick(
                                            "potential-positive",
                                            e,
                                        )}
                                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLegendFilterClick("potential-positive", e); }}
                                >
                                    <GeneCell
                                        gene={{ id: "sample", type: "D" }}
                                        geneAnalysis={{
                                            type: "potential-positive",
                                            attribute: null,
                                        }}
                                        currentView="attribute"
                                        isVisible={true}
                                    />
                                    <span>Potential Positive</span>
                                </span>

                                <span
                                    class="legend-item effect-legend-item {currentEffectFilter.includes(
                                        'neutral',
                                    )
                                        ? 'selected'
                                        : ''} {hiddenEffectFilters.includes(
                                        'neutral',
                                    )
                                        ? 'hidden-effect'
                                        : ''}"
                                    role="button"
                                    tabindex="0"
                                    onclick={(e) =>
                                        handleLegendFilterClick("neutral", e)}
                                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLegendFilterClick("neutral", e); }}
                                >
                                    <GeneCell
                                        gene={{ id: "sample", type: "D" }}
                                        geneAnalysis={{
                                            type: "neutral",
                                            attribute: null,
                                        }}
                                        currentView="attribute"
                                        isVisible={true}
                                    />
                                    <span>Neutral</span>
                                </span>

                                <span
                                    class="legend-item effect-legend-item {currentEffectFilter.includes(
                                        'potential-negative',
                                    )
                                        ? 'selected'
                                        : ''} {hiddenEffectFilters.includes(
                                        'potential-negative',
                                    )
                                        ? 'hidden-effect'
                                        : ''}"
                                    role="button"
                                    tabindex="0"
                                    onclick={(e) =>
                                        handleLegendFilterClick(
                                            "potential-negative",
                                            e,
                                        )}
                                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLegendFilterClick("potential-negative", e); }}
                                >
                                    <GeneCell
                                        gene={{ id: "sample", type: "D" }}
                                        geneAnalysis={{
                                            type: "potential-negative",
                                            attribute: null,
                                        }}
                                        currentView="attribute"
                                        isVisible={true}
                                    />
                                    <span>Potential Negative</span>
                                </span>

                                <span
                                    class="legend-item effect-legend-item {currentEffectFilter.includes(
                                        'negative',
                                    )
                                        ? 'selected'
                                        : ''} {hiddenEffectFilters.includes(
                                        'negative',
                                    )
                                        ? 'hidden-effect'
                                        : ''}"
                                    role="button"
                                    tabindex="0"
                                    onclick={(e) =>
                                        handleLegendFilterClick("negative", e)}
                                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLegendFilterClick("negative", e); }}
                                >
                                    <GeneCell
                                        gene={{ id: "sample", type: "D" }}
                                        geneAnalysis={{
                                            type: "negative",
                                            attribute: null,
                                        }}
                                        currentView="attribute"
                                        isVisible={true}
                                    />
                                    <span>Negative</span>
                                </span>
                                <span class="legend-label legend-label-value"
                                    >Value:</span
                                >

                                <span
                                    class="legend-item value-legend-item {currentValueFilter.includes(
                                        'gene-dominant',
                                    )
                                        ? 'selected'
                                        : ''} {hiddenValueFilters.includes(
                                        'gene-dominant',
                                    )
                                        ? 'hidden-effect'
                                        : ''}"
                                    role="button"
                                    tabindex="0"
                                    onclick={(e) =>
                                        handleLegendFilterClick("dominant", e)}
                                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLegendFilterClick("dominant", e); }}
                                >
                                    <GeneCell
                                        gene={{ id: "sample", type: "D" }}
                                        geneAnalysis={{
                                            type: "neutral",
                                            attribute: null,
                                        }}
                                        currentView="attribute"
                                        isVisible={true}
                                    />
                                    <span>Dominant</span>
                                </span>

                                <span
                                    class="legend-item value-legend-item {currentValueFilter.includes(
                                        'gene-recessive',
                                    )
                                        ? 'selected'
                                        : ''} {hiddenValueFilters.includes(
                                        'gene-recessive',
                                    )
                                        ? 'hidden-effect'
                                        : ''}"
                                    role="button"
                                    tabindex="0"
                                    onclick={(e) =>
                                        handleLegendFilterClick("recessive", e)}
                                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLegendFilterClick("recessive", e); }}
                                >
                                    <GeneCell
                                        gene={{ id: "sample", type: "R" }}
                                        geneAnalysis={{
                                            type: "neutral",
                                            attribute: null,
                                        }}
                                        currentView="attribute"
                                        isVisible={true}
                                    />
                                    <span>Recessive</span>
                                </span>

                                <span
                                    class="legend-item value-legend-item {currentValueFilter.includes(
                                        'gene-mixed',
                                    )
                                        ? 'selected'
                                        : ''} {hiddenValueFilters.includes(
                                        'gene-mixed',
                                    )
                                        ? 'hidden-effect'
                                        : ''}"
                                    role="button"
                                    tabindex="0"
                                    onclick={(e) =>
                                        handleLegendFilterClick("mixed", e)}
                                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLegendFilterClick("mixed", e); }}
                                >
                                    <GeneCell
                                        gene={{ id: "sample", type: "x" }}
                                        geneAnalysis={{
                                            type: "neutral",
                                            attribute: null,
                                        }}
                                        currentView="attribute"
                                        isVisible={true}
                                    />
                                    <span>Mixed</span>
                                </span>

                                <span
                                    class="legend-item value-legend-item {currentValueFilter.includes(
                                        'gene-unknown',
                                    )
                                        ? 'selected'
                                        : ''} {hiddenValueFilters.includes(
                                        'gene-unknown',
                                    )
                                        ? 'hidden-effect'
                                        : ''}"
                                    role="button"
                                    tabindex="0"
                                    onclick={(e) =>
                                        handleLegendFilterClick("unknown", e)}
                                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLegendFilterClick("unknown", e); }}
                                >
                                    <GeneCell
                                        gene={{ id: "sample", type: "?" }}
                                        geneAnalysis={{
                                            type: "neutral",
                                            attribute: null,
                                        }}
                                        currentView="attribute"
                                        isVisible={true}
                                    />
                                    <span>Unknown</span>
                                </span>
                            </div>
                        {:else}
                            <div class="legend-row">
                                <span
                                    class="legend-label legend-label-appearance"
                                    >Appearance:</span
                                >

                                {#each appearanceList as appearance (appearance.key)}
                                    {@const attrKey = appearance.key.replace(
                                        /_/g,
                                        "-",
                                    )}
                                    <span
                                        class="legend-item appearance-legend-item {selectedAttributes.includes(
                                            attrKey,
                                        )
                                            ? 'selected'
                                            : ''} {hiddenAttributes.includes(
                                            attrKey,
                                        )
                                            ? 'hidden-effect'
                                            : ''}"
                                        role="button"
                                        tabindex="0"
                                        onclick={(e) =>
                                            handleLegendFilterClick(attrKey, e)}
                                        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLegendFilterClick(attrKey, e); }}
                                    >
                                        <GeneCell
                                            gene={{ id: "sample", type: "D" }}
                                            geneAnalysis={{
                                                type: attrKey,
                                                attribute: attrKey,
                                            }}
                                            currentView="appearance"
                                            isVisible={true}
                                        />
                                        <span>{appearance.name}</span>
                                    </span>
                                {/each}
                            </div>
                        {/if}
                    </div>
                </div>

                <!-- Gene Grid -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                    class="gene-grid-container"
                    bind:this={gridContainerEl}
                    style="--cell-size: {cellSize}px"
                    onkeydown={handleGridKeydown}
                >
                    {#if headerStructure && chromosomeData.length > 0}
                        <!-- Optimized dynamic rendering -->
                        {#key currentSpeciesTemplate ? currentSpeciesTemplate.species + "_" + currentSpeciesTemplate.chromosomeCount + "_" + currentSpeciesTemplate.blockCount : "initial"}
                            <table class="gene-grid-table">
                                <thead class="gene-headers">
                                    <tr>
                                        <th class="chromosome-header">Chr</th>
                                        {#each headerStructure.sortedBlocks as block (block)}
                                            {#each Array.from({ length: headerStructure.blockMaxGenes.get(block) ?? 0 }, (_, i) => i) as i (i)}
                                                <th
                                                    class="position-header {i ===
                                                    0
                                                        ? 'block-label block-start'
                                                        : ''}"
                                                >
                                                    {i === 0 ? block : ""}
                                                </th>
                                            {/each}
                                        {/each}
                                    </tr>
                                </thead>
                                <tbody class="gene-rows">
                                    {#each chromosomeData as { chromosome, processedBlocks } (chromosome)}
                                        {@const hasMatchingGenes = !currentBreedFilter || chromosomeHasBreed(chromosome, currentBreedFilter)}
                                        {#if hasMatchingGenes}
                                        <tr class="chromosome-row">
                                            <td
                                                class="chromosome-label {selectedChromosomes.includes(
                                                    chromosome,
                                                )
                                                    ? 'selected'
                                                    : ''} {hiddenChromosomes.includes(
                                                    chromosome,
                                                )
                                                    ? 'hidden-chromosome'
                                                    : ''}"
                                                data-chromosome={chromosome}
                                                onclick={(e) =>
                                                    toggleChromosomeFilter(
                                                        chromosome,
                                                        e.ctrlKey || e.metaKey,
                                                        e.altKey,
                                                    )}
                                            >
                                                {chromosome}
                                            </td>
                                            {#each headerStructure.sortedBlocks as block (block)}
                                                {#each Array.from({ length: headerStructure.blockMaxGenes.get(block) ?? 0 }, (_, i) => i) as i (i)}
                                                    {@const gene =
                                                        processedBlocks?.[
                                                            block
                                                        ]?.[i] || null}
                                                    <td
                                                        class="gene-cell-container {i ===
                                                        0
                                                            ? 'block-start'
                                                            : ''} {!gene
                                                            ? 'empty'
                                                            : ''}"
                                                    >
                                                        {#if gene}
                                                            <GeneCell
                                                                {gene}
                                                                {chromosome}
                                                                geneAnalysis={gene.geneAnalysis}
                                                                {currentView}
                                                                isVisible={gene.isVisible}
                                                                on:tooltip-show={handleTooltipShow}
                                                                on:tooltip-hide={handleTooltipHide}
                                                            />
                                                        {/if}
                                                    </td>
                                                {/each}
                                            {/each}
                                        </tr>
                                        {/if}
                                    {/each}
                                </tbody>
                            </table>
                        {/key}
                    {/if}
                </div>
            </div>
        </div>
    {/if}

    <!-- Tooltip using existing component -->
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
    /* Gene colors defined as --gene-* CSS vars in :root in src/app.css */

    /* Fills the visualizer column and centres the shared StatusPane vertically
       (the states previously occupied a fixed 300px centred box). */
    .visualizer-state {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .gene-visualizer {
        height: 100%;
        display: flex;
        flex-direction: column;
        background: var(--bg-primary);
        min-height: 0;
    }

    .gene-visualizer {
        display: flex;
        flex-direction: column;
        height: 100%;
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

    /* Adjust legend item spacing for GeneCell components */
    .legend-item :global(.gene-cell) {
        margin: 0 4px 0 0;
    }

    /* Legend selection states */
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
        padding-left: 8px;
    }

    .gene-cell-container.block-start:first-of-type {
        padding-left: 1px;
    }

</style>
