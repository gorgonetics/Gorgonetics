import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import { beforeEach, describe, expect, it } from 'vitest';
import { importDatabase } from '$lib/services/backupService.js';
import { closeDatabase, getDb, initDatabase } from '$lib/services/database.js';
import { CURRENT_SCHEMA_VERSION, runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';

const SAMPLE_BEEWASP = readFileSync(resolve('data/Genes_SampleFaeBee.txt'), 'utf-8');

async function buildZip({ pets = [] } = {}) {
  const zip = new JSZip();
  zip.file(
    'metadata.json',
    JSON.stringify({
      format: 'gorgonetics-backup',
      format_version: 2,
      schema_version: CURRENT_SCHEMA_VERSION,
      app_version: '0.2.0',
      exported_at: '2026-01-01T00:00:00Z',
      contents: { genes: false, pets: true, images: false },
      record_counts: { genes: 0, pets: pets.length, images: 0 },
    }),
  );
  zip.file('pets.json', JSON.stringify(pets));
  return zip.generateAsync({ type: 'uint8array' });
}

const basePet = {
  name: 'TagTest',
  species: 'BeeWasp',
  gender: 'Female',
  breed: '',
  breeder: 'Tester',
  content_hash: 'hash_tags_test',
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
  tags: '[]',
};

describe('Pet Tags', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
  });

  describe('migration', () => {
    it('schema version is 6', () => {
      expect(CURRENT_SCHEMA_VERSION).toBe(6);
    });
  });

  describe('enrichPet — tag parsing', () => {
    it('new pet has empty tags', async () => {
      await petService.uploadPet(SAMPLE_BEEWASP, 'Bee1', 'Female');
      const { items } = await petService.getAllPets();
      expect(items[0].tags).toEqual([]);
    });

    it('round-trips tags through updatePet and getPet', async () => {
      await petService.uploadPet(SAMPLE_BEEWASP, 'Bee2', 'Female');
      const { items } = await petService.getAllPets();
      const pet = items[0];

      await petService.updatePet(pet.id, { tags: ['breeder', 'favorite'] });
      const updated = await petService.getPet(pet.id);
      expect(updated.tags).toEqual(['breeder', 'favorite']);
    });
  });

  describe('updatePet — tag persistence', () => {
    it('persists tags via updatePet', async () => {
      await petService.uploadPet(SAMPLE_BEEWASP, 'Bee4', 'Male');
      const { items } = await petService.getAllPets();
      const pet = items[0];

      await petService.updatePet(pet.id, { tags: ['breeder', 'for sale'] });
      const updated = await petService.getPet(pet.id);
      expect(updated.tags).toEqual(['breeder', 'for sale']);
    });

    it('overwrites tags with a new set', async () => {
      await petService.uploadPet(SAMPLE_BEEWASP, 'Bee5', 'Female');
      const { items } = await petService.getAllPets();
      const pet = items[0];

      await petService.updatePet(pet.id, { tags: ['old-tag'] });
      await petService.updatePet(pet.id, { tags: ['new-tag', 'another'] });
      const updated = await petService.getPet(pet.id);
      expect(updated.tags).toEqual(['new-tag', 'another']);
    });

    it('clears tags with empty array', async () => {
      await petService.uploadPet(SAMPLE_BEEWASP, 'Bee6', 'Male');
      const { items } = await petService.getAllPets();
      const pet = items[0];

      await petService.updatePet(pet.id, { tags: ['temp'] });
      await petService.updatePet(pet.id, { tags: [] });
      const updated = await petService.getPet(pet.id);
      expect(updated.tags).toEqual([]);
    });
  });

  describe('backup round-trip', () => {
    it('preserves tags through import', async () => {
      const pet = { ...basePet, tags: '["breeder","favorite"]' };
      const zipData = await buildZip({ pets: [pet] });
      await importDatabase(zipData, {
        mode: 'replace',
        includeGenes: false,
        includePets: true,
        includeImages: false,
      });

      const { items } = await petService.getAllPets();
      expect(items[0].tags).toEqual(['breeder', 'favorite']);
    });

    it('handles tags as parsed array on import', async () => {
      const pet = { ...basePet, tags: ['alpha', 'beta'], content_hash: 'hash_parsed' };
      const zipData = await buildZip({ pets: [pet] });
      await importDatabase(zipData, {
        mode: 'replace',
        includeGenes: false,
        includePets: true,
        includeImages: false,
      });

      const { items } = await petService.getAllPets();
      expect(items[0].tags).toEqual(['alpha', 'beta']);
    });
  });
});
