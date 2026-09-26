/**
 * Shared two-pet locus primitives.
 *
 * Reads each pet's `loci` column — one encoded string per pet, see
 * `lociCodec` — and exposes a tiny API any downstream feature (breeding,
 * comparison, trio analysis) can compose without re-implementing the bulk
 * read or the union walk.
 *
 * Pure data access + iteration. No effect logic, no breed filtering, no
 * scoring — those stay in their consuming services.
 */

import { compareBlockLetters } from '$lib/services/genomeParser.js';
import { ensurePetLociPopulated, readPetLoci } from '$lib/services/petService.js';
import { GeneType } from '$lib/types/index.js';
import { fromGeneId } from '$lib/utils/geneAnalysis.js';

/** `gene_id → gene_type` for one pet, in locus order. */
export type PetLoci = Map<string, GeneType>;

/**
 * One gene's positional metadata, recovered from a locus by
 * parsing its gene_id. Used by consumers that need to walk loci in
 * positional order rather than as a flat key→value map.
 */
export interface ChromosomeLocus {
  /** Canonical gene_id, e.g. `01A1`. */
  id: string;
  type: GeneType;
  /** Block letter, e.g. `A`, `B`, …, `Z`, `AA`, `AB`, …. */
  block: string;
  /** 1-based position within its block. */
  position: number;
}

/**
 * Bulk-read the loci of the given pets. Returns a per-pet map keyed by id;
 * a pet with no usable genome is **omitted entirely**, so callers cannot
 * mistake a missing pet for one whose every locus is unknown.
 *
 * A pet whose `loci` column is still empty (imported before it existed, and
 * not yet reached by the startup backfill) is filled from its `genome_data`
 * inline and read again, so a consumer never sees a phantom empty genome.
 */
export async function loadAllPetLoci(petIds: readonly number[]): Promise<Map<number, PetLoci>> {
  const map = await readPetLoci(petIds);
  if (map.size === petIds.length) return map;

  const missing = petIds.filter((id) => !map.has(id));
  const populated: number[] = [];
  for (const id of missing) {
    if (await ensurePetLociPopulated(id)) populated.push(id);
  }
  if (populated.length === 0) return map;

  const refreshed = await readPetLoci(populated);
  for (const [id, loci] of refreshed) map.set(id, loci);
  return map;
}

/**
 * Iterate the union of two pets' loci, calling `fn` once per locus
 * present in either side. The locus's `typeA` / `typeB` defaults to
 * `GeneType.UNKNOWN` when the corresponding pet's projection has no
 * row — happens for partially-imported genomes; well-formed
 * same-species genomes carry one row per position, including `?`
 * alleles, so both maps usually hold identical key sets.
 *
 * Iteration order: every `geneId` from `a` first (in its insertion
 * order), then loci that exist only in `b`. The second loop's
 * `a.has(geneId)` skip is what prevents double-emission for keys
 * present in both maps — without it, shared loci would fire `fn`
 * twice. Callers that need a canonical order (e.g. for diff display)
 * should sort `a`/`b` before passing them in or buffer the callback
 * output.
 */
export function walkPairLoci(
  a: PetLoci,
  b: PetLoci,
  fn: (geneId: string, typeA: GeneType, typeB: GeneType) => void,
): void {
  for (const [geneId, typeA] of a) {
    fn(geneId, typeA, b.get(geneId) ?? GeneType.UNKNOWN);
  }
  for (const [geneId, typeB] of b) {
    if (a.has(geneId)) continue;
    fn(geneId, GeneType.UNKNOWN, typeB);
  }
}

/**
 * Reshape a flat `PetLoci` into a per-chromosome positional list.
 *
 * Within each chromosome, blocks are ordered by `compareBlockLetters`
 * (shorter strings first, lexicographic within length: A, B, …, Z,
 * AA, AB, …) and positions ascend within a block — the same canonical
 * iteration order `loadPetGridFromDb` produces from `loci`. Use
 * this when a consumer needs an index-aligned walk (e.g. side-by-side
 * genome diff) rather than the key-based union walk `walkPairLoci`
 * provides.
 *
 * Genes whose IDs don't match the canonical gene_id pattern are
 * silently dropped — same defensive shape `fromGeneId` would skip.
 */
export function groupLociByChromosome(loci: PetLoci): Map<string, ChromosomeLocus[]> {
  const grouped = new Map<string, ChromosomeLocus[]>();
  for (const [id, type] of loci) {
    const parsed = fromGeneId(id);
    if (!parsed) continue;
    let arr = grouped.get(parsed.chromosome);
    if (!arr) {
      arr = [];
      grouped.set(parsed.chromosome, arr);
    }
    arr.push({ id, type, block: parsed.block, position: parsed.position });
  }
  for (const arr of grouped.values()) {
    arr.sort((a, b) => {
      const blockCmp = compareBlockLetters(a.block, b.block);
      return blockCmp !== 0 ? blockCmp : a.position - b.position;
    });
  }
  return grouped;
}
