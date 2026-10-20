/**
 * The "never seen" lens of the genome map: a capture checklist.
 *
 * The rarity map shows both arms of every locus on a scale. Before a capture
 * only its top step matters — an allele no pet of yours carries, because
 * nothing you own can breed it. This reduces each locus to that one allele, or
 * to nothing, so the map reads as a list of what to look for in a wild pet.
 *
 * It reuses `rarityBucket` through the lookup rather than testing
 * `carriers === 0` itself, so the same `SOLE_CARRIER_MIN_PETS` gate applies and
 * this lens can never disagree with the rarity map about which cells are
 * never seen.
 */

import { GeneType } from '$lib/types/index.js';
import { fromGeneId } from '$lib/utils/geneAnalysis.js';
import { type Allele, RARITY_BUCKET_NEVER } from '$lib/utils/geneFrequency.js';
import { compareGeneIds } from '$lib/utils/lociCodec.js';
import type { RarityBucketSource } from '$lib/utils/rarityCSS.js';

/**
 * The never-seen allele at each locus that has one, keyed by gene id.
 *
 * At most one allele per locus: the two frequencies sum to 1 over a measured
 * locus, so both arms cannot be absent at once.
 */
export function neverSeenAlleles(geneIds: Iterable<string>, lookup: RarityBucketSource): Map<string, Allele> {
  const out = new Map<string, Allele>();
  for (const geneId of geneIds) {
    if (lookup.bucketOf(geneId, GeneType.DOMINANT) === RARITY_BUCKET_NEVER) out.set(geneId, GeneType.DOMINANT);
    else if (lookup.bucketOf(geneId, GeneType.RECESSIVE) === RARITY_BUCKET_NEVER) out.set(geneId, GeneType.RECESSIVE);
  }
  return out;
}

/** One chromosome's line in the never-seen list. */
export interface NeverSeenChromosome {
  chromosome: string;
  /** In genome order. `slot` is the gene id without its chromosome, e.g. `A3`. */
  alleles: { geneId: string; slot: string; allele: Allele }[];
}

/**
 * The same alleles as text, one line per chromosome in genome order — the form
 * that can be read off beside a wild pet's genome without matching columns.
 * Chromosomes with nothing to look for are left out. Ids that do not parse are
 * dropped, as the grid drops them.
 */
export function groupNeverSeenByChromosome(alleles: ReadonlyMap<string, Allele>): NeverSeenChromosome[] {
  const out: NeverSeenChromosome[] = [];
  for (const geneId of [...alleles.keys()].sort(compareGeneIds)) {
    const parsed = fromGeneId(geneId);
    const allele = alleles.get(geneId);
    if (!parsed || !allele) continue;
    let line = out.at(-1);
    if (line?.chromosome !== parsed.chromosome) {
      line = { chromosome: parsed.chromosome, alleles: [] };
      out.push(line);
    }
    line.alleles.push({ geneId, slot: `${parsed.block}${parsed.position}`, allele });
  }
  return out;
}
