import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb, initDatabase } from '$lib/services/database.js';
import * as geneService from '$lib/services/geneService.js';
import * as imageService from '$lib/services/imageService.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';

const SAMPLE_BEEWASP = readFileSync(resolve('data/Genes_SampleFaeBee.txt'), 'utf-8');
const SAMPLE_HORSE = readFileSync(resolve('data/Genes_SampleHorse.txt'), 'utf-8');

describe('Pet Service', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
  });

  describe('uploadPet', () => {
    it('uploads a beewasp genome', async () => {
      const result = await petService.uploadPet(SAMPLE_BEEWASP, { name: 'Test Bee', gender: 'Female' });
      expect(result.status).toBe('success');
      expect(result.pet_id).toBeGreaterThan(0);
    });

    it('uploads a horse genome', async () => {
      const result = await petService.uploadPet(SAMPLE_HORSE, { name: 'Test Horse', gender: 'Male' });
      expect(result.status).toBe('success');
      expect(result.pet_id).toBeGreaterThan(0);
    });

    it('rejects empty content', async () => {
      const result = await petService.uploadPet('', { name: 'Empty', gender: 'Male' });
      expect(result.status).toBe('error');
    });

    it('rejects invalid format', async () => {
      const result = await petService.uploadPet('not a genome file', { name: 'Bad', gender: 'Male' });
      expect(result.status).toBe('error');
    });

    it('detects duplicate uploads', async () => {
      await petService.uploadPet(SAMPLE_BEEWASP, { name: 'First', gender: 'Female' });
      const result = await petService.uploadPet(SAMPLE_BEEWASP, { name: 'Second', gender: 'Female' });
      expect(result.status).toBe('error');
      expect(result.message).toContain('already been uploaded');
    });

    it('backfills genome_text on re-import of a legacy pet (empty genome_text)', async () => {
      // Seed a legacy pet: same content_hash, but no raw genome on file —
      // simulates a row that predates migration v13.
      const first = await petService.uploadPet(SAMPLE_BEEWASP, { name: 'Legacy', gender: 'Female' });
      expect(first.status).toBe('success');
      const db = getDb();
      await db.execute('UPDATE pets SET genome_text = $text WHERE id = $id', { text: '', id: first.pet_id });
      // Also clear the ledger entry so we can verify the backfill path
      // records the re-import (otherwise the original insert's ledger
      // write would mask the assertion).
      await db.execute('DELETE FROM imported_files');

      // Re-importing the same file should fill genome_text in place and
      // surface a success message rather than the duplicate-rejection.
      const result = await petService.uploadPet(SAMPLE_BEEWASP, {
        name: 'AnyName',
        gender: 'Female',
        sourcePath: '/scan/Genes_Replay.txt',
      });
      expect(result.status).toBe('success');
      expect(result.pet_id).toBe(first.pet_id);
      expect(result.message).toMatch(/missing raw genome data/i);

      const rows = await db.select('SELECT genome_text FROM pets WHERE id = $id', { id: first.pet_id });
      expect(rows[0].genome_text).toBe(SAMPLE_BEEWASP);

      // The backfill path must record the file in imported_files too —
      // otherwise the auto-scanner picks the same file up next pass and
      // reports it as a duplicate failure.
      const ledger = await db.select('SELECT content_hash, source_path FROM imported_files');
      expect(ledger).toHaveLength(1);
      expect(ledger[0].source_path).toBe('/scan/Genes_Replay.txt');
      expect(await petService.hasImportedFile(ledger[0].content_hash)).toBe(true);
    });

    it('findPetGenomeTextByHash returns null / empty / populated states distinctly', async () => {
      // Slim variant of findPetByHash used by the auto-scan ledger-skip
      // path. Three states must be distinguishable:
      //   - no pet with that hash    → null  (auto-scan skips)
      //   - pet exists, genome_text=''  → ''   (auto-scan falls through to backfill)
      //   - pet exists, genome_text set → text (auto-scan skips)
      const db = getDb();
      expect(await petService.findPetGenomeTextByHash('no_such_hash')).toBeNull();

      const upload = await petService.uploadPet(SAMPLE_BEEWASP, { name: 'Pet', gender: 'Female' });
      const populated = await petService.findPetGenomeTextByHash((await petService.getPet(upload.pet_id)).content_hash);
      expect(typeof populated).toBe('string');
      expect(populated.length).toBeGreaterThan(0);

      await db.execute('UPDATE pets SET genome_text = $t WHERE id = $id', { t: '', id: upload.pet_id });
      const empty = await petService.findPetGenomeTextByHash((await petService.getPet(upload.pet_id)).content_hash);
      expect(empty).toBe('');
    });

    it('infers breed, gender, and attributes from structured Horse name', async () => {
      // Create a Horse genome file with a structured Entity name
      const structuredHorse = SAMPLE_HORSE.replace('Entity=Sample Horse', 'Entity=Kb F 60 70 65 80 90 100 55');
      const result = await petService.uploadPet(structuredHorse, { name: '', gender: 'Male' });
      expect(result.status).toBe('success');

      const pet = await petService.getPet(result.pet_id);
      expect(pet.breed).toBe('Kurbone');
      expect(pet.gender).toBe('Female'); // Overrides the 'Male' parameter
      expect(pet.temperament).toBe(60);
      expect(pet.toughness).toBe(70);
      expect(pet.ruggedness).toBe(65);
      expect(pet.enthusiasm).toBe(80);
      expect(pet.friendliness).toBe(90);
      expect(pet.intelligence).toBe(100);
      expect(pet.virility).toBe(55);
      // Name stays as the raw Entity string
      expect(pet.name).toBe('Kb F 60 70 65 80 90 100 55');
    });

    it('uses defaults when Horse name is not structured', async () => {
      const result = await petService.uploadPet(SAMPLE_HORSE, { name: '', gender: 'Male' });
      expect(result.status).toBe('success');

      const pet = await petService.getPet(result.pet_id);
      expect(pet.breed).toBe('');
      expect(pet.gender).toBe('Male');
      expect(pet.toughness).toBe(50);
      expect(pet.temperament).toBe(50);
    });

    it('handles multiple sequential uploads', async () => {
      const result1 = await petService.uploadPet(SAMPLE_BEEWASP, { name: 'Bee One', gender: 'Female' });
      expect(result1.status).toBe('success');

      const result2 = await petService.uploadPet(SAMPLE_HORSE, { name: 'Horse One', gender: 'Male' });
      expect(result2.status).toBe('success');

      const { items, total } = await petService.getAllPets();
      expect(total).toBe(2);
      expect(items.map((p) => p.name).sort()).toEqual(['Sample Fae Bee', 'Sample Horse']);
    });

    it('assigns monotonically increasing sort_order across uploads', async () => {
      await petService.uploadPet(SAMPLE_BEEWASP, { name: 'Bee', gender: 'Female' });
      await petService.uploadPet(SAMPLE_HORSE, { name: 'Horse', gender: 'Male' });
      const db = getDb();
      const rows = await db.select('SELECT sort_order FROM pets ORDER BY id');
      expect(rows.map((r) => r.sort_order)).toEqual([0, 1]);
    });

    it('returns error for duplicates during sequential upload', async () => {
      const result1 = await petService.uploadPet(SAMPLE_BEEWASP, { name: 'First', gender: 'Female' });
      expect(result1.status).toBe('success');

      const result2 = await petService.uploadPet(SAMPLE_BEEWASP, { name: 'Second', gender: 'Female' });
      expect(result2.status).toBe('error');
      expect(result2.message).toContain('already been uploaded');

      const { total } = await petService.getAllPets();
      expect(total).toBe(1);
    });
  });

  describe('getAllPets', () => {
    it('returns uploaded pets', async () => {
      await petService.uploadPet(SAMPLE_BEEWASP, { name: 'Bee', gender: 'Female' });
      await petService.uploadPet(SAMPLE_HORSE, { name: 'Horse', gender: 'Male' });
      const { items, total } = await petService.getAllPets();
      expect(total).toBe(2);
      expect(items).toHaveLength(2);
    });

    it('enriches pets with gene counts', async () => {
      await petService.uploadPet(SAMPLE_BEEWASP, { name: 'Bee', gender: 'Female' });
      const { items } = await petService.getAllPets();
      expect(items[0].total_genes).toBeGreaterThan(0);
      expect(items[0].known_genes).toBeGreaterThan(0);
    });

    it('enriches horse pets with gene counts', async () => {
      await petService.uploadPet(SAMPLE_HORSE, { name: 'Horse', gender: 'Male' });
      const { items } = await petService.getAllPets();
      expect(items[0].total_genes).toBeGreaterThan(0);
      expect(items[0].species).toBe('Horse');
    });
  });

  describe('updatePet', () => {
    it('updates pet name', async () => {
      const upload = await petService.uploadPet(SAMPLE_BEEWASP, { name: 'Old Name', gender: 'Female' });
      await petService.updatePet(upload.pet_id, { name: 'New Name' });
      const pet = await petService.getPet(upload.pet_id);
      expect(pet.name).toBe('New Name');
    });

    it('updates pet attributes', async () => {
      const upload = await petService.uploadPet(SAMPLE_BEEWASP, { name: 'Bee', gender: 'Female' });
      await petService.updatePet(upload.pet_id, { toughness: 75, ferocity: 90 });
      const pet = await petService.getPet(upload.pet_id);
      expect(pet.toughness).toBe(75);
      expect(pet.ferocity).toBe(90);
    });
  });

  describe('reorderPets', () => {
    it('persists custom sort order', async () => {
      const a = await petService.uploadPet(SAMPLE_BEEWASP, { name: 'A', gender: 'Female' });
      const b = await petService.uploadPet(SAMPLE_HORSE, { name: 'B', gender: 'Male' });

      // Default order is by insertion (sort_order 0, 1)
      const before = await petService.getAllPets();
      expect(before.items.map((p) => p.id)).toEqual([a.pet_id, b.pet_id]);

      // Reverse the order
      await petService.reorderPets([b.pet_id, a.pet_id]);

      const after = await petService.getAllPets();
      expect(after.items.map((p) => p.id)).toEqual([b.pet_id, a.pet_id]);
    });
  });

  describe('deletePet', () => {
    it('deletes a pet', async () => {
      const upload = await petService.uploadPet(SAMPLE_BEEWASP, { name: 'Bee', gender: 'Female' });
      const deleted = await petService.deletePet(upload.pet_id);
      expect(deleted).toBe(true);
      const pet = await petService.getPet(upload.pet_id);
      expect(pet).toBeNull();
    });

    it('returns false for nonexistent pet', async () => {
      const deleted = await petService.deletePet(9999);
      expect(deleted).toBe(false);
    });
  });
});

