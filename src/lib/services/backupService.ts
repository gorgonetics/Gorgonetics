/**
 * Backup service for Gorgonetics.
 * Exports the full database to JSON and imports from a backup file.
 * Supports two import modes: 'replace' (clear + restore) and 'merge' (skip duplicates).
 */

declare const __APP_VERSION__: string;

import type { GorgonExport, ImportMode } from '$lib/types/index.js';
import { getDb } from './database.js';
import { saveExportFile } from './fileService.js';
import { CURRENT_SCHEMA_VERSION, getSchemaVersion } from './migrationService.js';

const EXPORT_FORMAT = 'gorgonetics-backup' as const;
const EXPORT_FORMAT_VERSION = 1;
const APP_VERSION = __APP_VERSION__;

const GENE_COLUMNS = [
  'animal_type',
  'chromosome',
  'gene',
  'effectDominant',
  'effectRecessive',
  'appearance',
  'breed',
  'notes',
  'created_at',
  'updated_at',
];

const PET_COLUMNS = [
  'name',
  'species',
  'gender',
  'breed',
  'breeder',
  'content_hash',
  'genome_data',
  'notes',
  'created_at',
  'updated_at',
  'intelligence',
  'toughness',
  'friendliness',
  'ruggedness',
  'enthusiasm',
  'virility',
  'ferocity',
  'temperament',
];

/**
 * Export the full database to a JSON file.
 */
export async function exportDatabase(): Promise<boolean> {
  const db = getDb();
  const schemaVersion = await getSchemaVersion();

  const genes = await db.select<Record<string, unknown>[]>(
    'SELECT * FROM genes ORDER BY animal_type, chromosome, gene',
  );
  const pets = await db.select<Record<string, unknown>[]>('SELECT * FROM pets ORDER BY name');

  // Parse genome_data from JSON string to object for readability
  const petsExport = pets.map((pet) => {
    const copy = { ...pet };
    delete copy.id; // Don't export auto-increment IDs
    if (typeof copy.genome_data === 'string') {
      try {
        copy.genome_data = JSON.parse(copy.genome_data as string);
      } catch {
        // Keep as string if not valid JSON
      }
    }
    return copy;
  });

  const backup: GorgonExport = {
    metadata: {
      format: EXPORT_FORMAT,
      format_version: EXPORT_FORMAT_VERSION,
      schema_version: schemaVersion || CURRENT_SCHEMA_VERSION,
      app_version: APP_VERSION,
      exported_at: new Date().toISOString(),
      record_counts: {
        genes: genes.length,
        pets: pets.length,
      },
    },
    data: {
      genes,
      pets: petsExport,
    },
  };

  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `gorgonetics-backup-${dateStr}.json`;
  return saveExportFile(filename, JSON.stringify(backup, null, 2));
}

/**
 * Validate and parse a backup JSON string.
 */
function parseBackup(jsonContent: string): GorgonExport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonContent);
  } catch {
    throw new Error('Invalid JSON file.');
  }

  const backup = parsed as GorgonExport;
  if (!backup?.metadata?.format || backup.metadata.format !== EXPORT_FORMAT) {
    throw new Error('Not a Gorgonetics backup file.');
  }

  if (backup.metadata.format_version > EXPORT_FORMAT_VERSION) {
    throw new Error(
      `This backup was created with a newer version of Gorgonetics (format v${backup.metadata.format_version}). Please update the app.`,
    );
  }

  if (backup.metadata.schema_version > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `This backup uses a newer database schema (v${backup.metadata.schema_version}). Please update the app.`,
    );
  }

  if (!backup.data?.genes || !backup.data?.pets) {
    throw new Error('Backup file is missing data sections.');
  }

  return backup;
}

/**
 * Import a database backup.
 * @param jsonContent - Raw JSON string from the backup file
 * @param mode - 'replace' clears all existing data first; 'merge' keeps existing data and skips duplicate pets
 * @returns Summary of what was imported
 */
export async function importDatabase(
  jsonContent: string,
  mode: ImportMode,
): Promise<{ genes: number; pets: number; skipped: number }> {
  const backup = parseBackup(jsonContent);
  const db = getDb();

  let petsImported = 0;
  let petsSkipped = 0;

  if (mode === 'replace') {
    await db.execute('DELETE FROM pets');
    await db.execute('DELETE FROM genes');
  }

  // Pre-compute SQL strings (invariant across iterations)
  const genePlaceholders = GENE_COLUMNS.map(() => '?').join(', ');
  const geneSQL = `INSERT OR REPLACE INTO genes (${GENE_COLUMNS.join(', ')}) VALUES (${genePlaceholders})`;
  const petPlaceholders = PET_COLUMNS.map(() => '?').join(', ');
  const petSQL = `INSERT INTO pets (${PET_COLUMNS.join(', ')}) VALUES (${petPlaceholders})`;

  for (const gene of backup.data.genes) {
    const values = GENE_COLUMNS.map((col) => gene[col] ?? null);
    await db.execute(geneSQL, values);
  }

  // Pre-fetch existing content hashes for merge dedup (avoids N+1 queries)
  let existingHashes: Set<unknown> | null = null;
  if (mode === 'merge') {
    const rows = await db.select<{ content_hash: string }[]>('SELECT content_hash FROM pets');
    existingHashes = new Set(rows.map((r) => r.content_hash));
  }

  for (const pet of backup.data.pets) {
    if (existingHashes?.has(pet.content_hash)) {
      petsSkipped++;
      continue;
    }

    let genomeData = pet.genome_data;
    if (typeof genomeData === 'object' && genomeData !== null) {
      genomeData = JSON.stringify(genomeData);
    }

    const values = PET_COLUMNS.map((col) => {
      if (col === 'genome_data') return genomeData;
      return pet[col] ?? null;
    });
    await db.execute(petSQL, values);
    petsImported++;
  }

  return { genes: backup.data.genes.length, pets: petsImported, skipped: petsSkipped };
}
