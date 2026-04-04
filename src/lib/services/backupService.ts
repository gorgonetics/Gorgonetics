/**
 * Backup service for Gorgonetics.
 * v2 format: zip archive with selective content (genes, pets, images).
 * v1 format: single JSON file (backward compatible import).
 */

declare const __APP_VERSION__: string;

import JSZip from 'jszip';
import type {
  ExportOptions,
  ExportResult,
  GorgonExportMetadata,
  ImportOptions,
  ImportResult,
} from '$lib/types/index.js';
import { isTauri } from '$lib/utils/environment.js';
import { getDb } from './database.js';
import { saveExportBinaryFile } from './fileService.js';
import { CURRENT_SCHEMA_VERSION, getSchemaVersion } from './migrationService.js';

const EXPORT_FORMAT = 'gorgonetics-backup' as const;
const EXPORT_FORMAT_VERSION = 2;
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

// --- Export ---

export async function exportDatabase(options: ExportOptions): Promise<ExportResult> {
  const db = getDb();
  const schemaVersion = await getSchemaVersion();
  const zip = new JSZip();
  let geneCount = 0;
  let petCount = 0;
  let imageCount = 0;

  if (options.includeGenes) {
    const genes = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM genes ORDER BY animal_type, chromosome, gene',
    );
    zip.file('genes.json', JSON.stringify(genes));
    geneCount = genes.length;
  }

  let petsExport: Record<string, unknown>[] = [];
  if (options.includePets || options.includeImages) {
    const pets = await db.select<Record<string, unknown>[]>('SELECT * FROM pets ORDER BY name');
    petsExport = pets.map((pet) => {
      const copy = { ...pet };
      delete copy.id;
      if (typeof copy.genome_data === 'string') {
        try {
          copy.genome_data = JSON.parse(copy.genome_data as string);
        } catch {
          /* keep as string */
        }
      }
      return copy;
    });
    if (options.includePets) {
      zip.file('pets.json', JSON.stringify(petsExport));
      petCount = petsExport.length;
    }
  }

  if (options.includeImages) {
    const imageRows = await db.select<Record<string, unknown>[]>(
      'SELECT pi.*, p.content_hash FROM pet_images pi JOIN pets p ON pi.pet_id = p.id ORDER BY pi.pet_id, pi.created_at',
    );

    // Export image metadata with content_hash instead of pet_id
    const imageMetadata = imageRows.map((row) => ({
      content_hash: row.content_hash,
      filename: row.filename,
      original_name: row.original_name,
      caption: row.caption ?? '',
      tags: row.tags ?? '[]',
      created_at: row.created_at,
    }));
    zip.file('images/pet_images.json', JSON.stringify(imageMetadata));

    // Copy actual image files into the zip
    if (isTauri()) {
      const { readFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      for (const row of imageRows) {
        const relativePath = `images/${row.pet_id}/${row.filename}`;
        try {
          const data = await readFile(relativePath, { baseDir: BaseDirectory.AppData });
          zip.file(`images/${row.content_hash}/${row.filename}`, data);
          imageCount++;
        } catch {
          // Skip missing files
        }
      }
    }
  }

  const now = new Date();
  const metadata: GorgonExportMetadata = {
    format: EXPORT_FORMAT,
    format_version: EXPORT_FORMAT_VERSION,
    schema_version: schemaVersion || CURRENT_SCHEMA_VERSION,
    app_version: APP_VERSION,
    exported_at: now.toISOString(),
    contents: {
      genes: options.includeGenes,
      pets: options.includePets,
      images: options.includeImages,
    },
    record_counts: { genes: geneCount, pets: petCount, images: imageCount },
  };
  zip.file('metadata.json', JSON.stringify(metadata, null, 2));

  const zipData = await zip.generateAsync({ type: 'uint8array' });
  const dateStr = now.toISOString().split('T')[0];
  const saved = await saveExportBinaryFile(`gorgonetics-backup-${dateStr}.zip`, zipData);

  return { saved, genes: geneCount, pets: petCount, images: imageCount };
}

// --- Import ---

export async function inspectBackup(fileData: Uint8Array): Promise<GorgonExportMetadata> {
  const zip = await JSZip.loadAsync(fileData);
  const metaFile = zip.file('metadata.json');
  if (!metaFile) throw new Error('Backup archive is missing metadata.json.');
  const metaJson = await metaFile.async('string');
  const metadata = JSON.parse(metaJson) as GorgonExportMetadata;
  if (metadata.format !== EXPORT_FORMAT) throw new Error('Not a Gorgonetics backup file.');
  if (metadata.format_version > EXPORT_FORMAT_VERSION) {
    throw new Error(
      `This backup was created with a newer version of Gorgonetics (format v${metadata.format_version}). Please update the app.`,
    );
  }
  return metadata;
}

export async function importDatabase(fileData: Uint8Array, options: ImportOptions): Promise<ImportResult> {
  return importFromZip(fileData, options);
}

