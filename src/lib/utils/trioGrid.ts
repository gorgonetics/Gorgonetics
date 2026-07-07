/**
 * Render-model builder for the trio (Father / Offspring / Mother) genome grid.
 *
 * Turns the `OffspringTrioResult` from `offspringTrioService` into a
 * block/position grid layout plus, per locus, the two parent cells (built
 * with the shared `geneGridCells` factory) and the offspring's allele
 * distribution as coloured segments for the taller middle row.
 *
 * Pure: no Svelte, no DB. The component owns loading and the DOM; this owns
 * the shape so it can be unit-tested without rendering.
 */

import { compareBlockLetters } from '$lib/services/genomeParser.js';
import type { AlleleDistribution, GeneType, OffspringTrioResult, TrioVerdict } from '$lib/types/index.js';
import type { GeneCell } from '$lib/utils/geneGridCells.js';

/** Effect tone of an offspring allele outcome — drives the segment colour. */
export type TrioTone = 'positive' | 'negative' | 'potential-positive' | 'potential-negative' | 'neutral' | 'unknown';

/** One slice of the offspring distribution bar. */
export interface TrioSegment {
  allele: 'D' | 'x' | 'R' | 'unknown';
  /** Probability as a percentage (0–100) — the segment's flex width. */
  pct: number;
  tone: TrioTone;
}

/** A fully-resolved locus ready to render across the three rows. */
export interface TrioLocusCell {
  geneId: string;
  block: string;
  position: number;
  fatherType: GeneType | null;
  motherType: GeneType | null;
  fatherCell: GeneCell | null;
  motherCell: GeneCell | null;
  segments: TrioSegment[];
  verdict: TrioVerdict;
  source: 'father' | 'mother' | 'both' | null;
  lockedIn: boolean;
  attribute?: string;
  pPositive: number;
  pNegative: number;
  fatherEffect?: string;
  motherEffect?: string;
}

export interface TrioGridRow {
  chromosome: string;
  /** Keyed by `${block}${position}`. Absent key → empty grid cell. */
  cells: Record<string, TrioLocusCell>;
}

export interface TrioGrid {
  blocks: string[];
  /** 1-based positions present for each block, ascending. */
  positionsByBlock: Record<string, number[]>;
  rows: TrioGridRow[];
}

/** Minimal slice of the `geneGridCells` factory this module needs. */
interface CellBuilderLike {
  makeCell(gene: { id: string; type: string }): GeneCell;
  analyzeGene(geneId: string, geneType: string): { effectType: string };
}

const ALLELE_ORDER: readonly (keyof AlleleDistribution)[] = ['D', 'x', 'R', 'unknown'];

/** CSS colour variable each tone paints with (same vars the old `.tone-*` rules used). */
const TONE_VAR: Record<TrioTone, string> = {
  positive: 'var(--gene-positive)',
  negative: 'var(--gene-negative)',
  'potential-positive': 'var(--gene-potential-positive)',
  'potential-negative': 'var(--gene-potential-negative)',
  neutral: 'var(--gene-neutral)',
  unknown: 'var(--gene-neutral)',
};

/**
 * True when the bar is an all-unknown offspring. `offspringDistribution`
 * collapses any unknown parent to `{ unknown: 1 }`, so `unknown` is never
 * mixed with solid alleles — it is always the sole, full-width segment.
 */
export function isUnknownDist(segments: TrioSegment[]): boolean {
  return segments.length === 1 && segments[0].tone === 'unknown';
}

/**
 * CSS `background` for one offspring distribution bar — a single hard-stop
 * `linear-gradient` across the segments, replacing the per-segment `<span>`s.
 * Colours use the same `var(--gene-*)` references the old `.tone-*` classes
 * did, so themes and the grid's grayscale filter still apply. The all-unknown
 * case keeps the diagonal hatch (dimming is applied via a class on the bar).
 */
export function distBarBackground(segments: TrioSegment[]): string {
  if (isUnknownDist(segments)) {
    return 'repeating-linear-gradient(45deg, var(--gene-neutral) 0 2px, transparent 2px 4px)';
  }
  const stops: string[] = [];
  let acc = 0;
  for (const seg of segments) {
    const start = acc;
    acc += seg.pct;
    stops.push(`${TONE_VAR[seg.tone]} ${start}% ${acc}%`);
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

/** Effect-type strings that map to a defined `tone-*` style. */
const KNOWN_TONES = new Set<TrioTone>(['positive', 'negative', 'potential-positive', 'potential-negative', 'neutral']);

function toneFor(geneId: string, allele: keyof AlleleDistribution, cellBuilder: CellBuilderLike): TrioTone {
  if (allele === 'unknown') return 'unknown';
  // `D`/`x` express the dominant effect, `R` the recessive — `analyzeGene`
  // resolves the right one from the allele it's given. Normalise to the known
  // tone set so an unexpected/expanded effectType can't emit an undefined
  // `tone-*` class; `neutral` is the safe default for a known allele.
  const effectType = cellBuilder.analyzeGene(geneId, allele).effectType;
  return KNOWN_TONES.has(effectType as TrioTone) ? (effectType as TrioTone) : 'neutral';
}

function buildSegments(geneId: string, dist: AlleleDistribution, cellBuilder: CellBuilderLike): TrioSegment[] {
  const segments: TrioSegment[] = [];
  for (const allele of ALLELE_ORDER) {
    const mass = dist[allele];
    if (mass > 0) {
      segments.push({
        allele: allele as TrioSegment['allele'],
        pct: mass * 100,
        tone: toneFor(geneId, allele, cellBuilder),
      });
    }
  }
  return segments;
}

/**
 * Build the full grid render-model. Column layout (blocks × positions) is the
 * union across all chromosomes so every chromosome row aligns, matching the
 * 2-pet genome diff.
 */
export function buildTrioGrid(result: OffspringTrioResult, cellBuilder: CellBuilderLike): TrioGrid {
  const maxPosByBlock = new Map<string, number>();
  for (const chr of result.chromosomes) {
    for (const g of chr.genes) {
      maxPosByBlock.set(g.block, Math.max(maxPosByBlock.get(g.block) ?? 0, g.position));
    }
  }

  const blocks = [...maxPosByBlock.keys()].sort(compareBlockLetters);
  const positionsByBlock: Record<string, number[]> = {};
  for (const block of blocks) {
    const max = maxPosByBlock.get(block) ?? 0;
    positionsByBlock[block] = Array.from({ length: max }, (_, i) => i + 1);
  }

  const rows: TrioGridRow[] = result.chromosomes.map((chr) => {
    const cells: Record<string, TrioLocusCell> = {};
    for (const g of chr.genes) {
      cells[`${g.block}${g.position}`] = {
        geneId: g.geneId,
        block: g.block,
        position: g.position,
        fatherType: g.fatherType,
        motherType: g.motherType,
        fatherCell: g.fatherType ? cellBuilder.makeCell({ id: g.geneId, type: g.fatherType }) : null,
        motherCell: g.motherType ? cellBuilder.makeCell({ id: g.geneId, type: g.motherType }) : null,
        segments: buildSegments(g.geneId, g.dist, cellBuilder),
        verdict: g.verdict,
        source: g.source,
        lockedIn: g.lockedIn,
        attribute: g.attribute,
        pPositive: g.pPositive,
        pNegative: g.pNegative,
        fatherEffect: g.fatherEffect,
        motherEffect: g.motherEffect,
      };
    }
    return { chromosome: chr.chromosome, cells };
  });

  return { blocks, positionsByBlock, rows };
}
