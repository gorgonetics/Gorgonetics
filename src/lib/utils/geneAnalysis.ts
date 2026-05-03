/**
 * Effect-string and genome-string parsing helpers shared across the
 * gene services and the visualizer.
 */

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

const GENE_ID_RE = /^(\d{2})([A-Z]+)(\d+)$/;

/** Inverse of `toGeneId`. Returns null on malformed input. */
export function fromGeneId(id: string): { chromosome: string; block: string; position: number } | null {
  const m = id.match(GENE_ID_RE);
  if (!m) return null;
  return { chromosome: m[1], block: m[2], position: Number.parseInt(m[3], 10) };
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
