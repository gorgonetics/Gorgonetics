/**
 * Grid structure for the Reference genome map (#368, design §7).
 *
 * The per-pet grid derives its shape from one pet's parsed genome. The map has
 * no pet: it shows **every locus a species has**, so its shape comes from the
 * gene template DB instead. That is the only structural difference — the
 * layout maths, cell sizing and injected-stylesheet colouring are shared.
 *
 * Pure: takes gene ids in, returns rows out. No DB, no Svelte.
 */

import { compareBlockLetters } from '$lib/services/genomeParser.js';
import { fromGeneId } from '$lib/utils/geneAnalysis.js';

export interface GenomeMapRow {
  chromosome: string;
  /** `[blockIndex][positionIndex]` → gene id, or null for a ragged block tail. */
  cells: (string | null)[][];
}

export interface GenomeMapGrid {
  /** Block letters in canonical order: A, B, …, Z, AA, AB, …. */
  sortedBlocks: string[];
  /** Widest occurrence of each block across all chromosomes. */
  blockMaxGenes: Map<string, number>;
  /** Column count the cell-size calculation needs. */
  totalColumns: number;
  rows: GenomeMapRow[];
}

const EMPTY: GenomeMapGrid = {
  sortedBlocks: [],
  blockMaxGenes: new Map(),
  totalColumns: 0,
  rows: [],
};

/**
 * Build the map's row/block shape from a species' gene ids.
 *
 * Blocks are ordered with `compareBlockLetters` (shorter first, lexicographic
 * within length) rather than the per-pet grid's `parseInt` comparator, which
 * yields `NaN` for letter blocks and only works because the source `Set`
 * happens to be built in order. Chromosomes sort numerically.
 *
 * Ids that do not parse are dropped, matching `groupLociByChromosome`.
 */
export function buildGenomeMapGrid(geneIds: Iterable<string>): GenomeMapGrid {
  const byChromosome = new Map<string, Map<string, string[]>>();
  const blockMaxGenes = new Map<string, number>();
  const allBlocks = new Set<string>();

  for (const id of geneIds) {
    const parsed = fromGeneId(id);
    if (!parsed) continue;
    let blocks = byChromosome.get(parsed.chromosome);
    if (!blocks) {
      blocks = new Map();
      byChromosome.set(parsed.chromosome, blocks);
    }
    let list = blocks.get(parsed.block);
    if (!list) {
      list = [];
      blocks.set(parsed.block, list);
    }
    list.push(id);
    allBlocks.add(parsed.block);
  }
  if (byChromosome.size === 0) return EMPTY;

  for (const blocks of byChromosome.values()) {
    for (const [block, ids] of blocks) {
      blockMaxGenes.set(block, Math.max(blockMaxGenes.get(block) ?? 0, ids.length));
    }
  }

  const sortedBlocks = [...allBlocks].sort(compareBlockLetters);
  let totalColumns = 0;
  for (const block of sortedBlocks) totalColumns += blockMaxGenes.get(block) ?? 0;

  const rows: GenomeMapRow[] = [...byChromosome.entries()]
    .sort(([a], [b]) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
    .map(([chromosome, blocks]) => ({
      chromosome,
      cells: sortedBlocks.map((block) => {
        // Positional order within a block, so a locus sits in the same column
        // on every row — the map is read down columns as much as across rows.
        const ids = [...(blocks.get(block) ?? [])].sort((x, y) => {
          const px = fromGeneId(x)?.position ?? 0;
          const py = fromGeneId(y)?.position ?? 0;
          return px - py;
        });
        const max = blockMaxGenes.get(block) ?? 0;
        return Array.from({ length: max }, (_, i) => ids[i] ?? null);
      }),
    }));

  return { sortedBlocks, blockMaxGenes, totalColumns, rows };
}
