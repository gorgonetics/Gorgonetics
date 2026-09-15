/**
 * Render-model builder for the trio (Father / Offspring / Mother) genome grid.
 *
 * Turns the `OffspringTrioResult` from `offspringTrioService` into a
 * block/position grid layout plus, per locus, the two parent cells (built
 * with the shared `geneGridCells` factory) and the offspring's outcome
 * buckets for the middle row.
 *
 * Pure: no Svelte, no DB. The component owns loading and the DOM; this owns
 * the shape so it can be unit-tested without rendering.
 */

import { compareBlockLetters } from '$lib/services/genomeParser.js';
import type {
  GeneType,
  OffspringOutcomeBuckets,
  OffspringTrioResult,
  TrioContributionMode,
  TrioGainMode,
  TrioLocusContributions,
  TrioVerdict,
} from '$lib/types/index.js';
import { joinAttrs } from '$lib/utils/filterCSS.js';
import type { GeneCell } from '$lib/utils/geneGridCells.js';

/** A fully-resolved locus ready to render across the three rows. */
export interface TrioLocusCell {
  geneId: string;
  block: string;
  position: number;
  fatherType: GeneType | null;
  motherType: GeneType | null;
  fatherCell: GeneCell | null;
  motherCell: GeneCell | null;
  /** Offspring outcome split vs the parents; drives the middle-row box. */
  buckets: OffspringOutcomeBuckets;
  /** This locus's share of each additive pair score; drives the contribution lens. */
  contributions: TrioLocusContributions;
  verdict: TrioVerdict;
  source: 'father' | 'mother' | 'both' | null;
  lockedIn: boolean;
  attribute?: string;
  /**
   * Delimited (`·Attr·Attr·`) set of attributes the locus gene can affect via
   * *either* allele — drives the attribute focus filter across all three rows
   * (see `attributePotentialFilterCSS`). Empty string when the gene has no
   * attribute effect, so it dims under an active selection.
   */
  attrs: string;
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
  attributesForGene(geneId: string): string[];
}

const HATCH =
  'repeating-linear-gradient(45deg, color-mix(in srgb, var(--gene-neutral) 60%, transparent) 0 2px, transparent 2px 4px)';

/**
 * CSS `background` for one offspring outcome box — a single hard-stop
 * `linear-gradient` (no gaps) stacking the buckets top→bottom: gain, keep,
 * neutral, keep-negative, loss. `mode` picks which positive-change bucket is
 * the vivid gain; the other collapses into the muted "keep" green. A
 * fully-unknown locus renders the diagonal hatch instead.
 */
export function outcomeBoxBackground(b: OffspringOutcomeBuckets, mode: TrioGainMode): string {
  if (b.unknown >= 1) return HATCH;
  const activeGain = mode === 'attributes' ? b.newPositive : b.clarifiedPositive;
  const mutedGreen = (mode === 'attributes' ? b.clarifiedPositive : b.newPositive) + b.keepPositive;
  const segments: [number, string][] = [
    [activeGain, 'var(--trio-gain)'],
    [mutedGreen, 'var(--trio-keep-pos)'],
    [b.neutral, 'var(--trio-neutral)'],
    [b.keepNegative, 'var(--trio-keep-neg)'],
    [b.loss, 'var(--trio-loss)'],
  ];
  const stops: string[] = [];
  let acc = 0;
  for (const [mass, color] of segments) {
    if (mass <= 0) continue;
    const start = acc * 100;
    acc += mass;
    stops.push(`${color} ${start.toFixed(2)}% ${(acc * 100).toFixed(2)}%`);
  }
  if (stops.length === 0) return 'var(--trio-neutral)';
  return `linear-gradient(180deg, ${stops.join(', ')})`;
}

/**
 * Identity of a candidate pool: which animals are in it, not which array
 * carries them.
 *
 * The pool reaches the trio as a `$derived` filter over the pets store, so it
 * is a fresh array on every emission — a background reload, an unrelated
 * marker toggle, a community import. Keying the projection on the array itself
 * rebuilds it for each of those, discarding the scroll position and the
 * player's attribute focus for a set that never changed. Sorted so a reordered
 * emission of the same animals is recognised as the same pool.
 */
export function poolIdentity(pets: readonly { id: number }[] | undefined): string {
  if (!pets || pets.length === 0) return '';
  return pets
    .map((p) => p.id)
    .sort((a, b) => a - b)
    .join(',');
}

/**
 * This locus's contribution under `mode`, or 0 when the lens is off.
 *
 * Every lens name is also the field it reads — `TrioContributionMode` minus
 * `off` is exactly `keyof TrioLocusContributions` — so the mode indexes the
 * record directly. A rename on either side is then a compile error rather than
 * a silently stale mapping.
 */
export function contributionOf(c: TrioLocusContributions, mode: TrioContributionMode): number {
  return mode === 'off' ? 0 : c[mode];
}

/**
 * CSS `background` for an offspring cell under the contribution lens: one
 * flat tint whose intensity is this locus's share of the pair's score.
 *
 * **Square-root ramp, not linear.** A pair's score is spread over ~1,600
 * loci, so a linear ramp against the maximum leaves all but a handful of
 * cells at a few percent tint — visually identical to the zeroes, which is
 * the one thing the lens exists to distinguish. The root compresses the top
 * and opens up the tail. It is a display curve: read the tooltip for the
 * number, not the shade, and never compare two shades as a ratio.
 */
export function contributionBackground(value: number, max: number): string {
  if (!(value > 0) || !(max > 0)) return 'var(--trio-contrib-none)';
  const t = Math.min(1, Math.sqrt(value / max));
  // Floor at 8% so the smallest non-zero contribution still reads as present.
  const pct = (8 + t * 92).toFixed(1);
  return `color-mix(in srgb, var(--trio-contrib) ${pct}%, var(--trio-contrib-none))`;
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
      const attrList = cellBuilder.attributesForGene(g.geneId);
      cells[`${g.block}${g.position}`] = {
        geneId: g.geneId,
        attrs: joinAttrs(attrList),
        block: g.block,
        position: g.position,
        fatherType: g.fatherType,
        motherType: g.motherType,
        fatherCell: g.fatherType ? cellBuilder.makeCell({ id: g.geneId, type: g.fatherType }) : null,
        motherCell: g.motherType ? cellBuilder.makeCell({ id: g.geneId, type: g.motherType }) : null,
        buckets: g.buckets,
        contributions: g.contributions,
        verdict: g.verdict,
        source: g.source,
        lockedIn: g.lockedIn,
        attribute: g.attribute,
        fatherEffect: g.fatherEffect,
        motherEffect: g.motherEffect,
      };
    }
    return { chromosome: chr.chromosome, cells };
  });

  return { blocks, positionsByBlock, rows };
}
