/**
 * Shared gene-cell construction for the genome grids.
 *
 * Both the 2-pet genome diff (`GenomeGridDiff`) and the trio view
 * (`GenomeGridTrio`) render the same gene cells — a pre-computed CSS
 * class per cell for the attribute and appearance views, plus the
 * resolved attribute / appearance / breed / effect metadata. This module
 * holds that logic once so the grids stay in lock-step.
 *
 * Pure: no Svelte, no DB, no I/O beyond the synchronous config lookup in
 * `buildAppearanceLookup`. The per-gene work is parameterised on a
 * `GeneCellContext` (the loaded effect catalog and species shape) built
 * once per genome load.
 */

import { getAppearanceAttributes } from '$lib/services/configService.js';
import { breedFor, effectFor, type GeneEffectData, isNoEffect } from '$lib/utils/geneAnalysis.js';

/** The loaded per-species state every cell computation reads from. */
export interface GeneCellContext {
  /** `gene_id → effect record`, from `getGeneEffectsCached(species).effects`. */
  effectsDB: Record<string, GeneEffectData>;
  /** Capitalised attribute names for this species (used to tag a cell's attribute). */
  attributeNames: string[];
  /** `appearance name (lowercased) → appearance key`, from `buildAppearanceLookup`. */
  appearanceLookup: Map<string, string>;
  /** Canonical species key (`'horse'` enables prefix matching for appearance). */
  speciesKey: string;
}

/** A single gene's analysed effect. */
export interface GeneAnalysis {
  effectType: string;
  attribute: string | null;
  effect: string;
  breed: string;
}

/** A rendered grid cell with pre-computed CSS classes for both views. */
export interface GeneCell {
  id: string;
  type: string;
  attributeCls: string;
  appearanceCls: string;
  attribute: string;
  appearance: string;
  breed: string;
  effect: string;
}

/** Smallest / largest / fallback gene-cell edge (px) for the responsive grid. */
export const GENE_CELL_MIN = 12;
export const GENE_CELL_MAX = 34;
export const GENE_CELL_DEFAULT = 16;

/**
 * Fixed chromosome-label column width and per-block left padding (px).
 *
 * KEEP IN SYNC with GeneVisualizer.svelte CSS: `.chromosome-label` /
 * `.chromosome-header` width (CHR_COL_WIDTH) and `.gene-cell-container.block-start`
 * padding-left (BLOCK_GAP). If those change, this width budget under- or
 * over-estimates and reintroduces dead space or a horizontal scrollbar.
 */
const CHR_COL_WIDTH = 28;
const BLOCK_GAP = 8;

/**
 * Compute the gene-cell edge (px) so the fixed-cell genome grid fills the
 * width of its container instead of leaving a dead zone (wide window) or
 * overflowing with a scrollbar (narrow window / stats drawer open).
 *
 * The width budget reserves the chromosome-label column, the per-block left
 * padding, and a small rounding margin. The result is clamped to
 * [GENE_CELL_MIN, GENE_CELL_MAX] for readability, and falls back to
 * GENE_CELL_DEFAULT before the container has been measured.
 */
export function computeGeneCellSize({
  containerWidth,
  totalColumns,
  blockCount,
}: {
  containerWidth: number;
  totalColumns: number;
  blockCount: number;
}): number {
  if (!containerWidth || totalColumns <= 0) return GENE_CELL_DEFAULT;
  const available = containerWidth - CHR_COL_WIDTH - blockCount * BLOCK_GAP - 4;
  const raw = Math.floor(available / totalColumns);
  return Math.max(GENE_CELL_MIN, Math.min(GENE_CELL_MAX, raw));
}

/** Build the `appearance name → key` lookup for a species. */
export function buildAppearanceLookup(species: string): Map<string, string> {
  const attrs = getAppearanceAttributes(species);
  const byName = new Map<string, string>();
  for (const [key, info] of Object.entries(attrs) as [string, { name: string }][]) {
    byName.set(info.name.toLowerCase(), key);
  }
  return byName;
}

/**
 * Create the cell builders bound to a single loaded genome context. The
 * returned `makeCell` is the hot-path helper the grids call once per
 * locus; `analyzeGene` and `categorizeAppearance` are exposed for callers
 * that need the raw analysis (e.g. tooltips, the trio classifier display).
 */
export function createGeneCellBuilder(ctx: GeneCellContext) {
  function analyzeGene(geneId: string, geneType: string): GeneAnalysis {
    const geneData = ctx.effectsDB[geneId];
    const effect = effectFor(geneData, geneType);
    const breed = breedFor(geneData);

    if (isNoEffect(effect)) return { effectType: 'neutral', attribute: null, effect, breed };

    const effectStr = effect || '';
    let attribute: string | null = null;
    for (const attrName of ctx.attributeNames) {
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

  function categorizeAppearance(geneId: string): string {
    const raw = ctx.effectsDB[geneId]?.appearance;
    if (!raw || raw === 'None' || raw.includes('String for me to fill')) return '';
    const lower = raw.toLowerCase();
    const matcher =
      ctx.speciesKey === 'horse' ? (name: string) => lower.startsWith(name) : (name: string) => lower.includes(name);
    for (const [name, key] of ctx.appearanceLookup) {
      if (matcher(name)) return key;
    }
    return '';
  }

  /** Build a cell object with pre-computed static CSS class strings for both views. */
  function makeCell(gene: { id: string; type: string }): GeneCell {
    const analysis = analyzeGene(gene.id, gene.type);
    const appearance = categorizeAppearance(gene.id);

    let zygosity: string;
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

  return { makeCell, analyzeGene, categorizeAppearance };
}
