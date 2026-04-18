/**
 * Shared gene analysis utility.
 *
 * Extracts the stats computation logic from GeneVisualizer so it can be
 * reused by both the visualizer and the comparison service.
 */

import { getAllAttributeNames, getAttributeConfig, normalizeSpecies } from '$lib/services/configService.js';
import { blockLetter } from '$lib/services/genomeParser.js';
import type { GeneStatsEntry } from '$lib/types/index.js';
import { capitalize } from '$lib/utils/string.js';

// --- Effect classification helpers ---

export const NO_EFFECT_SENTINELS = new Set([
  'No gene data found',
  'No dominant effect',
  'No recessive effect',
  'Unknown gene type',
  'None',
  'null',
]);

export function isNoEffect(effect: string | null | undefined): boolean {
  return !effect || NO_EFFECT_SENTINELS.has(effect);
}

/** Shape of a single gene's effect record within an `effectsDB` map. */
export interface GeneEffectData {
  effectDominant: string;
  effectRecessive: string;
  breed: string;
  appearance?: string;
  notes?: string;
}

/**
 * Resolve the displayable effect string for a gene given its data record and type.
 * Pass the already-indexed `effectsDB[geneId]` — this helper doesn't know about species.
 */
export function effectFor(geneData: GeneEffectData | undefined, geneType: string): string {
  if (!geneData) return 'No gene data found';
  if (geneType === 'D' || geneType === 'x') {
    return isNoEffect(geneData.effectDominant) ? 'No dominant effect' : geneData.effectDominant;
  }
  if (geneType === 'R') {
    return isNoEffect(geneData.effectRecessive) ? 'No recessive effect' : geneData.effectRecessive;
  }
  return 'Unknown gene type';
}

/** Resolve the breed string for a gene data record (empty string if none). */
export function breedFor(geneData: { breed?: string } | undefined): string {
  return geneData?.breed || '';
}

/** Parsed gene from a genome string. */
export interface ParsedGene {
  id: string;
  type: string;
  block: string;
  position: number;
  globalPosition: number;
}

/** Parsed chromosome grouped by block for grid rendering. */
export interface ParsedChromosome {
  blocks: Array<{ letter: string; genes: ParsedGene[] }>;
  allGenes: ParsedGene[];
}

/**
 * Parse a genome's gene strings into a flat list per chromosome.
 * Input: `genes` from `getPetGenome()` — `Record<string, string>` where
 * each value is like `"RDRD RDRR ?D?? x?xR"`.
 */
export function parseGenomeGenes(genes: Record<string, string>): Record<string, ParsedGene[]> {
  const result: Record<string, ParsedGene[]> = {};
  for (const [chromosome, blocks] of Object.entries(parseGenesByBlock(genes))) {
    result[chromosome] = blocks.allGenes;
  }
  return result;
}

/**
 * Parse a genome's gene strings grouped by block, for grid/visualizer rendering.
 * Returns both the block grouping and a flat `allGenes` list per chromosome.
 */
export function parseGenesByBlock(genes: Record<string, string>): Record<string, ParsedChromosome> {
  const result: Record<string, ParsedChromosome> = {};

  for (const [chromosome, geneString] of Object.entries(genes)) {
    const blockStrings = geneString.split(' ');
    const allGenes: ParsedGene[] = [];
    const blocks: Array<{ letter: string; genes: ParsedGene[] }> = [];

    for (let bi = 0; bi < blockStrings.length; bi++) {
      const bl = blockLetter(bi);
      const blockGenes: ParsedGene[] = [];

      for (let i = 0; i < blockStrings[bi].length; i++) {
        const gene: ParsedGene = {
          id: `${chromosome}${bl}${i + 1}`,
          type: blockStrings[bi][i],
          block: bl,
          position: i + 1,
          globalPosition: allGenes.length + 1,
        };
        blockGenes.push(gene);
        allGenes.push(gene);
      }

      blocks.push({ letter: bl, genes: blockGenes });
    }

    result[chromosome] = { blocks, allGenes };
  }

  return result;
}

/**
 * Compute per-attribute gene stats for a pet's genome.
 *
 * Returns a map of attribute key → { positive, negative, dominant, recessive, mixed }.
 * Also returns totalGenes and neutralGenes counts.
 */
type GeneEffectsDB = Record<string, Record<string, GeneEffectData>>;

export function computeGeneStats(
  genes: Record<string, string>,
  species: string,
  geneEffectsDB: GeneEffectsDB,
  petBreed?: string,
): { stats: Record<string, GeneStatsEntry>; totalGenes: number; neutralGenes: number } {
  const speciesKey = normalizeSpecies(species);
  const _config = getAttributeConfig(speciesKey);
  const attrNames = getAllAttributeNames(speciesKey).map((name) => capitalize(name));
  const speciesEffects = geneEffectsDB[speciesKey] ?? {};

  const emptyEntry = (): GeneStatsEntry => ({ positive: 0, negative: 0, dominant: 0, recessive: 0, mixed: 0 });
  const stats: Record<string, GeneStatsEntry> = {};
  for (const attr of attrNames) {
    stats[attr] = emptyEntry();
  }

  let totalGenes = 0;
  let neutralGenes = 0;

  for (const [_chromosome, geneList] of Object.entries(parseGenomeGenes(genes))) {
    for (const gene of geneList) {
      if (gene.type === '?') continue;
      totalGenes++;

      const geneData = speciesEffects[gene.id];

      // Skip genes from other breeds (horse only)
      if (speciesKey === 'horse' && petBreed && petBreed !== 'Mixed') {
        const breed = breedFor(geneData);
        if (breed && breed !== petBreed) continue;
      }

      const effect = effectFor(geneData, gene.type);
      if (isNoEffect(effect)) {
        neutralGenes++;
        continue;
      }

      const effectStr = effect || '';
      const isPotential = effectStr.includes('?') || effectStr.toLowerCase().includes('potential');
      if (isPotential) {
        neutralGenes++;
        continue;
      }

      const hasPlus = effectStr.includes('+');
      const hasMinus = effectStr.includes('-');

      if (!hasPlus && !hasMinus) {
        neutralGenes++;
        continue;
      }

      // Find which attribute this effect targets
      let matchedAttr: string | null = null;
      for (const attrName of attrNames) {
        if (effectStr.includes(attrName)) {
          matchedAttr = attrName;
          break;
        }
      }

      if (!matchedAttr || !stats[matchedAttr]) {
        neutralGenes++;
        continue;
      }

      const entry = stats[matchedAttr];
      if (hasPlus) entry.positive++;
      if (hasMinus) entry.negative++;
      if (gene.type === 'D') entry.dominant++;
      else if (gene.type === 'R') entry.recessive++;
      else if (gene.type === 'x') entry.mixed++;
    }
  }

  return { stats, totalGenes, neutralGenes };
}
