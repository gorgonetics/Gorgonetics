/**
 * Pet data service for Gorgonetics.
 */

import type { GeneStatsEntry, Genome, Pet } from '$lib/types/index.js';
import { GENOME_FILE_MARKERS } from '$lib/types/index.js';
import { yieldToUI } from '$lib/utils/async.js';
import { fromGeneId, type ParsedChromosome, type ParsedGene, toGeneId } from '$lib/utils/geneAnalysis.js';
import { capitalize } from '$lib/utils/string.js';
import { now } from '$lib/utils/timestamp.js';
import { getAttributeConfig, getDefaultValues, normalizeSpecies } from './configService.js';
import { getDb, reorderRows, type TxStatement, withTransaction } from './database.js';
import { getParsedGenesCached, isHorseBreedFiltered } from './geneService.js';
import { compareBlockLetters, genomeToGeneStrings, isValidGenomeFile, parseGenome } from './genomeParser.js';
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

type GeneCountSummary = { total: number; known: number; unknown: number };

const EMPTY_GENE_COUNTS: GeneCountSummary = { total: 0, known: 0, unknown: 0 };

/** Count total / known / unknown genes from a parsed Genome. */
function countGenesFromGenome(genome: Genome): GeneCountSummary {
  let total = 0;
  let known = 0;
  let unknown = 0;
  for (const chrGenes of Object.values(genome.genes ?? {})) {
    if (!Array.isArray(chrGenes)) continue;
    for (const g of chrGenes) {
      if (!g || typeof g !== 'object') continue;
      total++;
      const t = g.gene_type;
      if (t === '?' || (typeof t === 'string' && t.toUpperCase() === 'UNKNOWN')) unknown++;
      else known++;
    }
  }
  return { total, known, unknown };
}

/** Count genes in a genome (string or parsed). Returns zeros on malformed input. */
function countGenes(genomeData: unknown): GeneCountSummary {
  try {
    const parsed: unknown = typeof genomeData === 'string' ? JSON.parse(genomeData) : genomeData;
    if (!parsed || typeof parsed !== 'object') return EMPTY_GENE_COUNTS;
    return countGenesFromGenome(parsed as Genome);
  } catch {
    return EMPTY_GENE_COUNTS;
  }
}

/** Build an empty stats entry — exported so the comparison view can fall back on it. */
export function emptyStatsEntry(): GeneStatsEntry {
  return { positive: 0, negative: 0, dominant: 0, recessive: 0, mixed: 0 };
}

/**
 * Count the genes in a genome that confer a confirmed positive attribute
 * effect. Returns 0 on malformed input — upload/update can't abort on a
 * single bad row.
 */
