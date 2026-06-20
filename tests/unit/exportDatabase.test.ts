import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Issue #92: exportDatabase streams images natively under Tauri (never loading
// them into the JS heap) and falls back to an in-memory JSZip build in the
// browser/test environment. These tests cover both branches and the existence
// filtering / count reconciliation around the native write_zip command.

const isTauri = vi.fn();
vi.mock('$lib/utils/environment.js', () => ({ isTauri: () => isTauri() }));

const select = vi.fn();
vi.mock('$lib/services/database.js', () => ({ getDb: () => ({ select }) }));

vi.mock('$lib/services/migrationService.js', () => ({
  CURRENT_SCHEMA_VERSION: 14,
  getSchemaVersion: () => Promise.resolve(14),
}));

const pickExportSavePath = vi.fn();
const saveExportBinaryFile = vi.fn();
vi.mock('$lib/services/fileService.js', () => ({
  pickExportSavePath: (...a: unknown[]) => pickExportSavePath(...a),
  saveExportBinaryFile: (...a: unknown[]) => saveExportBinaryFile(...a),
}));

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

const exists = vi.fn();
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: (...a: unknown[]) => exists(...a),
  BaseDirectory: { AppData: 'AppData' },
}));

import { exportDatabase } from '$lib/services/backupService.js';

const GENES = [{ animal_type: 'BeeWasp', chromosome: 'chr01', gene: '01A1' }];
const PETS = [{ id: 1, name: 'TestBee', content_hash: 'hash_abc', genome_data: '{"genes":{}}' }];
const IMAGE_ROWS = [
  { pet_id: 1, filename: 'a.png', content_hash: 'hash_abc', original_name: 'a.png', created_at: '2026-01-01' },
  { pet_id: 1, filename: 'b.png', content_hash: 'hash_abc', original_name: 'b.png', created_at: '2026-01-01' },
];

// Route db.select() by the SQL it receives.
function defaultSelect(sql: string) {
  if (sql.includes('FROM genes')) return Promise.resolve(GENES);
  if (sql.includes('FROM pets ORDER BY name')) return Promise.resolve(PETS);
  if (sql.includes('FROM pet_tags')) return Promise.resolve([{ content_hash: 'hash_abc', tag: 'starter' }]);
  if (sql.includes('FROM pet_images')) return Promise.resolve(IMAGE_ROWS);
  return Promise.resolve([]);
}

const ALL = { includeGenes: true, includePets: true, includeImages: true };

beforeEach(() => {
  select.mockImplementation(defaultSelect);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('exportDatabase — browser fallback', () => {
  beforeEach(() => {
    isTauri.mockReturnValue(false);
    saveExportBinaryFile.mockResolvedValue(true);
  });

  it('builds an in-memory zip with the JSON members and no image files', async () => {
    const result = await exportDatabase(ALL);

    expect(invoke).not.toHaveBeenCalled();
    expect(saveExportBinaryFile).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ saved: true, genes: 1, pets: 1, images: 0 });

    const [, data] = saveExportBinaryFile.mock.calls[0];
    const zip = await JSZip.loadAsync(data);
    expect(zip.file('genes.json')).toBeTruthy();
    expect(zip.file('pets.json')).toBeTruthy();
    expect(zip.file('pet_tags.json')).toBeTruthy();
    expect(zip.file('images/pet_images.json')).toBeTruthy();
    // No filesystem in the browser path, so no image members are streamed in.
    expect(await zip.file('images/pet_images.json')!.async('string')).toBe('[]');
    expect(zip.file('images/hash_abc/a.png')).toBeNull();
  });

  it('reports not-saved when the browser save is declined', async () => {
    saveExportBinaryFile.mockResolvedValue(false);
    const result = await exportDatabase(ALL);
    expect(result.saved).toBe(false);
  });
});

describe('exportDatabase — native streaming path', () => {
  beforeEach(() => {
    isTauri.mockReturnValue(true);
    pickExportSavePath.mockResolvedValue('/tmp/backup.zip');
    exists.mockResolvedValue(true);
    invoke.mockResolvedValue({ images_written: 2, images_skipped: [] });
  });

  it('invokes write_zip with text + file entries and reports the written count', async () => {
    const result = await exportDatabase(ALL);

    expect(saveExportBinaryFile).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
    const [command, args] = invoke.mock.calls[0];
    expect(command).toBe('write_zip');
    expect(args.outputPath).toBe('/tmp/backup.zip');

    const textPaths = args.textEntries.map((e: { archive_path: string }) => e.archive_path);
    expect(textPaths).toEqual(
      expect.arrayContaining(['genes.json', 'pets.json', 'pet_tags.json', 'images/pet_images.json', 'metadata.json']),
    );
    // Images are passed as path pairs, not bytes.
    expect(args.fileEntries).toEqual([
      { archive_path: 'images/hash_abc/a.png', source_rel: 'images/1/a.png' },
      { archive_path: 'images/hash_abc/b.png', source_rel: 'images/1/b.png' },
    ]);
    expect(result).toMatchObject({ saved: true, images: 2 });
  });

  it('omits images whose source file is missing at export time', async () => {
    exists.mockImplementation((path) => Promise.resolve(!path.endsWith('b.png')));
    invoke.mockResolvedValue({ images_written: 1, images_skipped: [] });

    await exportDatabase(ALL);

    const [, args] = invoke.mock.calls[0];
    expect(args.fileEntries).toEqual([{ archive_path: 'images/hash_abc/a.png', source_rel: 'images/1/a.png' }]);
    const manifest = JSON.parse(
      args.textEntries.find((e: { archive_path: string }) => e.archive_path === 'images/pet_images.json').contents,
    );
    expect(manifest).toHaveLength(1);
    expect(manifest[0].filename).toBe('a.png');
  });

  it('reports the count Rust actually wrote, not the count offered', async () => {
    // A file vanished between the existence check and the native write.
    invoke.mockResolvedValue({ images_written: 1, images_skipped: ['images/hash_abc/b.png'] });
    const result = await exportDatabase(ALL);
    expect(result.images).toBe(1);
  });

  it('does not invoke write_zip when the save dialog is cancelled', async () => {
    pickExportSavePath.mockResolvedValue(null);
    const result = await exportDatabase(ALL);
    expect(invoke).not.toHaveBeenCalled();
    expect(result.saved).toBe(false);
  });
});
