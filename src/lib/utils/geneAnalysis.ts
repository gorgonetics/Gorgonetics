/**
 * Shared gene analysis utility.
 *
 * Extracts the stats computation logic from GeneVisualizer so it can be
 * reused by both the visualizer and the comparison service.
 */

import { blockLetter } from '$lib/services/genomeParser.js';

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

/**
 * Pre-parsed representation of a gene effect. Returned by `parseEffect` so
 * the resolved attribute/sign can be persisted to the genes table and
 * queried directly — the raw effect string no longer needs re-parsing on
 * every read.
 */
export interface ParsedEffect {
  attribute: string; // lowercased attribute name, e.g. 'toughness'
  sign: '+' | '-';
}

/**
 * Parse an authored effect string (e.g. "Toughness+", "Intelligence-") into
 * its structured form. Returns null for anything that shouldn't contribute
 * to stats: the no-effect sentinels, potential effects, appearance-only
 * effects, and anything that isn't of the `<Attribute><+|->` shape.
 */
export function parseEffect(effect: string | null | undefined): ParsedEffect | null {
  if (isNoEffect(effect)) return null;
  const s = effect as string;
  if (s.includes('?') || s.toLowerCase().includes('potential')) return null;
  const match = s.match(/^([A-Za-z]+)([+-])$/);
  if (!match) return null;
  return { attribute: match[1].toLowerCase(), sign: match[2] as '+' | '-' };
}

/**
 * Parse an effect into the `(attribute, sign)` pair used as bind params
 * for the genes table's parsed columns — either resolved values or both
 * nulls when the effect isn't attribute-targeting.
 */
export function parsedEffectColumns(effect: string | null | undefined): {
  attribute: string | null;
  sign: '+' | '-' | null;
} {
  const parsed = parseEffect(effect);
  return { attribute: parsed?.attribute ?? null, sign: parsed?.sign ?? null };
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

/** Build the canonical `chromosome+block+position` gene id. */
export function toGeneId(g: { chromosome: string; block: string; position: number }): string {
  return `${g.chromosome}${g.block}${g.position}`;
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
  for (const [chromosome, chrData] of Object.entries(parseGenesByBlock(genes))) {
    result[chromosome] = chrData.allGenes;
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