export async function computePositiveGenesForGenome(
  genomeData: string | Genome,
  breed: string | undefined,
): Promise<number> {
  try {
    const parsed: unknown = typeof genomeData === 'string' ? JSON.parse(genomeData) : genomeData;
    if (!parsed || typeof parsed !== 'object') return 0;
    const genome = parsed as Genome;
    const species = normalizeSpecies(genome.genome_type);
    if (!species) return 0;
    const parsedGenes = await getParsedGenesCached(species);
    let count = 0;
    for (const chrGenes of Object.values(genome.genes ?? {})) {
      if (!Array.isArray(chrGenes)) continue;
      for (const g of chrGenes) {
        if (!g || typeof g !== 'object') continue;
        const type = g.gene_type;
        if (!type || type === '?') continue;
        const gd = parsedGenes[toGeneId(g)];
        if (!gd) continue;
        if (isHorseBreedFiltered(species, breed, gd.breed)) continue;
        const sign = type === 'R' ? gd.recessiveSign : gd.dominantSign;
        if (sign === '+') count++;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

async function selectPetGenesRows(petId: number): Promise<{ gene_id: string; gene_type: string }[]> {
  return getDb().select<{ gene_id: string; gene_type: string }[]>(
    'SELECT gene_id, gene_type FROM pet_genes WHERE pet_id = $pid',
    { pid: petId },
  );
}

/**
 * Populate `pet_genes` for a single pet from its `genome_data`. Used as
 * a fallback for pets uploaded before the projection existed and not
 * yet reached by the startup backfill — without this, the visualizer
 * would render empty for those pets.
 */
async function ensurePetGenesPopulated(petId: number): Promise<boolean> {
  const db = getDb();
  const rows = await db.select<{ genome_data: string }[]>('SELECT genome_data FROM pets WHERE id = $id', { id: petId });
  if (rows.length === 0) return false;
  let genome: Genome;
  try {
    genome = JSON.parse(rows[0].genome_data) as Genome;
  } catch {
    return false;
  }
  await withTransaction(() => writePetGenes(petId, genome));
  return true;
}

/**
 * Load a pet's grid from `pet_genes`, returning the same structure
 * `parseGenesByBlock` produces from genome JSON. The visualizer uses
 * this as its canonical source of grid data — no `genome_data` parse
 * on the read path.
 *
 * Block ordering matches `blockLetter`: shorter strings before longer,
 * lex within length (A, B, ..., Z, AA, AB, ...). Chromosomes sort by
 * numeric value, positions ascend within a block. `globalPosition` is
 * assigned in iteration order to match `parseGenesByBlock` exactly.
 *
 * If `pet_genes` is empty for a pet that does exist (un-backfilled
 * legacy row), this populates it inline and retries — so the visualizer
 * never sees a phantom empty grid for an otherwise-valid pet.
 */
export async function loadPetGridFromDb(petId: number): Promise<Record<string, ParsedChromosome>> {
  let rows = await selectPetGenesRows(petId);
  if (rows.length === 0 && (await ensurePetGenesPopulated(petId))) {
    rows = await selectPetGenesRows(petId);
  }

  type RawGene = { id: string; type: string; position: number };
  const byChromosome = new Map<string, Map<string, RawGene[]>>();

  for (const row of rows) {
    const parsed = fromGeneId(row.gene_id);
    if (!parsed) continue;
    let chrMap = byChromosome.get(parsed.chromosome);
    if (!chrMap) {
      chrMap = new Map();
      byChromosome.set(parsed.chromosome, chrMap);
    }
    let blockGenes = chrMap.get(parsed.block);
    if (!blockGenes) {
      blockGenes = [];
      chrMap.set(parsed.block, blockGenes);
    }
    blockGenes.push({ id: row.gene_id, type: row.gene_type, position: parsed.position });
  }

  const sortedChromosomes = [...byChromosome.keys()].sort((a, b) => Number(a) - Number(b));
  const result: Record<string, ParsedChromosome> = {};

  for (const chromosome of sortedChromosomes) {
    const chrMap = byChromosome.get(chromosome);
    if (!chrMap) continue;
    const sortedBlockLetters = [...chrMap.keys()].sort(compareBlockLetters);

    const allGenes: ParsedGene[] = [];
    const blocks: Array<{ letter: string; genes: ParsedGene[] }> = [];

    for (const letter of sortedBlockLetters) {
      const blockRaw = chrMap.get(letter);
      if (!blockRaw) continue;
      blockRaw.sort((a, b) => a.position - b.position);
      const blockGenes: ParsedGene[] = [];
      for (const g of blockRaw) {
        const gene: ParsedGene = {
          id: g.id,
          type: g.type,
          block: letter,
          position: g.position,
          globalPosition: allGenes.length + 1,
        };
        blockGenes.push(gene);
        allGenes.push(gene);
      }
      blocks.push({ letter, genes: blockGenes });
    }

    result[chromosome] = { blocks, allGenes };
  }

  return result;
}

/**
 * Per-attribute gene stats for one pet, aggregated from pet_genes against
 * the cached parsed-effect columns. Breed-mismatched horse genes count
 * toward `totalGenes` but contribute to neither `stats` nor `neutralGenes`.
 */
export async function getPetGeneStats(
  petId: number,
  species: string,
  breed?: string,
): Promise<{ stats: Record<string, GeneStatsEntry>; totalGenes: number; neutralGenes: number }> {
  const speciesKey = normalizeSpecies(species);
  const db = getDb();
  const rows = await db.select<{ gene_id: string; gene_type: string }[]>(
    'SELECT gene_id, gene_type FROM pet_genes WHERE pet_id = $pid',
    { pid: petId },
  );
  const parsedGenes = await getParsedGenesCached(speciesKey);
  const stats: Record<string, GeneStatsEntry> = {};
  for (const attr of getAttributeConfig(speciesKey).attributes) {
    stats[attr.key] = emptyStatsEntry();
  }

  let totalGenes = 0;
  let neutralGenes = 0;

  for (const row of rows) {
    if (row.gene_type === '?') continue;
    totalGenes++;

    const gd = parsedGenes[row.gene_id];

    if (isHorseBreedFiltered(speciesKey, breed, gd?.breed)) continue;

    const isRecessive = row.gene_type === 'R';
    const attribute = isRecessive ? gd?.recessiveAttribute : gd?.dominantAttribute;
    const sign = isRecessive ? gd?.recessiveSign : gd?.dominantSign;

    const entry = attribute ? stats[capitalize(attribute)] : undefined;
    if (!entry || !sign) {
      neutralGenes++;
      continue;
    }

    if (sign === '+') entry.positive++;
    else entry.negative++;
    if (row.gene_type === 'D') entry.dominant++;
    else if (row.gene_type === 'R') entry.recessive++;
    else if (row.gene_type === 'x') entry.mixed++;
  }

  return { stats, totalGenes, neutralGenes };
}

/** Enrich a raw pet row from the database with computed fields. */
function enrichPet(pet: Record<string, unknown>, tags: string[]): Pet {
  const unknownGenes = Number(pet.unknown_genes ?? 0);
  return {
    ...pet,
    tags,
    starred: Boolean(pet.starred),
    stabled: Boolean(pet.stabled),
    is_pet_quality: Boolean(pet.is_pet_quality),
    positive_genes: Number(pet.positive_genes ?? 0),
    total_genes: Number(pet.total_genes ?? 0),
    known_genes: Number(pet.known_genes ?? 0),
    unknown_genes: unknownGenes,
    has_unknown_genes: unknownGenes > 0,
    readonly: false,
    is_demo: false,
  } as Pet;
}

async function loadTagsForPets(petIds: number[]): Promise<Map<number, string[]>> {
  if (petIds.length === 0) return new Map();
  const db = getDb();
  const placeholders = petIds.map((_, i) => `$id${i}`).join(', ');
  const params: Record<string, unknown> = {};
  petIds.forEach((id, i) => {
    params[`id${i}`] = id;
  });
  const rows = await db.select<{ pet_id: number; tag: string }[]>(
    `SELECT pet_id, tag FROM pet_tags WHERE pet_id IN (${placeholders}) ORDER BY tag`,
    params,
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
  const geneCounts = countGenesFromGenome(genome);

  const db = getDb();
  const ts = now();

  // TODO: This queries all sort_orders per upload, making bulk upload O(N*existing).
  // Same issue as imageService — fix by querying once before the loop.
  const orderRows = await db.select<{ sort_order: number }[]>('SELECT sort_order FROM pets');
  const nextOrder = orderRows.length > 0 ? Math.max(...orderRows.map((r) => r.sort_order ?? 0)) + 1 : 0;

  // Atomic with the pet_genes projection: a half-written pet (row in
  // `pets` but no rows in `pet_genes`) would block retries via the
  // UNIQUE content_hash and skew gene-stats reads.
  const result = await withTransaction(async () => {
    const res = await db.execute(
      `INSERT INTO pets
       (name, species, gender, breed, breeder, content_hash, genome_data, notes,
        created_at, updated_at,
        intelligence, toughness, friendliness, ruggedness, enthusiasm, virility, ferocity, temperament, sort_order,
        starred, stabled, is_pet_quality, positive_genes, total_genes, known_genes, unknown_genes)
       VALUES ($name, $species, $gender, $breed, $breeder, $content_hash, $genome_data, $notes,
               $created_at, $updated_at,
               $intelligence, $toughness, $friendliness, $ruggedness, $enthusiasm, $virility, $ferocity, $temperament, $sort_order,
               $starred, $stabled, $is_pet_quality, $positive_genes, $total_genes, $known_genes, $unknown_genes)`,
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
        total_genes: geneCounts.total,
        known_genes: geneCounts.known,
        unknown_genes: geneCounts.unknown,
      },
    );
    if (res.lastInsertId) {
      await writePetGenes(res.lastInsertId, genome);
    }
    return res;
  });

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

  // If the genome or breed changed, the stored positive_genes count is
  // stale. Parse the next genome once and reuse for the downstream
  // positive_genes recompute and pet_genes rewrite.
  let nextGenome: Genome | null = null;
  if (flat.genome_data !== undefined || flat.breed !== undefined) {
    const current = await getPet(petId);
    if (current) {
      const nextGenomeData = (params.genome_data as string | undefined) ?? current.genome_data;
      const nextBreed = (flat.breed as string | undefined) ?? current.breed ?? '';
      try {
        nextGenome = JSON.parse(nextGenomeData) as Genome;
      } catch {
        nextGenome = null;
      }
      const positiveGenes = await computePositiveGenesForGenome(nextGenome ?? nextGenomeData, nextBreed);
      setClauses.push('positive_genes = $positive_genes');
      params.positive_genes = positiveGenes;

      if (flat.genome_data !== undefined) {
        const counts = nextGenome ? countGenesFromGenome(nextGenome) : EMPTY_GENE_COUNTS;
        setClauses.push('total_genes = $total_genes', 'known_genes = $known_genes', 'unknown_genes = $unknown_genes');
        params.total_genes = counts.total;
        params.known_genes = counts.known;
        params.unknown_genes = counts.unknown;
      }
    }
  }

  let changed = false;

  const wantsPetsUpdate = setClauses.length > 0;
  const wantsPetGenesRewrite = flat.genome_data !== undefined && nextGenome !== null;

  if (wantsPetsUpdate || wantsPetGenesRewrite) {
    // Atomic: if the pet_genes rewrite fails the pets UPDATE rolls back
    // too, so readers never see `genome_data` out of sync with the
    // projection in `pet_genes`.
    await withTransaction(async () => {
      if (wantsPetsUpdate) {
        setClauses.push('updated_at = $updated_at');
        params.updated_at = now();
        params.w_id = petId;
        await db.execute(`UPDATE pets SET ${setClauses.join(', ')} WHERE id = $w_id`, params);
      }
      if (wantsPetGenesRewrite && nextGenome) {
        await writePetGenes(petId, nextGenome);
      }
    });
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
  // The in-memory test adapter doesn't honour the FK cascade — explicit
  // DELETE keeps test behaviour aligned with real SQLite.
  await db.execute('DELETE FROM pet_genes WHERE pet_id = $id', { id: petId });
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
 * Replace a pet's rows in `pet_genes` with one row per genome position.
 * Atomic via `db.transaction` — readers never see a half-populated
 * genome even if a chunk fails midway.
 */
async function writePetGenes(petId: number, genome: Genome): Promise<void> {
  const entries: Array<{ geneId: string; geneType: string }> = [];
  for (const chrGenes of Object.values(genome.genes)) {
    for (const g of chrGenes) {
      entries.push({ geneId: toGeneId(g), geneType: g.gene_type });
    }
  }

  const statements: TxStatement[] = [{ sql: 'DELETE FROM pet_genes WHERE pet_id = $pid', params: { pid: petId } }];

  // Multi-row INSERT collapses ~500 IPC calls per pet to a few. Chunked
  // at 300 rows × 3 params = 900 to stay under SQLite's default
  // SQLITE_MAX_VARIABLE_NUMBER=999 on older builds.
  const CHUNK = 300;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK);
    const placeholders = chunk.map((_, j) => `($p${j}, $g${j}, $t${j})`).join(', ');
    const params: Record<string, unknown> = {};
    chunk.forEach((e, j) => {
      params[`p${j}`] = petId;
      params[`g${j}`] = e.geneId;
      params[`t${j}`] = e.geneType;
    });
    statements.push({
      sql: `INSERT INTO pet_genes (pet_id, gene_id, gene_type) VALUES ${placeholders}`,
      params,
    });
  }

  await getDb().transaction(statements);
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
 * Populate `pet_genes` for any pet whose genome hasn't been projected into
 * rows yet. Runs at startup off the critical path. Data-driven — a pet
 * appears in the work set when no `pet_genes` row references it, so a
 * backup-restore that rewrites pets without touching pet_genes self-heals.
 *
 * Returns `true` if any rows were written so the caller can decide
 * whether to refresh downstream stores.
 */
export async function backfillPetGenesIfNeeded(): Promise<boolean> {
  const db = getDb();
  // Two simple queries + a Set diff, instead of a NOT EXISTS subquery —
  // the in-memory test adapter's WHERE parser only understands plain
  // `col = ?`, so a JOIN/subquery predicate is silently ignored there.
  const allPets = await db.select<{ id: number; genome_data: string }[]>('SELECT id, genome_data FROM pets');
  if (allPets.length === 0) return false;
  const existing = await db.select<{ pet_id: number }[]>('SELECT pet_id FROM pet_genes');
  const populated = new Set(existing.map((r) => r.pet_id));
  const pending = allPets.filter((p) => !populated.has(p.id));
  if (pending.length === 0) return false;

  console.info(`pet_genes backfill: ${pending.length} pets need populating`);

  const BATCH = 8;
  let wrote = false;
  for (let i = 0; i < pending.length; i += BATCH) {
    const slice = pending.slice(i, i + BATCH);
    for (const row of slice) {
      try {
        const genome = JSON.parse(row.genome_data) as Genome;
        await withTransaction(() => writePetGenes(row.id, genome));
        wrote = true;
      } catch (e) {
        console.warn(`pet_genes backfill: failed for pet ${row.id}`, e);
      }
    }
    const processed = Math.min(i + BATCH, pending.length);
    console.info(`pet_genes backfill: ${processed}/${pending.length}`);
    await yieldToUI();
  }

  console.info('pet_genes backfill: done');
  return wrote;
}

/**
 * One-shot backfill that populates positive_genes for every pet using the
 * same logic applied at upload time. Idempotent via a settings-table flag.
 * Processes pets in small batches with a yield between each so the main
 * thread stays responsive — callers should not await this on the critical
 * startup path. Required because the v9 migration only adds the column with
 * a DEFAULT 0; the real count depends on the JS-side gene-effects DB.
 */
export async function backfillPositiveGenesIfNeeded(): Promise<void> {
  const done = await getSetting<boolean>(POSITIVE_GENES_BACKFILL_KEY);
  if (done) return;

  const db = getDb();
  const rows = await db.select<{ id: number; genome_data: string; breed: string | null }[]>(
    'SELECT id, genome_data, breed FROM pets',
  );

  if (rows.length === 0) {
    await setSetting(POSITIVE_GENES_BACKFILL_KEY, true);
    return;
  }

  console.info(`positive_genes backfill: starting for ${rows.length} pets`);

  const BATCH = 8;
  const updates: { id: number; positive: number }[] = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const batch = await Promise.all(
      slice.map(async (row) => {
        try {
          const positive = await computePositiveGenesForGenome(row.genome_data, row.breed ?? '');
          return { id: row.id, positive };
        } catch (e) {
          console.warn(`positive_genes backfill: failed for pet ${row.id}`, e);
          return null;
        }
      }),
    );
    for (const u of batch) {
      if (u) updates.push(u);
    }
    const processed = Math.min(i + BATCH, rows.length);
    console.info(`positive_genes backfill: ${processed}/${rows.length} computed`);
    await yieldToUI();
  }

  await db.execute('BEGIN');
  try {
    for (const update of updates) {
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
  console.info('positive_genes backfill: done');
}

const GENE_COUNTS_BACKFILL_KEY = 'pets.gene_counts_backfilled';

/**
 * One-shot backfill that populates total_genes/known_genes/unknown_genes
 * for existing pets — the v11 migration only adds the columns with
 * DEFAULT 0. Idempotent via a settings flag. Non-blocking, batched, with
 * yields between batches so the UI stays responsive.
 */
export async function backfillGeneCountsIfNeeded(): Promise<boolean> {
  const done = await getSetting<boolean>(GENE_COUNTS_BACKFILL_KEY);
  if (done) return false;

  const db = getDb();
  const rows = await db.select<
    { id: number; genome_data: string; total_genes: number; known_genes: number; unknown_genes: number }[]
  >('SELECT id, genome_data, total_genes, known_genes, unknown_genes FROM pets');

  if (rows.length === 0) {
    await setSetting(GENE_COUNTS_BACKFILL_KEY, true);
    return false;
  }

  console.info(`gene_counts backfill: starting for ${rows.length} pets`);

  const updates: { id: number; counts: GeneCountSummary }[] = [];
  const BATCH = 16;
  for (let i = 0; i < rows.length; i += BATCH) {
    for (const row of rows.slice(i, i + BATCH)) {
      const counts = countGenes(row.genome_data);
      const cur = { total: row.total_genes ?? 0, known: row.known_genes ?? 0, unknown: row.unknown_genes ?? 0 };
      if (counts.total === cur.total && counts.known === cur.known && counts.unknown === cur.unknown) continue;
      updates.push({ id: row.id, counts });
    }
    const processed = Math.min(i + BATCH, rows.length);
    console.info(`gene_counts backfill: ${processed}/${rows.length} scanned, ${updates.length} need update`);
    await yieldToUI();
  }

  if (updates.length === 0) {
    await setSetting(GENE_COUNTS_BACKFILL_KEY, true);
    console.info('gene_counts backfill: nothing to write');
    return false;
  }

  for (let i = 0; i < updates.length; i += BATCH) {
    const slice = updates.slice(i, i + BATCH);
    await withTransaction(async () => {
      for (const u of slice) {
        await db.execute('UPDATE pets SET total_genes = $t, known_genes = $k, unknown_genes = $u WHERE id = $id', {
          t: u.counts.total,
          k: u.counts.known,
          u: u.counts.unknown,
          id: u.id,
        });
      }
    });
    const processed = Math.min(i + BATCH, updates.length);
    console.info(`gene_counts backfill: ${processed}/${updates.length} written`);
    if (processed < updates.length) await yieldToUI();
  }

  await setSetting(GENE_COUNTS_BACKFILL_KEY, true);
  console.info('gene_counts backfill: done');
  return true;
}
