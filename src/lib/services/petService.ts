/**
 * Pet data service for Gorgonetics.
 */

import type { Genome, Pet } from '$lib/types/index.js';
import { GENOME_FILE_MARKERS } from '$lib/types/index.js';
import { computeGeneStats } from '$lib/utils/geneAnalysis.js';
import { now } from '$lib/utils/timestamp.js';
import { getDefaultValues, normalizeSpecies } from './configService.js';
import { getDb, reorderRows } from './database.js';
import { getGeneEffectsCached } from './geneService.js';
import { genomeToGeneStrings, isValidGenomeFile, parseGenome } from './genomeParser.js';
import { parseStructuredPetName } from './nameParser.js';
import { getSetting, setSetting } from './settingsService.js';

/**
 * Compute SHA-256 hash of a string.
 */
async function sha256(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Count genes in a genome, categorizing as known vs unknown.
 */
function countGenes(genomeData: unknown): { total: number; known: number; unknown: number } {
  let total = 0;
  let known = 0;
  let unknown = 0;

  if (typeof genomeData === 'string') {
    try {
      genomeData = JSON.parse(genomeData);
    } catch {
      return { total: 0, known: 0, unknown: 0 };
    }
  }

  if (typeof genomeData !== 'object' || genomeData === null) {
    return { total: 0, known: 0, unknown: 0 };
  }

  const data = genomeData as Record<string, unknown>;

  // Standard Genome model structure with Gene objects
  if (data.genes && typeof data.genes === 'object') {
    const genesMap = data.genes as Record<string, unknown[]>;
    for (const chromosomeGenes of Object.values(genesMap)) {
      if (!Array.isArray(chromosomeGenes)) continue;
      for (const gene of chromosomeGenes) {
        if (typeof gene === 'object' && gene !== null) {
          const geneObj = gene as Record<string, unknown>;
          total++;
          const geneType = geneObj.gene_type;
          if (geneType === '?' || (typeof geneType === 'string' && geneType.toUpperCase() === 'UNKNOWN')) {
            unknown++;
          } else {
            known++;
          }
        }
      }
    }
  }

  return { total, known, unknown };
}

/**
 * Count the genes in a genome that confer a confirmed positive attribute
 * effect, using the same logic as `GeneStatsTable`'s totals row. The genes
 * table must be populated (ensured by `populateGenesIfNeeded` at startup).
 */
export async function computePositiveGenesForGenome(
  genomeData: string | Genome,
  breed: string | undefined,
): Promise<number> {
  const genome = typeof genomeData === 'string' ? (JSON.parse(genomeData) as Genome) : genomeData;
  const species = normalizeSpecies(genome.genome_type);
  if (!species) return 0;
  const geneStrings = genomeToGeneStrings(genome);
  const effectsData = await getGeneEffectsCached(species);
  const effectsDB = effectsData ? { [species]: effectsData.effects } : {};
  const { stats } = computeGeneStats(geneStrings, species, effectsDB, breed);
  let total = 0;
  for (const entry of Object.values(stats)) total += entry.positive;
  return total;
}

/** Enrich a raw pet row from the database with computed fields. */
function enrichPet(pet: Record<string, unknown>, tags: string[]): Pet {
  const geneCounts = countGenes(pet.genome_data);
  return {
    ...pet,
    tags,
    starred: Boolean(pet.starred),
    stabled: Boolean(pet.stabled),
    is_pet_quality: Boolean(pet.is_pet_quality),
    positive_genes: Number(pet.positive_genes ?? 0),
    total_genes: geneCounts.total,
    known_genes: geneCounts.known,
    unknown_genes: geneCounts.unknown,
    has_unknown_genes: geneCounts.unknown > 0,
    readonly: false,
    is_demo: false,
  } as Pet;
}

async function loadTagsForPets(petIds: number[]): Promise<Map<number, string[]>> {
  if (petIds.length === 0) return new Map();
  const db = getDb();
  const placeholders = petIds.map(() => '?').join(', ');
  const rows = await db.select<{ pet_id: number; tag: string }[]>(
    `SELECT pet_id, tag FROM pet_tags WHERE pet_id IN (${placeholders}) ORDER BY tag`,
    petIds,
  );
  const map = new Map<number, string[]>();
  for (const row of rows) {
    const arr = map.get(row.pet_id);
    if (arr) arr.push(row.tag);
    else map.set(row.pet_id, [row.tag]);
  }
  return map;
}

async function loadTagsForPet(petId: number): Promise<string[]> {
  const db = getDb();
  const rows = await db.select<{ tag: string }[]>('SELECT tag FROM pet_tags WHERE pet_id = $pet_id ORDER BY tag', {
    pet_id: petId,
  });
  return rows.map((r) => r.tag);
}

/**
 * Get all pets.
 */
export async function getAllPets(options?: {
  species?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: Pet[]; total: number }> {
  const db = getDb();
  const conditions: string[] = [];

  const bindParams: Record<string, unknown> = {};
  if (options?.species) {
    conditions.push('species = $species');
    bindParams.species = options.species;
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

  // Get total count
  const countRows = await db.select<{ cnt: number }[]>(`SELECT COUNT(*) as cnt FROM pets${where}`, bindParams);
  const total = countRows[0].cnt;

  // Get paginated results
  let query = `SELECT * FROM pets${where} ORDER BY sort_order, name`;
  const selectParams = { ...bindParams };
  if (options?.limit !== undefined) {
    query += ' LIMIT $limit OFFSET $offset';
    selectParams.limit = options.limit;
    selectParams.offset = options.offset ?? 0;
  }

  const rows = await db.select<Record<string, unknown>[]>(query, selectParams);
  const tagsMap = await loadTagsForPets(rows.map((r) => r.id as number));
  const items = rows.map((r) => enrichPet(r, tagsMap.get(r.id as number) ?? []));

  return { items, total };
}

/**
 * Get a single pet by ID.
 */
export async function getPet(petId: number): Promise<Pet | null> {
  const db = getDb();
  const rows = await db.select<Record<string, unknown>[]>('SELECT * FROM pets WHERE id = $id', { id: petId });
  if (rows.length === 0) return null;
  const tags = await loadTagsForPet(petId);
  return enrichPet(rows[0], tags);
}

/**
 * Upload and create a new pet from genome file content.
 */
export async function uploadPet(
  content: string,
  name: string,
  gender: string,
  notes?: string,
): Promise<{ status: string; message: string; pet_id?: number; name?: string }> {
  // Validate content
  if (!content.trim()) {
    return { status: 'error', message: 'File cannot be empty' };
  }

  if (!GENOME_FILE_MARKERS.some((marker) => content.includes(marker))) {
    return { status: 'error', message: 'Invalid genome file format' };
  }

  if (!isValidGenomeFile(content)) {
    return { status: 'error', message: 'Invalid genome file format' };
  }

  // Compute hash for duplicate detection
  const contentHash = await sha256(content);

  // Check for duplicate
  const existing = await findPetByHash(contentHash);
  if (existing) {
    return {
      status: 'error',
      message: `This file has already been uploaded as '${existing.name}' on ${existing.created_at}`,
    };
  }

  // Parse the genome
  const genome = parseGenome(content);
  const genomeJson = JSON.stringify(genome, null, 2);

  // Determine pet name
  const petName = genome.name.trim() || name.trim() || 'Unknown Pet';

  const parsed = parseStructuredPetName(petName, genome.genome_type);
  const defaults = getDefaultValues(genome.genome_type);

  const petGender = parsed?.gender ?? gender;
  const petBreed = parsed?.breed ?? '';
  const attrValues = parsed?.attributes ?? defaults;

  const positiveGenes = await computePositiveGenesForGenome(genome, petBreed);

  const db = getDb();
  const ts = now();

  // TODO: This queries all sort_orders per upload, making bulk upload O(N*existing).
  // Same issue as imageService — fix by querying once before the loop.
  const orderRows = await db.select<{ sort_order: number }[]>('SELECT sort_order FROM pets');
  const nextOrder = orderRows.length > 0 ? Math.max(...orderRows.map((r) => r.sort_order ?? 0)) + 1 : 0;

  const result = await db.execute(
    `INSERT INTO pets
     (name, species, gender, breed, breeder, content_hash, genome_data, notes,
      created_at, updated_at,
      intelligence, toughness, friendliness, ruggedness, enthusiasm, virility, ferocity, temperament, sort_order,
      starred, stabled, is_pet_quality, positive_genes)
     VALUES ($name, $species, $gender, $breed, $breeder, $content_hash, $genome_data, $notes,
             $created_at, $updated_at,
             $intelligence, $toughness, $friendliness, $ruggedness, $enthusiasm, $virility, $ferocity, $temperament, $sort_order,
             $starred, $stabled, $is_pet_quality, $positive_genes)`,
    {
      name: petName,
      species: genome.genome_type,
      gender: petGender,
      breed: petBreed,
      breeder: genome.breeder,
      content_hash: contentHash,
      genome_data: genomeJson,
      notes: notes ?? '',
      created_at: ts,
      updated_at: ts,
      intelligence: attrValues.intelligence ?? 50,
      toughness: attrValues.toughness ?? 50,
      friendliness: attrValues.friendliness ?? 50,
      ruggedness: attrValues.ruggedness ?? 50,
      enthusiasm: attrValues.enthusiasm ?? 50,
      virility: attrValues.virility ?? 50,
      ferocity: attrValues.ferocity ?? 50,
      temperament: attrValues.temperament ?? 50,
      sort_order: nextOrder,
      starred: 0,
      stabled: 1,
      is_pet_quality: 0,
      positive_genes: positiveGenes,
    },
  );

  return {
    status: 'success',
    message: 'Pet created successfully',
    pet_id: result.lastInsertId,
    name: petName,
  };
}

/** Columns that callers are allowed to update via updatePet(). */
const UPDATABLE_COLUMNS = new Set([
  'name',
  'gender',
  'breed',
  'notes',
  'genome_data',
  'sort_order',
  'intelligence',
  'toughness',
  'friendliness',
  'ruggedness',
  'enthusiasm',
  'virility',
  'ferocity',
  'temperament',
  'starred',
  'stabled',
  'is_pet_quality',
]);

const BOOLEAN_COLUMNS = new Set(['starred', 'stabled', 'is_pet_quality']);

/**
 * Update a pet record.
 */
export async function updatePet(petId: number, updates: Record<string, unknown>): Promise<boolean> {
  const db = getDb();
  const setClauses: string[] = [];
  const params: Record<string, unknown> = {};

  // Extract tags for junction table handling
  const newTags = updates.tags as string[] | undefined;

  // Flatten nested `attributes` object into top-level fields
  const flat: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(updates)) {
    if (field === 'tags') continue;
    if (field === 'attributes' && typeof value === 'object' && value !== null) {
      Object.assign(flat, value);
    } else {
      flat[field] = value;
    }
  }

  for (const [field, value] of Object.entries(flat)) {
    if (!UPDATABLE_COLUMNS.has(field)) continue;
    setClauses.push(`${field} = $${field}`);
    if (field === 'genome_data' && typeof value !== 'string') {
      params[field] = JSON.stringify(value);
    } else if (BOOLEAN_COLUMNS.has(field)) {
      params[field] = value ? 1 : 0;
    } else {
      params[field] = value;
    }
  }

  // If the genome or breed changed, the stored positive_genes count is stale.
  // Recompute once using the incoming values, falling back to what's in the DB.
  if (flat.genome_data !== undefined || flat.breed !== undefined) {
    const current = await getPet(petId);
    if (current) {
      const nextGenomeData = (params.genome_data as string | undefined) ?? current.genome_data;
      const nextBreed = (flat.breed as string | undefined) ?? current.breed ?? '';
      const positiveGenes = await computePositiveGenesForGenome(nextGenomeData, nextBreed);
      setClauses.push('positive_genes = $positive_genes');
      params.positive_genes = positiveGenes;
    }
  }

  let changed = false;

  if (setClauses.length > 0) {
    setClauses.push('updated_at = $updated_at');
    params.updated_at = now();
    params.w_id = petId;
    await db.execute(`UPDATE pets SET ${setClauses.join(', ')} WHERE id = $w_id`, params);
    changed = true;
  }

  if (newTags !== undefined) {
    await setTagsForPet(petId, newTags);
    if (setClauses.length === 0) {
      await db.execute('UPDATE pets SET updated_at = $updated_at WHERE id = $w_id', {
        updated_at: now(),
        w_id: petId,
      });
    }
    changed = true;
  }

  return changed;
}

async function setTagsForPet(petId: number, tags: string[]): Promise<void> {
  const db = getDb();
  await db.execute('BEGIN');
  try {
    await db.execute('DELETE FROM pet_tags WHERE pet_id = $pet_id', { pet_id: petId });
    for (const tag of tags) {
      const normalized = tag.trim().toLowerCase();
      if (normalized) {
        await db.execute('INSERT OR IGNORE INTO pet_tags (pet_id, tag) VALUES ($pet_id, $tag)', {
          pet_id: petId,
          tag: normalized,
        });
      }
    }
    await db.execute('COMMIT');
  } catch (error) {
    await db.execute('ROLLBACK');
    throw error;
  }
}

/**
 * Delete a pet.
 */
export async function deletePet(petId: number): Promise<boolean> {
  // Clean up image files before deleting the pet row
  const { deleteAllImagesForPet } = await import('./imageService.js');
  await deleteAllImagesForPet(petId);

  const db = getDb();
  const result = await db.execute('DELETE FROM pets WHERE id = $id', { id: petId });
  return result.rowsAffected > 0;
}

/**
 * Find a pet by content hash.
 */
export async function findPetByHash(contentHash: string): Promise<Pet | null> {
  const db = getDb();
  const rows = await db.select<Record<string, unknown>[]>('SELECT * FROM pets WHERE content_hash = $hash', {
    hash: contentHash,
  });
  if (rows.length === 0) return null;
  const tags = await loadTagsForPet(rows[0].id as number);
  return enrichPet(rows[0], tags);
}

/**
 * Get pet genome data formatted for visualization.
 */
export async function getPetGenome(
  petId: number,
): Promise<{ name: string; owner: string; species: string; format: string; genes: Record<string, string> } | null> {
  const pet = await getPet(petId);
  if (!pet) return null;

  // Parse the genome JSON
  let genomeJson: unknown;
  if (typeof pet.genome_data === 'string') {
    genomeJson = JSON.parse(pet.genome_data);
  } else {
    genomeJson = pet.genome_data;
  }

  const genome = genomeJson as Genome;

  return {
    name: pet.name,
    owner: genome.breeder,
    species: genome.genome_type,
    format: genome.format_version,
    genes: genomeToGeneStrings(genome),
  };
}

/**
 * Check if pets table has any data.
 */
export async function hasPets(): Promise<boolean> {
  const db = getDb();
  const rows = await db.select<{ cnt: number }[]>('SELECT COUNT(*) as cnt FROM pets');
  return rows[0].cnt > 0;
}

/**
 * Update sort_order for a list of pets based on their position in the array.
 */
export function reorderPets(orderedIds: number[]): Promise<void> {
  return reorderRows('pets', orderedIds);
}

const POSITIVE_GENES_BACKFILL_KEY = 'pets.positive_genes_backfilled';

/**
 * One-shot backfill that populates positive_genes for every pet using the
 * same logic applied at upload time. Idempotent via a settings-table flag;
 * safe to call on every app startup. Required because the v9 migration only
 * adds the column with a DEFAULT 0 — the actual count depends on the JS-side
 * gene-effects database and cannot be computed in SQL.
 */
export async function backfillPositiveGenesIfNeeded(): Promise<void> {
  const done = await getSetting<boolean>(POSITIVE_GENES_BACKFILL_KEY);
  if (done) return;

  const db = getDb();
  const rows = await db.select<{ id: number; genome_data: string; breed: string | null }[]>(
    'SELECT id, genome_data, breed FROM pets',
  );

  const updates = await Promise.all(
    rows.map(async (row) => {
      try {
        const positive = await computePositiveGenesForGenome(row.genome_data, row.breed ?? '');
        return { id: row.id, positive };
      } catch (e) {
        console.warn(`Backfill failed for pet ${row.id}:`, e);
        return null;
      }
    }),
  );

  await db.execute('BEGIN');
  try {
    for (const update of updates) {
      if (!update) continue;
      await db.execute('UPDATE pets SET positive_genes = $pg WHERE id = $id', {
        pg: update.positive,
        id: update.id,
      });
    }
    await db.execute('COMMIT');
  } catch (e) {
    await db.execute('ROLLBACK');
    throw e;
  }
  await setSetting(POSITIVE_GENES_BACKFILL_KEY, true);
}
