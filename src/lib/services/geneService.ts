/**
 * Gene data service for Gorgonetics.
 */

import { parseEffect } from '$lib/utils/geneAnalysis.js';
import { now } from '$lib/utils/timestamp.js';
import { normalizeSpecies } from './configService.js';
import { getDb } from './database.js';
import { getSetting, setSetting } from './settingsService.js';

const PARSED_EFFECTS_BACKFILL_KEY = 'genes.parsed_effects_backfilled';

function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * One-shot backfill that populates dominant_attribute / dominant_sign /
 * recessive_attribute / recessive_sign on every row of the genes table.
 * Idempotent via a settings flag. Non-blocking: callers should kick this
 * off after the app is interactive, same pattern as positive_genes
 * backfill. New rows (upsertGene / updateGene / updateGenesBulk) populate
 * the parsed columns directly, so this is only needed for users upgrading
 * from before migration v10.
 */
export async function backfillParsedGeneEffectsIfNeeded(): Promise<void> {
  const done = await getSetting<boolean>(PARSED_EFFECTS_BACKFILL_KEY);
  if (done) return;

  const db = getDb();
  const rows = await db.select<
    { animal_type: string; gene: string; effectDominant: string | null; effectRecessive: string | null }[]
  >('SELECT animal_type, gene, effectDominant, effectRecessive FROM genes');

  if (rows.length === 0) {
    await setSetting(PARSED_EFFECTS_BACKFILL_KEY, true);
    return;
  }

  console.info(`parsed-effects backfill: starting for ${rows.length} gene rows`);

  const BATCH = 64;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    await db.execute('BEGIN');
    try {
      for (const row of slice) {
        const dom = parseEffect(row.effectDominant);
        const rec = parseEffect(row.effectRecessive);
        await db.execute(
          `UPDATE genes
           SET dominant_attribute = $da, dominant_sign = $ds,
               recessive_attribute = $ra, recessive_sign = $rs
           WHERE animal_type = $at AND gene = $g`,
          {
            da: dom?.attribute ?? null,
            ds: dom?.sign ?? null,
            ra: rec?.attribute ?? null,
            rs: rec?.sign ?? null,
            at: row.animal_type,
            g: row.gene,
          },
        );
      }
      await db.execute('COMMIT');
    } catch (e) {
      await db.execute('ROLLBACK');
      throw e;
    }
    const processed = Math.min(i + BATCH, rows.length);
    console.info(`parsed-effects backfill: ${processed}/${rows.length}`);
    await yieldToUI();
  }

  await setSetting(PARSED_EFFECTS_BACKFILL_KEY, true);
  console.info('parsed-effects backfill: done');
}

/**
 * Get list of all animal types.
 */
export async function getAnimalTypes(): Promise<string[]> {
  const db = getDb();
  const rows = await db.select<{ animal_type: string }[]>(
    'SELECT DISTINCT animal_type FROM genes ORDER BY animal_type',
  );
  return rows.map((r) => r.animal_type);
}

/**
 * Get all chromosomes for a specific animal type.
 */
export async function getChromosomes(animalType: string): Promise<string[]> {
  const db = getDb();
  const rows = await db.select<{ chromosome: string }[]>(
    'SELECT DISTINCT chromosome FROM genes WHERE animal_type = $animalType ORDER BY chromosome',
    { animalType },
  );
  return rows.map((r) => r.chromosome);
}

/**
 * Get all genes for a specific animal type and chromosome.
 */
export async function getGenesByChromosome(animalType: string, chromosome: string): Promise<Record<string, string>[]> {
  const db = getDb();
  return db.select(
    `SELECT animal_type, chromosome, gene, effectDominant, effectRecessive,
            appearance, breed, notes, created_at
     FROM genes
     WHERE animal_type = $animalType AND chromosome = $chromosome
     ORDER BY gene`,
    { animalType, chromosome },
  );
}

/**
 * Get a specific gene record.
 */
