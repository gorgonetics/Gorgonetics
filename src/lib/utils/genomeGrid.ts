/**
 * Build the visualizer's chromosome grid directly from raw genome text,
 * with no database round-trip.
 *
 * `loadPetGridFromDb` (petService) produces the same `ParsedChromosome`
 * shape from the persisted `pet_genes` rows for a *local* pet. Community
 * pets aren't in the local DB — the share catalogue hands us the raw
 * `[Overview]/[Genes]` text (`SharedPet.genomeData`) — so this helper
 * parses that text and assembles an equivalent grid the `GeneVisualizer`
 * can render via its `gridOverride` prop. Kept byte-for-byte consistent
 * with `loadPetGridFromDb`'s ordering contract: chromosomes ascend
 * numerically, blocks order by `compareBlockLetters`, positions ascend,
 * and `globalPosition` is assigned in iteration order across a
 * chromosome's blocks.
 */

import { compareBlockLetters, parseGenome } from '$lib/services/genomeParser.js';
import { type ParsedChromosome, type ParsedGene, toGeneId } from '$lib/utils/geneAnalysis.js';

/**
 * Parse raw genome file text into the `{ chromosome: ParsedChromosome }`
 * grid consumed by `GeneVisualizer`. Returns an empty object for text with
 * no parseable `[Genes]` section.
 */
export function genomeTextToGrid(text: string): Record<string, ParsedChromosome> {
  const genome = parseGenome(text);
  const result: Record<string, ParsedChromosome> = {};

  const sortedChromosomes = Object.keys(genome.genes).sort((a, b) => Number(a) - Number(b));

  for (const chromosome of sortedChromosomes) {
    const genes = genome.genes[chromosome];
    if (!genes || genes.length === 0) continue;

    // Group by block letter, mirroring loadPetGridFromDb.
    const byBlock = new Map<string, ParsedGene[]>();
    const allGenes: ParsedGene[] = [];

    const sortedBlockLetters = [...new Set(genes.map((g) => g.block))].sort(compareBlockLetters);

    for (const letter of sortedBlockLetters) {
      const blockGenes = genes
        .filter((g) => g.block === letter)
        .sort((a, b) => a.position - b.position)
        .map((g) => {
          const gene: ParsedGene = {
            id: toGeneId(g),
            type: g.gene_type,
            block: letter,
            position: g.position,
            globalPosition: allGenes.length + 1,
          };
          allGenes.push(gene);
          return gene;
        });
      byBlock.set(letter, blockGenes);
    }

    result[chromosome] = {
      blocks: sortedBlockLetters.map((letter) => ({ letter, genes: byBlock.get(letter) ?? [] })),
      allGenes,
    };
  }

  return result;
}