/** Shared gene/pet import logic used by both v1 and v2 paths. */
async function importGenesAndPets(
  genes: Record<string, unknown>[] | null,
  pets: Record<string, unknown>[] | null,
  options: ImportOptions,
): Promise<{ genes: number; pets: number; petsSkipped: number }> {
  const db = getDb();
  let genesImported = 0;
  let petsImported = 0;
  let petsSkipped = 0;

  const genePlaceholders = GENE_COLUMNS.map((col) => `$${col}`).join(', ');
  const geneSQL = `INSERT OR REPLACE INTO genes (${GENE_COLUMNS.join(', ')}) VALUES (${genePlaceholders})`;
  const petPlaceholders = PET_COLUMNS.map((col) => `$${col}`).join(', ');
  const petSQL = `INSERT INTO pets (${PET_COLUMNS.join(', ')}) VALUES (${petPlaceholders})`;

  let existingHashes: Set<string> | null = null;
  if (options.mode === 'merge') {
    const rows = await db.select<{ content_hash: string }[]>('SELECT content_hash FROM pets');
    existingHashes = new Set(rows.map((r) => r.content_hash));
  }

  await db.execute('BEGIN');
  try {
    if (options.mode === 'replace') {
      if (options.includeGenes) await db.execute('DELETE FROM genes');
      if (options.includePets) {
        await db.execute('DELETE FROM pet_images');
        await db.execute('DELETE FROM pets');
      }
    }

    if (options.includeGenes && genes) {
      for (const gene of genes) {
        const params: Record<string, unknown> = {};
        for (const col of GENE_COLUMNS) params[col] = gene[col] ?? null;
        await db.execute(geneSQL, params);
      }
      genesImported = genes.length;
    }

    if (options.includePets && pets) {
      for (const pet of pets) {
        if (existingHashes?.has(pet.content_hash as string)) {
          petsSkipped++;
          continue;
        }
        let genomeData = pet.genome_data;
        if (typeof genomeData === 'object' && genomeData !== null) genomeData = JSON.stringify(genomeData);
        const params: Record<string, unknown> = {};
        for (const col of PET_COLUMNS) params[col] = col === 'genome_data' ? genomeData : (pet[col] ?? null);
        await db.execute(petSQL, params);
        petsImported++;
      }
    }

    await db.execute('COMMIT');
  } catch (error) {
    await db.execute('ROLLBACK');
    throw error;
  }

  return { genes: genesImported, pets: petsImported, petsSkipped };
}

async function importFromZip(fileData: Uint8Array, options: ImportOptions): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(fileData);

  // Extract data from zip
  let genes: Record<string, unknown>[] | null = null;
  let pets: Record<string, unknown>[] | null = null;

  if (options.includeGenes) {
    const genesFile = zip.file('genes.json');
    if (genesFile) genes = JSON.parse(await genesFile.async('string'));
  }

  if (options.includePets) {
    const petsFile = zip.file('pets.json');
    if (petsFile) pets = JSON.parse(await petsFile.async('string'));
  }

  const result = await importGenesAndPets(genes, pets, options);
  let imagesImported = 0;
  let imagesSkipped = 0;

  // Import images (after transaction so pet IDs are available)
  if (options.includeImages) {
    const petImagesFile = zip.file('images/pet_images.json');
    if (petImagesFile && isTauri()) {
      const { writeFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      const db = getDb();

      const imageRecords = JSON.parse(await petImagesFile.async('string')) as Record<string, unknown>[];

      const allPets = await db.select<{ id: number; content_hash: string }[]>('SELECT id, content_hash FROM pets');
      const hashToId = new Map(allPets.map((p) => [p.content_hash, p.id]));

      // Pre-fetch existing images for merge dedup
      let existingImageKeys: Set<string> | null = null;
      if (options.mode === 'merge') {
        const rows = await db.select<{ pet_id: number; filename: string }[]>('SELECT pet_id, filename FROM pet_images');
        existingImageKeys = new Set(rows.map((r) => `${r.pet_id}:${r.filename}`));
      }

      for (const record of imageRecords) {
        const contentHash = record.content_hash as string;
        const petId = hashToId.get(contentHash);
        if (!petId) {
          imagesSkipped++;
          continue;
        }

        const filename = record.filename as string;
        const zipPath = `images/${contentHash}/${filename}`;
        const zipEntry = zip.file(zipPath);
        if (!zipEntry) {
          imagesSkipped++;
          continue;
        }

        if (existingImageKeys?.has(`${petId}:${filename}`)) {
          imagesSkipped++;
          continue;
        }

        // Write file to disk
        const relativeDir = `images/${petId}`;
        await mkdir(relativeDir, { baseDir: BaseDirectory.AppData, recursive: true });
        const fileData = await zipEntry.async('uint8array');
        await writeFile(`${relativeDir}/${filename}`, fileData, { baseDir: BaseDirectory.AppData });

        // Insert DB record
        await db.execute(
          `INSERT INTO pet_images (pet_id, filename, original_name, caption, tags, created_at)
           VALUES ($pet_id, $filename, $original_name, $caption, $tags, $created_at)`,
          {
            pet_id: petId,
            filename,
            original_name: record.original_name ?? filename,
            caption: record.caption ?? '',
            tags: typeof record.tags === 'string' ? record.tags : JSON.stringify(record.tags ?? []),
            created_at: record.created_at ?? new Date().toISOString(),
          },
        );
        imagesImported++;
      }
    }
  }

  return { ...result, images: imagesImported, imagesSkipped };
}
