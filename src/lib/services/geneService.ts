/**
 * Gene data service for Gorgonetics.
 */

import { yieldToUI } from '$lib/utils/async.js';
import { parsedEffectColumns } from '$lib/utils/geneAnalysis.js';
import { now } from '$lib/utils/timestamp.js';
import { normalizeSpecies } from './configService.js';
import { getDb } from './database.js';

/**
 * Populate dominant_attribute / dominant_sign / recessive_attribute /
 * recessive_sign on gene rows whose effect strings would parse to a real
 * attribute+sign but whose parsed columns are still NULL. Data-driven
 * guard (probe query) instead of a settings flag — backup restore or
 * manual gene-table rewrites stay self-healing, and the steady state
 * skips work after one SELECT.
 *
 * Non-blocking: callers should run this off the critical startup path.
 *
 * Each UPDATE is conditional on the effect strings still matching what
 * the backfill read, so a GeneEditor save mid-flight can't be clobbered
 * by a stale parse.
 */
export async function backfillParsedGeneEffectsIfNeeded(): Promise<void> {
  const db = getDb();
  const rows = await db.select<
    {
      animal_type: string;
      gene: string;
      effectDominant: string | null;
      effectRecessive: string | null;
      dominant_attribute: string | null;
      recessive_attribute: string | null;
    }[]
  >(
    `SELECT animal_type, gene, effectDominant, effectRecessive,
            dominant_attribute, recessive_attribute
     FROM genes`,
  );

  const needsWork = rows.filter((row) => {
    const dom = parsedEffectColumns(row.effectDominant);
    const rec = parsedEffectColumns(row.effectRecessive);
    // `== null` catches both SQL NULL (real SQLite) and `undefined` (the
    // in-memory test adapter when a column was never written).
    return (
      (dom.attribute !== null && row.dominant_attribute == null) ||
      (rec.attribute !== null && row.recessive_attribute == null)
    );
  });

  if (needsWork.length === 0) return;

  console.info(`parsed-effects backfill: ${needsWork.length} rows need updating`);

  const BATCH = 64;
  for (let i = 0; i < needsWork.length; i += BATCH) {
    const slice = needsWork.slice(i, i + BATCH);
    await db.execute('BEGIN');
    try {
      for (const row of slice) {
        const dom = parsedEffectColumns(row.effectDominant);
        const rec = parsedEffectColumns(row.effectRecessive);
        await db.execute(
          `UPDATE genes
           SET dominant_attribute = $da, dominant_sign = $ds,
               recessive_attribute = $ra, recessive_sign = $rs
           WHERE animal_type = $at AND gene = $g
             AND COALESCE(effectDominant, '') = $sed
             AND COALESCE(effectRecessive, '') = $ser`,
          {
            da: dom.attribute,
            ds: dom.sign,
            ra: rec.attribute,
            rs: rec.sign,
            at: row.animal_type,
            g: row.gene,
            sed: row.effectDominant ?? '',
            ser: row.effectRecessive ?? '',
          },
        );
      }
      await db.execute('COMMIT');
    } catch (e) {
      await db.execute('ROLLBACK');
      throw e;
    }
    const processed = Math.min(i + BATCH, needsWork.length);
    console.info(`parsed-effects backfill: ${processed}/${needsWork.length}`);
    await yieldToUI();
  }

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
    const { attribute, sign } = parsedEffectColumns(updates.effectDominant);
    setClauses.push('dominant_attribute = $dominant_attribute', 'dominant_sign = $dominant_sign');
    params.dominant_attribute = attribute;
    params.dominant_sign = sign;
  }
  if ('effectRecessive' in updates) {
    const { attribute, sign } = parsedEffectColumns(updates.effectRecessive);
    setClauses.push('recessive_attribute = $recessive_attribute', 'recessive_sign = $recessive_sign');
    params.recessive_attribute = attribute;
    params.recessive_sign = sign;
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
  const dom = parsedEffectColumns(effectDominant);
  const rec = parsedEffectColumns(effectRecessive);
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
      dominant_attribute: dom.attribute,
      dominant_sign: dom.sign,
      recessive_attribute: rec.attribute,
      recessive_sign: rec.sign,
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
 * Pre-parsed gene record used by stats aggregation. Populated from the
 * genes table's dominant_/recessive_attribute and _sign columns — the
 * effect string never has to be re-parsed at stats time.
 */
export interface ParsedGeneRecord {
  dominantAttribute: string | null;
  dominantSign: '+' | '-' | null;
  recessiveAttribute: string | null;
  recessiveSign: '+' | '-' | null;
  breed: string;
}

const parsedGenesCache = new Map<string, Promise<Record<string, ParsedGeneRecord>>>();

/**
 * Cached `gene_id → ParsedGeneRecord` map for a species. Reads pre-parsed
 * attribute/sign columns straight off the genes table — stats aggregation
 * never has to re-parse effect strings.
 */
export async function getParsedGenesCached(species: string): Promise<Record<string, ParsedGeneRecord>> {
  const normalized = normalizeSpecies(species);
  const existing = parsedGenesCache.get(normalized);
  if (existing) return existing;
  const promise = (async () => {
    const db = getDb();
    const rows = await db.select<
      {
        gene: string;
        dominant_attribute: string | null;
        dominant_sign: string | null;
        recessive_attribute: string | null;
        recessive_sign: string | null;
        breed: string | null;
      }[]
    >(
      `SELECT gene, dominant_attribute, dominant_sign, recessive_attribute, recessive_sign, breed
       FROM genes WHERE animal_type = $animalType`,
      { animalType: normalized },
    );
    const map: Record<string, ParsedGeneRecord> = {};
    for (const r of rows) {
      map[r.gene] = {
        dominantAttribute: r.dominant_attribute ?? null,
        dominantSign: (r.dominant_sign as '+' | '-' | null) ?? null,
        recessiveAttribute: r.recessive_attribute ?? null,
        recessiveSign: (r.recessive_sign as '+' | '-' | null) ?? null,
        breed: r.breed ?? '',
      };
    }
    return map;
  })();
  parsedGenesCache.set(normalized, promise);
  return promise;
}

/**
 * Invalidate cached gene effects (and parsed-genes lookup) for a species.
 * Call after editing genes — the parsed columns travel with the effect
 * strings, so both caches must drop together.
 */
export function clearGeneEffectsCache(species?: string) {
  if (species) {
    const normalized = normalizeSpecies(species);
    geneEffectsCache.delete(normalized);
    parsedGenesCache.delete(normalized);
  } else {
    geneEffectsCache.clear();
    parsedGenesCache.clear();
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
