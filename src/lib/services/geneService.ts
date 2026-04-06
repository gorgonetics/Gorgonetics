/**
 * Gene data service for Gorgonetics.
 */

import { now } from '$lib/utils/timestamp.js';
import { normalizeSpecies } from './configService.js';
import { getDb } from './database.js';

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
 * Update a gene's attributes.
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
  await db.execute(
    `INSERT OR REPLACE INTO genes
     (animal_type, chromosome, gene, effectDominant, effectRecessive, appearance, breed, notes, created_at, updated_at)
     VALUES ($animal_type, $chromosome, $gene, $effectDominant, $effectRecessive, $appearance, $breed, $notes, $created_at, $updated_at)`,
    {
      animal_type: animalType,
      chromosome,
      gene,
      effectDominant: data.effectDominant ?? 'None',
      effectRecessive: data.effectRecessive ?? 'None',
      appearance: data.appearance ?? 'None',
      breed: data.breed ?? '',
      notes: data.notes ?? '',
      created_at: ts,
      updated_at: ts,
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
