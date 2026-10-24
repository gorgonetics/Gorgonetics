/**
 * Genomes from the community cache (`study_corpus`), as loci.
 *
 * The cache has two readers, the study and the rarity baseline's Community
 * tier, and both need each animal's genome as `gene id → genotype`. Rows
 * cached since migration 22 carry it encoded in `loci`, so reading is a
 * decode. Older rows have only `genome_text`, which is fetched for them alone
 * and parsed — the file is the bulk of a row, and most rows do not need it.
 */

import { buildInClauseParams, getDb } from '#lib/services/database.js';
import { lociOfStoredGenomes } from '#lib/services/petService.js';
import type { PetLoci } from '#lib/utils/petLoci.js';

/** The columns `corpusLoci` needs from each cached row. */
export interface CorpusLociRow {
  content_hash: string;
  loci: string | null;
  loci_layout: string | null;
}

/** Whether a row was cached before migration 22, under the old study-only gate. */
export function cachedByOlderBuild(row: Pick<CorpusLociRow, 'loci'>): boolean {
  return !row.loci;
}

/**
 * Each row's loci, keyed by content hash. A row whose genome cannot be read
 * maps to an empty map rather than being dropped, so callers decide.
 */
export async function corpusLoci(rows: readonly CorpusLociRow[]): Promise<Map<string, PetLoci>> {
  const texts = new Map<string, string>();
  const legacy = rows.filter(cachedByOlderBuild).map((row) => row.content_hash);
  // Chunked: SQLite caps the number of bound parameters.
  for (let i = 0; i < legacy.length; i += 500) {
    const { placeholders, params } = buildInClauseParams(legacy.slice(i, i + 500), 'hash');
    const found = await getDb().select<Array<{ content_hash: string; genome_text: string }>>(
      `SELECT content_hash, genome_text FROM study_corpus WHERE content_hash IN (${placeholders})`,
      params,
    );
    for (const row of found) texts.set(row.content_hash, row.genome_text);
  }
  const loci = await lociOfStoredGenomes(
    rows.map((row) => ({ ...row, genome_text: texts.get(row.content_hash) ?? null })),
  );
  return new Map(rows.map((row, i) => [row.content_hash, loci[i]]));
}