describe('Gene Service', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
    geneService.clearGeneEffectsCache();
  });

  describe('upsertGene and query', () => {
    it('inserts and retrieves genes', async () => {
      await geneService.upsertGene('beewasp', 'chr01', '01A1', {
        effectDominant: 'Toughness+',
        effectRecessive: 'None',
        appearance: 'Body Color Hue',
      });

      const types = await geneService.getAnimalTypes();
      expect(types).toContain('beewasp');

      const chroms = await geneService.getChromosomes('beewasp');
      expect(chroms).toContain('chr01');

      const genes = await geneService.getGenesByChromosome('beewasp', 'chr01');
      expect(genes).toHaveLength(1);
      expect(genes[0].effectDominant).toBe('Toughness+');
    });

    it('getGeneEffects aggregates effects by gene ID', async () => {
      await geneService.upsertGene('beewasp', 'chr01', '01A1', {
        effectDominant: 'Toughness+',
        effectRecessive: 'Intelligence-',
      });
      await geneService.upsertGene('beewasp', 'chr01', '01A2', {
        effectDominant: 'None',
        effectRecessive: 'Ferocity+',
      });

      const { effects } = await geneService.getGeneEffects('beewasp');
      expect(effects['01A1'].effectDominant).toBe('Toughness+');
      expect(effects['01A2'].effectRecessive).toBe('Ferocity+');
    });
  });

  describe('updateGene', () => {
    it('updates gene effects', async () => {
      await geneService.upsertGene('horse', 'chr01', '01A1', {
        effectDominant: 'None',
      });
      await geneService.updateGene('horse', '01A1', {
        effectDominant: 'Temperament+',
      });
      const gene = await geneService.getGene('horse', '01A1');
      expect(gene.effectDominant).toBe('Temperament+');
    });
  });

  describe('exportGenesToJson', () => {
    it('exports in asset file format', async () => {
      await geneService.upsertGene('beewasp', 'chr01', '01A1', {
        effectDominant: 'Toughness+',
        effectRecessive: 'None',
        appearance: 'Body Color Hue',
        notes: 'test note',
      });
      const exported = await geneService.exportGenesToJson('beewasp', 'chr01');
      expect(exported).toHaveLength(1);
      expect(exported[0]).toHaveProperty('gene', '01A1');
      expect(exported[0]).toHaveProperty('effectDominant', 'Toughness+');
    });

    it('produces fields in the canonical asset order', async () => {
      await geneService.upsertGene('beewasp', 'chr01', '01A1', {
        effectDominant: 'Toughness+',
        effectRecessive: 'None',
        appearance: 'Body Color Hue',
        breed: '',
        notes: '',
      });
      const [exported] = await geneService.exportGenesToJson('beewasp', 'chr01');
      expect(Object.keys(exported)).toEqual([
        'gene',
        'effectDominant',
        'effectRecessive',
        'appearance',
        'breed',
        'notes',
      ]);
    });

    it('normalizes empty effects to "None" so round-trips with asset files', async () => {
      await geneService.upsertGene('beewasp', 'chr01', '01A1', {
        effectDominant: '',
        effectRecessive: '',
        appearance: 'Body Color Hue',
      });
      const [exported] = await geneService.exportGenesToJson('beewasp', 'chr01');
      expect(exported.effectDominant).toBe('None');
      expect(exported.effectRecessive).toBe('None');
    });

    it.each([
      'assets/beewasp/beewasp_genes_chr01.json',
      'assets/horse/horse_genes_chr15.json',
      'assets/horse/horse_genes_chr22.json',
    ])('round-trips %s without diff', async (assetPath) => {
      const animalType = assetPath.includes('beewasp') ? 'beewasp' : 'horse';
      const chromosome = assetPath.match(/(chr\d+)/)[1];
      const original = JSON.parse(readFileSync(resolve(assetPath), 'utf-8'));

      for (const g of original) {
        await geneService.upsertGene(animalType, chromosome, g.gene, {
          effectDominant: g.effectDominant,
          effectRecessive: g.effectRecessive,
          appearance: g.appearance,
          breed: g.breed,
          notes: g.notes,
        });
      }
      const exported = await geneService.exportGenesToJson(animalType, chromosome);
      expect(JSON.stringify(exported, null, 2)).toBe(JSON.stringify(original, null, 2));
    });
  });

  describe('getGeneEffectsCached', () => {
    it('returns cached result on second call', async () => {
      await geneService.upsertGene('beewasp', 'chr01', '01A1', {
        effectDominant: 'Toughness+',
        effectRecessive: 'None',
      });

      const first = await geneService.getGeneEffectsCached('beewasp');
      const second = await geneService.getGeneEffectsCached('beewasp');
      expect(first).toBe(second);
      expect(first.effects['01A1'].effectDominant).toBe('Toughness+');
    });

    it('clearGeneEffectsCache invalidates cache', async () => {
      await geneService.upsertGene('beewasp', 'chr01', '01A1', {
        effectDominant: 'Toughness+',
      });

      const before = await geneService.getGeneEffectsCached('beewasp');
      expect(before.effects['01A1'].effectDominant).toBe('Toughness+');

      await geneService.updateGene('beewasp', '01A1', { effectDominant: 'Ferocity+' });
      geneService.clearGeneEffectsCache('beewasp');

      const after = await geneService.getGeneEffectsCached('beewasp');
      expect(after.effects['01A1'].effectDominant).toBe('Ferocity+');
      expect(after).not.toBe(before);
    });

    it('updateGenesBulk invalidates cache automatically', async () => {
      await geneService.upsertGene('beewasp', 'chr01', '01A1', {
        effectDominant: 'Toughness+',
        effectRecessive: 'None',
        appearance: 'Body Color Hue',
      });

      const before = await geneService.getGeneEffectsCached('beewasp');
      expect(before.effects['01A1'].effectDominant).toBe('Toughness+');

      await geneService.updateGenesBulk('beewasp', 'chr01', [
        { gene: '01A1', effectDominant: 'Ferocity+', effectRecessive: 'None', appearance: 'Body Color Hue', notes: '' },
      ]);

      const after = await geneService.getGeneEffectsCached('beewasp');
      expect(after.effects['01A1'].effectDominant).toBe('Ferocity+');
    });
  });
});

