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

const NO_EFFECT_SENTINELS = new Set([
  'No gene data found',
  'No dominant effect',
  'No recessive effect',
  'Unknown gene type',
  'None',
  'null',
]);

function isNoEffect(effect: string | null | undefined): boolean {
  return !effect || NO_EFFECT_SENTINELS.has(effect);
}

function getGeneEffect(
  geneEffectsDB: Record<string, Record<string, { effectDominant: string; effectRecessive: string; breed: string }>>,
  speciesKey: string,
  geneId: string,
  geneType: string,
): string {
  const geneData = geneEffectsDB[speciesKey]?.[geneId];
  if (!geneData) return 'No gene data found';

  if (geneType === 'D' || geneType === 'x') {
    const effect = geneData.effectDominant;
    return isNoEffect(effect) ? 'No dominant effect' : effect;
  }
  if (geneType === 'R') {
    const effect = geneData.effectRecessive;
    return isNoEffect(effect) ? 'No recessive effect' : effect;
  }
  return 'Unknown gene type';
}

function getGeneBreed(
  geneEffectsDB: Record<string, Record<string, { breed: string }>>,
  speciesKey: string,
  geneId: string,
): string {
  return geneEffectsDB[speciesKey]?.[geneId]?.breed || '';
}

/** Parsed gene from a genome string. */
export interface ParsedGene {
  id: string;
  type: string;
  block: string;
  position: number;
}

/**
 * Parse a genome's gene strings into structured gene objects.
 * Input: `genes` from `getPetGenome()` — `Record<string, string>` where
 * each value is like `"RDRD RDRR ?D?? x?xR"`.
 */
export function parseGenomeGenes(genes: Record<string, string>): Record<string, ParsedGene[]> {
  const result: Record<string, ParsedGene[]> = {};

  for (const [chromosome, geneString] of Object.entries(genes)) {
    const blockStrings = geneString.split(' ');
    const allGenes: ParsedGene[] = [];

    for (let blockIndex = 0; blockIndex < blockStrings.length; blockIndex++) {
      const bl = blockLetter(blockIndex);
      const blockString = blockStrings[blockIndex];

      for (let i = 0; i < blockString.length; i++) {
        allGenes.push({
          id: `${chromosome}${bl}${i + 1}`,
          type: blockString[i],
          block: bl,
          position: i + 1,
        });
      }
    }

    result[chromosome] = allGenes;
  }

  return result;
}

/**
 * Compute per-attribute gene stats for a pet's genome.
 *
 * Returns a map of attribute key → { positive, negative, dominant, recessive, mixed }.
 * Also returns totalGenes and neutralGenes counts.
 */
type GeneEffectsDB = Record<string, Record<string, { effectDominant: string; effectRecessive: string; breed: string }>>;

export function computeGeneStats(
  genes: Record<string, string>,
  species: string,
  geneEffectsDB: GeneEffectsDB,
  petBreed?: string,
): { stats: Record<string, GeneStatsEntry>; totalGenes: number; neutralGenes: number } {
  const speciesKey = normalizeSpecies(species);
  const config = getAttributeConfig(speciesKey);
  const attrNames = getAllAttributeNames(speciesKey).map((name) => capitalize(name));

  const emptyEntry = (): GeneStatsEntry => ({ positive: 0, negative: 0, dominant: 0, recessive: 0, mixed: 0 });
  const stats: Record<string, GeneStatsEntry> = {};
  for (const attr of attrNames) {
    stats[attr] = emptyEntry();
  }

  let totalGenes = 0;
  let neutralGenes = 0;

  const parsedGenome = parseGenomeGenes(genes);
  const effectsDB = geneEffectsDB;

  for (const [_chromosome, geneList] of Object.entries(parsedGenome)) {
    for (const gene of geneList) {
      if (gene.type === '?') continue;
      totalGenes++;

      // Skip genes from other breeds (horse only)
      if (speciesKey === 'horse' && petBreed && petBreed !== 'Mixed') {
        const breed = getGeneBreed(effectsDB, speciesKey, gene.id);
        if (breed && breed !== petBreed) continue;
      }

      const effect = getGeneEffect(effectsDB, speciesKey, gene.id, gene.type);
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
