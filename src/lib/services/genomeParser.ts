/**
 * Genome file parser for Gorgonetics.
 */

import type { Gene, GeneType, Genome } from '$lib/types/index.js';

const VALID_GENE_CHARS = new Set(['R', 'D', 'x', '?']);

/**
 * Parse a genome file's [Overview] section and extract header information.
 */
export function parseGenomeFileHeader(content: string): {
  format_version: string;
  breeder: string;
  name: string;
  genome_type: string;
} {
  const lines = content.split(/\r?\n/);
  const header = { format_version: '', breeder: '', name: '', genome_type: '' };
  let inOverview = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line === '[Overview]') {
      inOverview = true;
      continue;
    } else if (line.startsWith('[')) {
      inOverview = false;
      continue;
    }

    if (inOverview && line.includes('=')) {
      const eqIdx = line.indexOf('=');
      const key = line.slice(0, eqIdx).trim();
      const value = line.slice(eqIdx + 1).trim();

      if (key === 'Format') header.format_version = value;
      else if (key === 'Character') header.breeder = value;
      else if (key === 'Entity') header.name = value;
      else if (key === 'Genome') header.genome_type = value;
    }
  }

  return header;
}

/**
 * Parse a genome file's [Genes] section and extract chromosome data.
 * Returns a mapping of chromosome numbers to gene data strings.
 */
export function parseGenomeFileGenes(content: string): Record<string, string> {
  const lines = content.split(/\r?\n/);
  const chromosomes: Record<string, string> = {};
  let inGenes = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line === '[Genes]') {
      inGenes = true;
      continue;
    } else if (line.startsWith('[')) {
      inGenes = false;
      continue;
    }

    if (inGenes && line.includes('=')) {
      const eqIdx = line.indexOf('=');
      const chrNum = line.slice(0, eqIdx).trim();
      const geneData = line.slice(eqIdx + 1).trim();
      chromosomes[chrNum] = geneData;
    }
  }

  return chromosomes;
}

/**
 * Convert a block index to a letter (0=A, 1=B, ..., 25=Z, 26=AA, 27=AB, ...).
 */
export function blockLetter(index: number): string {
  if (index < 26) return String.fromCharCode(65 + index);
  const first = Math.floor((index - 26) / 26);
  const second = (index - 26) % 26;
  return String.fromCharCode(65 + first) + String.fromCharCode(65 + second);
}

/**
 * Generate block letters (A, B, C, ..., Z, AA, AB, ...).
 */
export function generateBlockLetters(numBlocks: number): string[] {
  return Array.from({ length: numBlocks }, (_, i) => blockLetter(i));
}

/** Order block letters as `blockLetter` produces them: shorter before longer, lex within length. */
export function compareBlockLetters(a: string, b: string): number {
  return a.length !== b.length ? a.length - b.length : a.localeCompare(b);
}

/**
 * Count the number of gene blocks in a chromosome.
 */
export function countBlocksInChromosome(geneData: string): number {
  return geneData.split(/\s+/).filter((block) => block.length >= 2).length;
}

/**
 * Parse genes for a single chromosome from a gene data string.
 */
export function parseChromosomeGenes(chromosome: string, geneData: string): Gene[] {
  const genes: Gene[] = [];
  const blocks = geneData.split(/\s+/).filter(Boolean);
  const blockLetters = generateBlockLetters(blocks.length);

  for (let blockIdx = 0; blockIdx < blocks.length; blockIdx++) {
    if (blockIdx >= blockLetters.length) break;

    const blockLetter = blockLetters[blockIdx];
    const blockData = blocks[blockIdx];

    for (let posIdx = 0; posIdx < blockData.length; posIdx++) {
      const geneChar = blockData[posIdx];
      if (!VALID_GENE_CHARS.has(geneChar)) continue;

      genes.push({
        chromosome,
        block: blockLetter,
        position: posIdx + 1,
        gene_type: geneChar as GeneType,
      });
    }
  }

  return genes;
}

/**
 * Parse a complete genome from file content.
 */
export function parseGenome(content: string): Genome {
  const header = parseGenomeFileHeader(content);
  const chromosomeData = parseGenomeFileGenes(content);

  const genes: Record<string, Gene[]> = {};
  for (const [chrNum, geneData] of Object.entries(chromosomeData)) {
    const chrNumPadded = chrNum.padStart(2, '0');
    genes[chrNumPadded] = parseChromosomeGenes(chrNumPadded, geneData);
  }

  return {
    format_version: header.format_version,
    breeder: header.breeder,
    name: header.name,
    genome_type: header.genome_type,
    genes,
  };
}

/**
 * Validate that file content looks like a valid genome file.
 */
export function isValidGenomeFile(content: string): boolean {
  return content.includes('[Overview]') && content.includes('[Genes]');
}
