/**
 * The per-pet loci column (#554): every genotype of a genome as one string.
 *
 * A genome is stored as one character per locus — `D`, `R`, `x` or `?` — in
 * a fixed locus order, and the order itself lives once per layout in
 * `locus_layouts`. It replaces `pet_genes`, which held one row per locus:
 * about 1,576 rows per horse, each read back as its own object.
 *
 * Every genome of a species has had the same layout so far, but the layout is
 * content-addressed rather than assumed, so a game update that adds or moves
 * a locus gives new genomes a new layout instead of misreading old ones.
 *
 * Pure: no database access. Callers read and write the columns.
 */

import { compareBlockLetters, parseGenome } from '$lib/services/genomeParser.js';
import { GeneType, type Genome } from '$lib/types/index.js';
import { fromGeneId, toGeneId } from '$lib/utils/geneAnalysis.js';
import { sha256Hex } from '$lib/utils/hash.js';

const CODES = new Set<string>([GeneType.DOMINANT, GeneType.RECESSIVE, GeneType.MIXED, GeneType.UNKNOWN]);

/**
 * Canonical locus order: chromosome by number, then block (A…Z, AA…), then
 * position — the order a genome file lists them in. Ids that do not parse
 * sort last, by string, so nothing is dropped.
 */
export function compareGeneIds(a: string, b: string): number {
  const pa = fromGeneId(a);
  const pb = fromGeneId(b);
  if (!pa || !pb) return pa ? -1 : pb ? 1 : a.localeCompare(b);
  const chromosome = Number(pa.chromosome) - Number(pb.chromosome);
  if (chromosome !== 0) return chromosome;
  const block = compareBlockLetters(pa.block, pb.block);
  return block !== 0 ? block : pa.position - pb.position;
}

/** One genome, encoded. `ids` is the layout's ordered gene ids, comma-joined. */
export interface EncodedLoci {
  layout: string;
  ids: string;
  loci: string;
}

/**
 * Encode `gene id → genotype` entries. An unrecognised genotype is stored as
 * `?`, the same coercion the `pet_genes` reader applied.
 */
export async function encodeLoci(entries: Iterable<readonly [string, string]>): Promise<EncodedLoci> {
  const sorted = [...entries].sort((a, b) => compareGeneIds(a[0], b[0]));
  const ids = sorted.map(([id]) => id).join(',');
  const loci = sorted.map(([, type]) => (CODES.has(type) ? type : GeneType.UNKNOWN)).join('');
  return { layout: (await sha256Hex(ids)).slice(0, 16), ids, loci };
}

/**
 * Decode a loci string against its layout, in layout order. Returns null when
 * the two disagree in length, which only a corrupt row can produce. A
 * character that is not a genotype reads as unknown rather than propagating —
 * the same rule the `pet_genes` reader applied to a bad row.
 */
export function decodeLoci(ids: readonly string[], loci: string): Map<string, GeneType> | null {
  if (ids.length !== loci.length) return null;
  const out = new Map<string, GeneType>();
  for (let i = 0; i < ids.length; i++) out.set(ids[i], CODES.has(loci[i]) ? (loci[i] as GeneType) : GeneType.UNKNOWN);
  return out;
}

/**
 * A genome's loci from the forms older rows and backups store it in: the
 * parsed `genome_data` JSON (a string or already an object), or failing that
 * the `genome_text` file. Empty when neither yields any, which means the pet
 * has no usable genome.
 */
export function storedGenomeEntries(genomeData: unknown, genomeText: unknown): Array<[string, string]> {
  const fromGenome = (genome: Genome | null | undefined): Array<[string, string]> => {
    const entries: Array<[string, string]> = [];
    for (const list of Object.values(genome?.genes ?? {})) {
      if (!Array.isArray(list)) continue;
      for (const g of list) if (g && typeof g === 'object') entries.push([toGeneId(g), g.gene_type]);
    }
    return entries;
  };
  try {
    const genome = typeof genomeData === 'string' ? (JSON.parse(genomeData) as Genome) : (genomeData as Genome | null);
    const entries = fromGenome(genome && typeof genome === 'object' ? genome : null);
    if (entries.length > 0) return entries;
  } catch {
    // Malformed JSON: fall through to the text.
  }
  try {
    return typeof genomeText === 'string' && genomeText ? fromGenome(parseGenome(genomeText)) : [];
  } catch {
    return [];
  }
}
