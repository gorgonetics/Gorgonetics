import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import { beforeEach, describe, expect, it } from 'vitest';
import { importDatabase } from '$lib/services/backupService.js';
import { closeDatabase, initDatabase } from '$lib/services/database.js';
import { CURRENT_SCHEMA_VERSION, runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';

const SAMPLE_BEEWASP = readFileSync(resolve('data/Genes_SampleFaeBee.txt'), 'utf-8');

async function buildZip({ pets = [], petTags = null } = {}) {
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
  if (petTags) {
    zip.file('pet_tags.json', JSON.stringify(petTags));
  }
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
};

describe('Pet Tags (junction table)', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
  });

  describe('migration', () => {
    it('schema version is at least 7 (tags junction table)', () => {
      expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(7);
    });
  });

  describe('tag operations via petService', () => {
    it('new pet has empty tags', async () => {
      await petService.uploadPet(SAMPLE_BEEWASP, { name: 'Bee1', gender: 'Female' });
      const { items } = await petService.getAllPets();
      expect(items[0].tags).toEqual([]);
    });

    it('round-trips tags through updatePet and getPet', async () => {
      await petService.uploadPet(SAMPLE_BEEWASP, { name: 'Bee2', gender: 'Female' });
      const { items } = await petService.getAllPets();
      const pet = items[0];

      await petService.updatePet(pet.id, { tags: ['breeder', 'favorite'] });
      const updated = await petService.getPet(pet.id);
      expect(updated.tags).toEqual(['breeder', 'favorite']);
    });

    it('persists tags via updatePet', async () => {
      await petService.uploadPet(SAMPLE_BEEWASP, { name: 'Bee3', gender: 'Male' });
      const { items } = await petService.getAllPets();
      const pet = items[0];

      await petService.updatePet(pet.id, { tags: ['breeder', 'for sale'] });
      const updated = await petService.getPet(pet.id);
      expect(updated.tags).toEqual(['breeder', 'for sale']);
    });

    it('overwrites tags with a new set', async () => {
      await petService.uploadPet(SAMPLE_BEEWASP, { name: 'Bee4', gender: 'Female' });
      const { items } = await petService.getAllPets();
      const pet = items[0];

      await petService.updatePet(pet.id, { tags: ['old-tag'] });
      await petService.updatePet(pet.id, { tags: ['new-tag', 'another'] });
      const updated = await petService.getPet(pet.id);
      expect(updated.tags).toEqual(['another', 'new-tag']);
    });

    it('clears tags with empty array', async () => {
      await petService.uploadPet(SAMPLE_BEEWASP, { name: 'Bee5', gender: 'Male' });
      const { items } = await petService.getAllPets();
      const pet = items[0];

      await petService.updatePet(pet.id, { tags: ['temp'] });
      await petService.updatePet(pet.id, { tags: [] });
      const updated = await petService.getPet(pet.id);
      expect(updated.tags).toEqual([]);
    });

    it('normalizes tags to lowercase and trims', async () => {
      await petService.uploadPet(SAMPLE_BEEWASP, { name: 'Bee6', gender: 'Female' });
      const { items } = await petService.getAllPets();
      const pet = items[0];

      await petService.updatePet(pet.id, { tags: ['  Breeder  ', 'FAVORITE'] });
      const updated = await petService.getPet(pet.id);
      expect(updated.tags).toEqual(['breeder', 'favorite']);
    });
  });

  describe('backup round-trip', () => {
    it('preserves tags through import (new pet_tags.json format)', async () => {
      const petTags = [
        { content_hash: 'hash_tags_test', tag: 'breeder' },
        { content_hash: 'hash_tags_test', tag: 'favorite' },
      ];
      const zipData = await buildZip({ pets: [basePet], petTags });
      await importDatabase(zipData, {
        mode: 'replace',
        includeGenes: false,
        includePets: true,
        includeImages: false,
      });

      const { items } = await petService.getAllPets();
      expect(items[0].tags).toEqual(['breeder', 'favorite']);
    });

    it('backward compat: imports tags from v6 JSON field on pets', async () => {
      const pet = { ...basePet, tags: '["alpha","beta"]', content_hash: 'hash_v6' };
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

    it('backward compat: handles tags as parsed array on import', async () => {
      const pet = { ...basePet, tags: ['gamma', 'delta'], content_hash: 'hash_parsed' };
      const zipData = await buildZip({ pets: [pet] });
      await importDatabase(zipData, {
        mode: 'replace',
        includeGenes: false,
        includePets: true,
        includeImages: false,
      });

      const { items } = await petService.getAllPets();
      expect(items[0].tags).toEqual(['delta', 'gamma']);
    });
  });
});
