/**
 * Shared two-pet locus primitives.
 *
 * Reads the pre-projected `pet_genes` table — one row per genome
 * position — and exposes a tiny API any downstream feature (breeding,
 * comparison, future trio analysis) can compose without re-implementing
 * the bulk SELECT or the union walk.
 *
 * Pure data access + iteration. No effect logic, no breed filtering, no
 * scoring — those stay in their consuming services.
 */

import { getDb } from '$lib/services/database.js';
import { GeneType } from '$lib/types/index.js';

/** `gene_id → gene_type` for one pet, sourced from `pet_genes`. */
export type PetLoci = Map<string, GeneType>;

const VALID_GENE_TYPES = new Set<string>(Object.values(GeneType));

/**
 * Coerce a raw `pet_genes.gene_type` value to a well-formed `GeneType`.
 * The schema only ever holds `D`/`R`/`x`/`?`, but a bad row from a
 * legacy backup or a future schema mistake shouldn't poison downstream
 * logic — anything unrecognised becomes `UNKNOWN`, which the breeding
 * and comparison services already handle naturally.
 */
function coerceGeneType(raw: string): GeneType {
  return VALID_GENE_TYPES.has(raw) ? (raw as GeneType) : GeneType.UNKNOWN;
}

/**
 * Bulk-read `pet_genes` for the union of input pet ids in a single
 * round-trip. Returns a per-pet map keyed by id; pets with no projected
 * rows are **omitted entirely** from the result — callers cannot
 * distinguish a missing pet from one that exists but has zero rows by
 * looking at the map alone, so check `map.has(id)` rather than treating
 * `map.get(id)` as authoritative.
 *
 * One query for N pets is the difference between O(1) and O(N) IPC
 * calls in the in-memory adapter and a single B-tree scan vs N in
 * production SQLite.
 */
export async function loadAllPetLoci(petIds: readonly number[]): Promise<Map<number, PetLoci>> {
  const map = new Map<number, PetLoci>();
  if (petIds.length === 0) return map;
  const db = getDb();
  const placeholders = petIds.map((_, i) => `$id${i}`).join(', ');
  const params: Record<string, unknown> = {};
  petIds.forEach((id, i) => {
    params[`id${i}`] = id;
  });
  const rows = await db.select<{ pet_id: number; gene_id: string; gene_type: string }[]>(
    `SELECT pet_id, gene_id, gene_type FROM pet_genes WHERE pet_id IN (${placeholders})`,
    params,
  );
  for (const row of rows) {
    let loci = map.get(row.pet_id);
    if (!loci) {
      loci = new Map();
      map.set(row.pet_id, loci);
    }
    loci.set(row.gene_id, coerceGeneType(row.gene_type));
  }
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
