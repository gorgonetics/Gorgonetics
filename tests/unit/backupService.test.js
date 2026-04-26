import JSZip from 'jszip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importDatabase, inspectBackup, loadBackup } from '$lib/services/backupService.js';
import { closeDatabase, getDb, initDatabase } from '$lib/services/database.js';
import { CURRENT_SCHEMA_VERSION, runMigrations } from '$lib/services/migrationService.js';

/** Build a valid backup zip with the given metadata overrides and optional data files. */
async function buildZip({ metaOverrides = {}, genes = null, pets = null } = {}) {
  const zip = new JSZip();
  const metadata = {
    format: 'gorgonetics-backup',
    format_version: 2,
    schema_version: CURRENT_SCHEMA_VERSION,
    app_version: '0.2.0',
    exported_at: '2026-01-01T00:00:00Z',
    contents: { genes: !!genes, pets: !!pets, images: false },
    record_counts: {
      genes: genes ? genes.length : 0,
      pets: pets ? pets.length : 0,
      images: 0,
    },
    ...metaOverrides,
  };
  zip.file('metadata.json', JSON.stringify(metadata));
  if (genes) zip.file('genes.json', JSON.stringify(genes));
  if (pets) zip.file('pets.json', JSON.stringify(pets));
  return zip.generateAsync({ type: 'uint8array' });
}