describe('Image Service', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
  });

  async function insertTestImage(petId, filename, sortOrder = 0) {
    const db = getDb();
    const result = await db.execute(
      `INSERT INTO pet_images (pet_id, filename, original_name, caption, tags, created_at, sort_order)
       VALUES ($pet_id, $filename, $original_name, '', '[]', $created_at, $sort_order)`,
      {
        pet_id: petId,
        filename,
        original_name: filename,
        created_at: new Date().toISOString(),
        sort_order: sortOrder,
      },
    );
    return result.lastInsertId;
  }

  async function createTestPet() {
    const result = await petService.uploadPet(SAMPLE_BEEWASP, { name: 'Test', gender: 'Female' });
    return result.pet_id;
  }

  describe('reorderImages', () => {
    it('persists custom sort order', async () => {
      const petId = await createTestPet();
      const imgA = await insertTestImage(petId, 'a.png', 0);
      const imgB = await insertTestImage(petId, 'b.png', 1);
      const imgC = await insertTestImage(petId, 'c.png', 2);

      // Default order: A, B, C
      const before = await imageService.getImagesForPet(petId);
      expect(before.map((i) => i.id)).toEqual([imgA, imgB, imgC]);

      // Reverse: C, B, A
      await imageService.reorderImages([imgC, imgB, imgA]);

      const after = await imageService.getImagesForPet(petId);
      expect(after.map((i) => i.id)).toEqual([imgC, imgB, imgA]);
    });

    it('reorders two images correctly', async () => {
      const petId = await createTestPet();
      const imgA = await insertTestImage(petId, 'a.png', 0);
      const imgB = await insertTestImage(petId, 'b.png', 1);

      await imageService.reorderImages([imgB, imgA]);

      const after = await imageService.getImagesForPet(petId);
      expect(after.map((i) => i.id)).toEqual([imgB, imgA]);
    });
  });

  describe('getImagesForPet', () => {
    it('returns images in reordered sequence', async () => {
      const petId = await createTestPet();
      const imgA = await insertTestImage(petId, 'first.png', 0);
      const imgB = await insertTestImage(petId, 'second.png', 1);
      const imgC = await insertTestImage(petId, 'third.png', 2);

      // Reorder to C, A, B
      await imageService.reorderImages([imgC, imgA, imgB]);

      const images = await imageService.getImagesForPet(petId);
      expect(images.map((i) => i.id)).toEqual([imgC, imgA, imgB]);
    });
  });
});