export async function getGene(animalType: string, gene: string): Promise<Record<string, string> | null> {
  const db = getDb();
  const rows = await db.select<Record<string, string>[]>(
    `SELECT animal_type, chromosome, gene, effectDominant, effectRecessive,
            appearance, breed, notes, created_at
     FROM genes WHERE animal_type = $animalType AND gene = $gene`,
    { animalType, gene },
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Get all genes for a specific animal type (for gene effects aggregation).
 */
export async function getGenesForAnimal(animalType: string): Promise<Record<string, string>[]> {
  const db = getDb();
  return db.select(
    `SELECT animal_type, chromosome, gene, effectDominant, effectRecessive,
            appearance, breed, notes, created_at
     FROM genes WHERE animal_type = $animalType ORDER BY chromosome, gene`,
    { animalType },
  );
}

/**
 * Update a gene's attributes. When `effectDominant` or `effectRecessive`
 * is in the update, the corresponding pre-parsed columns are refreshed so
 * downstream SQL queries don't have to re-parse the effect string.
 */
export async function updateGene(animalType: string, gene: string, updates: Record<string, string>): Promise<boolean> {
  const db = getDb();
  const setClauses: string[] = [];
  const params: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(updates)) {
    if (!['animal_type', 'gene', 'created_at'].includes(field)) {
      setClauses.push(`${field} = $${field}`);
      params[field] = value;
    }
  }

  if ('effectDominant' in updates) {
    const parsed = parseEffect(updates.effectDominant);
    setClauses.push('dominant_attribute = $dominant_attribute');
    setClauses.push('dominant_sign = $dominant_sign');
    params.dominant_attribute = parsed?.attribute ?? null;
    params.dominant_sign = parsed?.sign ?? null;
  }
  if ('effectRecessive' in updates) {
    const parsed = parseEffect(updates.effectRecessive);
    setClauses.push('recessive_attribute = $recessive_attribute');
    setClauses.push('recessive_sign = $recessive_sign');
    params.recessive_attribute = parsed?.attribute ?? null;
    params.recessive_sign = parsed?.sign ?? null;
  }

  if (setClauses.length === 0) return false;

  setClauses.push('updated_at = $updated_at');
  params.updated_at = now();
  params.w_animal_type = animalType;
  params.w_gene = gene;

  await db.execute(
    `UPDATE genes SET ${setClauses.join(', ')} WHERE animal_type = $w_animal_type AND gene = $w_gene`,
    params,
  );
  return true;
}

/**
 * Bulk update genes for a chromosome.
 */
export async function updateGenesBulk(
  animalType: string,
  chromosome: string,
  genes: { gene: string; effectDominant: string; effectRecessive: string; appearance: string; notes: string }[],
): Promise<number> {
  let count = 0;
  for (const g of genes) {
    const ok = await updateGene(animalType, g.gene, {
      effectDominant: g.effectDominant,
      effectRecessive: g.effectRecessive,
      appearance: g.appearance,
      notes: g.notes,
      chromosome,
    });
    if (ok) count++;
  }
  clearGeneEffectsCache(animalType);
  return count;
}

/**
 * Insert or update a gene record (used during template loading).
 */
export async function upsertGene(
  animalType: string,
  chromosome: string,
  gene: string,
  data: { effectDominant?: string; effectRecessive?: string; appearance?: string; breed?: string; notes?: string },
): Promise<void> {
  const db = getDb();
  const ts = now();
  const effectDominant = data.effectDominant ?? 'None';
  const effectRecessive = data.effectRecessive ?? 'None';
  const dom = parseEffect(effectDominant);
  const rec = parseEffect(effectRecessive);
  await db.execute(
    `INSERT OR REPLACE INTO genes
     (animal_type, chromosome, gene, effectDominant, effectRecessive, appearance, breed, notes, created_at, updated_at,
      dominant_attribute, dominant_sign, recessive_attribute, recessive_sign)
     VALUES ($animal_type, $chromosome, $gene, $effectDominant, $effectRecessive, $appearance, $breed, $notes, $created_at, $updated_at,
             $dominant_attribute, $dominant_sign, $recessive_attribute, $recessive_sign)`,
    {
      animal_type: animalType,
      chromosome,
      gene,
      effectDominant,
      effectRecessive,
      appearance: data.appearance ?? 'None',
      breed: data.breed ?? '',
      notes: data.notes ?? '',
      created_at: ts,
      updated_at: ts,
      dominant_attribute: dom?.attribute ?? null,
      dominant_sign: dom?.sign ?? null,
      recessive_attribute: rec?.attribute ?? null,
      recessive_sign: rec?.sign ?? null,
    },
  );
}

/**
 * Get all gene effects for visualization (aggregated by gene ID).
 */
export async function getGeneEffects(species: string): Promise<{
  effects: Record<
    string,
    { effectDominant: string; effectRecessive: string; appearance: string; breed: string; notes: string }
  >;
}> {
  const normalized = normalizeSpecies(species);
  const allGenes = await getGenesForAnimal(normalized);

  const effects: Record<
    string,
    { effectDominant: string; effectRecessive: string; appearance: string; breed: string; notes: string }
  > = {};
  for (const gene of allGenes) {
    effects[gene.gene] = {
      effectDominant: gene.effectDominant ?? 'None',
      effectRecessive: gene.effectRecessive ?? 'None',
      appearance: gene.appearance ?? '',
      breed: gene.breed ?? '',
      notes: gene.notes ?? '',
    };
  }

  return { effects };
}

const geneEffectsCache = new Map<string, ReturnType<typeof getGeneEffects>>();

/**
 * Cached wrapper around getGeneEffects for use in visualization hot paths.
 */
export async function getGeneEffectsCached(species: string) {
  const normalized = normalizeSpecies(species);
  if (geneEffectsCache.has(normalized)) return geneEffectsCache.get(normalized);
  const promise = getGeneEffects(normalized);
  geneEffectsCache.set(normalized, promise);
  return promise;
}

/**
 * Invalidate cached gene effects for a species (call after editing genes).
 */
export function clearGeneEffectsCache(species?: string) {
  if (species) {
    geneEffectsCache.delete(normalizeSpecies(species));
  } else {
    geneEffectsCache.clear();
  }
}

/**
 * Export genes for a chromosome in the same format as asset JSON files.
 */
export async function exportGenesToJson(animalType: string, chromosome: string): Promise<Record<string, string>[]> {
  const genes = await getGenesByChromosome(animalType, chromosome);
  return genes.map((g) => ({
    gene: g.gene,
    effectDominant: g.effectDominant ?? 'None',
    effectRecessive: g.effectRecessive ?? 'None',
    appearance: g.appearance ?? 'None',
    breed: g.breed ?? '',
    notes: g.notes ?? '',
  }));
}

/**
 * Export all chromosomes for an animal type.
 */
export async function exportAllChromosomes(animalType: string): Promise<Record<string, Record<string, string>[]>> {
  const chromosomes = await getChromosomes(animalType);
  const result: Record<string, Record<string, string>[]> = {};
  for (const chr of chromosomes) {
    result[chr] = await exportGenesToJson(animalType, chr);
  }
  return result;
}

/**
 * Check if genes table has any data.
 */
export async function hasGenes(): Promise<boolean> {
  const db = getDb();
  const rows = await db.select<{ cnt: number }[]>('SELECT COUNT(*) as cnt FROM genes');
  return rows[0].cnt > 0;
}