const sampleGene = {
  animal_type: 'BeeWasp',
  chromosome: 'chr01',
  gene: '01A1',
  effectDominant: 'Toughness+',
  effectRecessive: 'None',
  appearance: 'Body Color Hue',
  breed: '',
  notes: '',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

const samplePet = {
  name: 'TestBee',
  species: 'BeeWasp',
  gender: 'Female',
  breed: '',
  breeder: 'Tester',
  content_hash: 'hash_abc',
  genome_data: '{"genes":{}}',
  notes: '',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  intelligence: 50,
  toughness: 50,
  friendliness: 50,
  ruggedness: 50,
  enthusiasm: 50,
  virility: 50,
  ferocity: 50,
  temperament: 50,
  sort_order: 0,
};

describe('Backup Service', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
  });

  // --- inspectBackup ---

  describe('inspectBackup', () => {
    it('parses valid backup metadata', async () => {
      const zipData = await buildZip();
      const meta = await inspectBackup(zipData);
      expect(meta.format).toBe('gorgonetics-backup');
      expect(meta.format_version).toBe(2);
      expect(meta.schema_version).toBe(CURRENT_SCHEMA_VERSION);
    });

    it('rejects archive missing metadata.json', async () => {
      const zip = new JSZip();
      zip.file('other.txt', 'hello');
      const data = await zip.generateAsync({ type: 'uint8array' });
      await expect(inspectBackup(data)).rejects.toThrow('missing metadata.json');
    });

    it('rejects non-Gorgonetics backup format', async () => {
      const zipData = await buildZip({ metaOverrides: { format: 'other-app' } });
      await expect(inspectBackup(zipData)).rejects.toThrow('Not a Gorgonetics backup');
    });

    it('rejects newer format version', async () => {
      const zipData = await buildZip({ metaOverrides: { format_version: 999 } });
      await expect(inspectBackup(zipData)).rejects.toThrow('newer version');
    });

    it('rejects newer schema version', async () => {
      const zipData = await buildZip({
        metaOverrides: { schema_version: CURRENT_SCHEMA_VERSION + 1 },
      });
      await expect(inspectBackup(zipData)).rejects.toThrow('newer database schema');
    });

    it('rejects invalid zip data', async () => {
      const garbage = new Uint8Array([1, 2, 3, 4]);
      await expect(inspectBackup(garbage)).rejects.toThrow();
    });
  });

  // --- loadBackup ---

  describe('loadBackup', () => {
    it('returns both the parsed zip and metadata', async () => {
      const zipData = await buildZip({ genes: [sampleGene] });
      const loaded = await loadBackup(zipData);
      expect(loaded.metadata.format).toBe('gorgonetics-backup');
      expect(loaded.zip.file('genes.json')).toBeTruthy();
    });

    it('parses the zip only once when reused via importDatabase', async () => {
      const zipData = await buildZip({ genes: [sampleGene] });
      const loadAsyncSpy = vi.spyOn(JSZip, 'loadAsync');
      const callsBefore = loadAsyncSpy.mock.calls.length;

      const loaded = await loadBackup(zipData);
      const result = await importDatabase(loaded, {
        mode: 'replace',
        includeGenes: true,
        includePets: false,
        includeImages: false,
      });
      const callsAfter = loadAsyncSpy.mock.calls.length;

      expect(result.genes).toBe(1);
      expect(callsAfter - callsBefore).toBe(1);
      loadAsyncSpy.mockRestore();
    });

    it('importDatabase still parses raw bytes when no pre-loaded backup is given', async () => {
      const zipData = await buildZip({ genes: [sampleGene] });
      const result = await importDatabase(zipData, {
        mode: 'replace',
        includeGenes: true,
        includePets: false,
        includeImages: false,
      });
      expect(result.genes).toBe(1);
    });
  });

  // --- importDatabase: genes ---

  describe('importDatabase — genes', () => {
    const importOpts = (mode) => ({
      mode,
      includeGenes: true,
      includePets: false,
      includeImages: false,
    });

    it('imports genes in replace mode', async () => {
      const zipData = await buildZip({ genes: [sampleGene] });
      const result = await importDatabase(zipData, importOpts('replace'));
      expect(result.genes).toBe(1);

      const db = getDb();
      const rows = await db.select('SELECT * FROM genes');
      expect(rows).toHaveLength(1);
      expect(rows[0].gene).toBe('01A1');
    });

    it('replaces existing genes on re-import', async () => {
      const zipData = await buildZip({ genes: [sampleGene] });
      await importDatabase(zipData, importOpts('replace'));

      const modified = { ...sampleGene, effectDominant: 'Speed+' };
      const zipData2 = await buildZip({ genes: [modified] });
      await importDatabase(zipData2, importOpts('replace'));

      const db = getDb();
      const rows = await db.select('SELECT * FROM genes');
      expect(rows).toHaveLength(1);
      expect(rows[0].effectDominant).toBe('Speed+');
    });

    it('imports multiple genes', async () => {
      const gene2 = { ...sampleGene, gene: '01A2', chromosome: 'chr02' };
      const zipData = await buildZip({ genes: [sampleGene, gene2] });
      const result = await importDatabase(zipData, importOpts('replace'));
      expect(result.genes).toBe(2);
    });

    it('skips genes when includeGenes is false', async () => {
      const zipData = await buildZip({ genes: [sampleGene] });
      const opts = { ...importOpts('replace'), includeGenes: false };
      const result = await importDatabase(zipData, opts);
      expect(result.genes).toBe(0);

      const db = getDb();
      const rows = await db.select('SELECT * FROM genes');
      expect(rows).toHaveLength(0);
    });
  });

  // --- importDatabase: pets ---

  describe('importDatabase — pets', () => {
    const importOpts = (mode) => ({
      mode,
      includeGenes: false,
      includePets: true,
      includeImages: false,
    });

    it('imports pets in replace mode', async () => {
      const zipData = await buildZip({ pets: [samplePet] });
      const result = await importDatabase(zipData, importOpts('replace'));
      expect(result.pets).toBe(1);

      const db = getDb();
      const rows = await db.select('SELECT * FROM pets');
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('TestBee');
    });

    it('clears existing pets on replace import', async () => {
      const zipData = await buildZip({ pets: [samplePet] });
      await importDatabase(zipData, importOpts('replace'));

      const pet2 = { ...samplePet, name: 'NewBee', content_hash: 'hash_xyz' };
      const zipData2 = await buildZip({ pets: [pet2] });
      await importDatabase(zipData2, importOpts('replace'));

      const db = getDb();
      const rows = await db.select('SELECT * FROM pets');
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('NewBee');
    });

    it('merges pets without duplicating by content_hash', async () => {
      const zipData = await buildZip({ pets: [samplePet] });
      await importDatabase(zipData, importOpts('replace'));

      const pet2 = { ...samplePet, name: 'AnotherBee', content_hash: 'hash_new' };
      const zipData2 = await buildZip({ pets: [samplePet, pet2] });
      const result = await importDatabase(zipData2, importOpts('merge'));
      expect(result.pets).toBe(1);
      expect(result.petsSkipped).toBe(1);

      const db = getDb();
      const rows = await db.select('SELECT * FROM pets');
      expect(rows).toHaveLength(2);
    });

    it('offsets sort_order in merge mode', async () => {
      const pet1 = { ...samplePet, sort_order: 0 };
      const zipData1 = await buildZip({ pets: [pet1] });
      await importDatabase(zipData1, importOpts('replace'));

      const pet2 = { ...samplePet, name: 'Bee2', content_hash: 'hash_2', sort_order: 0 };
      const zipData2 = await buildZip({ pets: [pet2] });
      await importDatabase(zipData2, importOpts('merge'));

      const db = getDb();
      const rows = await db.select('SELECT name, sort_order FROM pets ORDER BY sort_order');
      expect(rows[0].sort_order).toBe(0);
      expect(rows[1].sort_order).toBeGreaterThan(0);
    });

    it('handles genome_data as object (auto-stringifies)', async () => {
      const pet = { ...samplePet, genome_data: { genes: { chr01: [] } } };
      const zipData = await buildZip({ pets: [pet] });
      await importDatabase(zipData, importOpts('replace'));

      const db = getDb();
      const rows = await db.select('SELECT genome_data FROM pets');
      expect(typeof rows[0].genome_data).toBe('string');
      expect(JSON.parse(rows[0].genome_data)).toEqual({ genes: { chr01: [] } });
    });

    it('skips pets when includePets is false', async () => {
      const zipData = await buildZip({ pets: [samplePet] });
      const opts = { ...importOpts('replace'), includePets: false };
      const result = await importDatabase(zipData, opts);
      expect(result.pets).toBe(0);
    });
  });

  // --- importDatabase: combined ---

  describe('importDatabase — combined', () => {
    it('imports both genes and pets together', async () => {
      const zipData = await buildZip({ genes: [sampleGene], pets: [samplePet] });
      const result = await importDatabase(zipData, {
        mode: 'replace',
        includeGenes: true,
        includePets: true,
        includeImages: false,
      });
      expect(result.genes).toBe(1);
      expect(result.pets).toBe(1);
    });

    it('replace re-import keeps count stable', async () => {
      const zipData = await buildZip({ pets: [samplePet] });
      await importDatabase(zipData, {
        mode: 'replace',
        includeGenes: false,
        includePets: true,
        includeImages: false,
      });

      const db = getDb();
      const before = await db.select('SELECT COUNT(*) as count FROM pets');
      expect(before[0].count).toBe(1);

      // Re-importing in replace mode should clear and re-insert, ending at same count
      await importDatabase(zipData, {
        mode: 'replace',
        includeGenes: false,
        includePets: true,
        includeImages: false,
      });
      const after = await db.select('SELECT COUNT(*) as count FROM pets');
      expect(after[0].count).toBe(1);
    });

    it('handles empty genes and pets arrays', async () => {
      const zipData = await buildZip({ genes: [], pets: [] });
      const result = await importDatabase(zipData, {
        mode: 'replace',
        includeGenes: true,
        includePets: true,
        includeImages: false,
      });
      expect(result.genes).toBe(0);
      expect(result.pets).toBe(0);
    });
  });
});
