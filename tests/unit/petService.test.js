import { readFileSync } from 'fs';
import { resolve } from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '$lib/services/database.js';
import * as geneService from '$lib/services/geneService.js';
import * as petService from '$lib/services/petService.js';

const SAMPLE_BEEWASP = readFileSync(resolve('data/Genes_SampleFaeBee.txt'), 'utf-8');
const SAMPLE_HORSE = readFileSync(resolve('data/Genes_SampleHorse.txt'), 'utf-8');

describe('Pet Service', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
  });

  describe('uploadPet', () => {
    it('uploads a beewasp genome', async () => {
      const result = await petService.uploadPet(SAMPLE_BEEWASP, 'Test Bee', 'Female');
      expect(result.status).toBe('success');
      expect(result.pet_id).toBeGreaterThan(0);
    });

    it('uploads a horse genome', async () => {
      const result = await petService.uploadPet(SAMPLE_HORSE, 'Test Horse', 'Male');
      expect(result.status).toBe('success');
      expect(result.pet_id).toBeGreaterThan(0);
    });

    it('rejects empty content', async () => {
      const result = await petService.uploadPet('', 'Empty', 'Male');
      expect(result.status).toBe('error');
    });

    it('rejects invalid format', async () => {
      const result = await petService.uploadPet('not a genome file', 'Bad', 'Male');
      expect(result.status).toBe('error');
    });

    it('detects duplicate uploads', async () => {
      await petService.uploadPet(SAMPLE_BEEWASP, 'First', 'Female');
      const result = await petService.uploadPet(SAMPLE_BEEWASP, 'Second', 'Female');
      expect(result.status).toBe('error');
      expect(result.message).toContain('already been uploaded');
    });
  });

  describe('getAllPets', () => {
    it('returns uploaded pets', async () => {
      await petService.uploadPet(SAMPLE_BEEWASP, 'Bee', 'Female');
      await petService.uploadPet(SAMPLE_HORSE, 'Horse', 'Male');
      const { items, total } = await petService.getAllPets();
      expect(total).toBe(2);
      expect(items).toHaveLength(2);
    });

    it('enriches pets with gene counts', async () => {
      await petService.uploadPet(SAMPLE_BEEWASP, 'Bee', 'Female');
      const { items } = await petService.getAllPets();
      expect(items[0].total_genes).toBeGreaterThan(0);
      expect(items[0].known_genes).toBeGreaterThan(0);
    });

    it('enriches horse pets with gene counts', async () => {
      await petService.uploadPet(SAMPLE_HORSE, 'Horse', 'Male');
      const { items } = await petService.getAllPets();
      expect(items[0].total_genes).toBeGreaterThan(0);
      expect(items[0].species).toBe('Horse');
    });
  });

  describe('getPetGenome', () => {
    it('returns beewasp genome for visualization', async () => {
      const upload = await petService.uploadPet(SAMPLE_BEEWASP, 'Bee', 'Female');
      const genome = await petService.getPetGenome(upload.pet_id);
      expect(genome).not.toBeNull();
      expect(genome.species).toBe('BeeWasp');
      expect(genome.genes).toBeDefined();
      expect(Object.keys(genome.genes).length).toBeGreaterThan(0);
    });

    it('returns horse genome for visualization', async () => {
      const upload = await petService.uploadPet(SAMPLE_HORSE, 'Horse', 'Male');
      const genome = await petService.getPetGenome(upload.pet_id);
      expect(genome).not.toBeNull();
      expect(genome.species).toBe('Horse');
      expect(genome.genes).toBeDefined();
      // Horse has many chromosomes
      expect(Object.keys(genome.genes).length).toBeGreaterThan(10);
    });

    it('returns null for nonexistent pet', async () => {
      const genome = await petService.getPetGenome(9999);
      expect(genome).toBeNull();
    });

    it('horse genome has gene strings in correct format', async () => {
      const upload = await petService.uploadPet(SAMPLE_HORSE, 'Horse', 'Male');
      const genome = await petService.getPetGenome(upload.pet_id);
      // Each chromosome value should be a string of gene characters separated by spaces
      for (const [chr, geneString] of Object.entries(genome.genes)) {
        expect(typeof geneString).toBe('string');
        expect(geneString.length).toBeGreaterThan(0);
        // Each character should be R, D, x, or ?
        const chars = geneString.replace(/\s/g, '');
        for (const c of chars) {
          expect(['R', 'D', 'x', '?']).toContain(c);
        }
      }
    });
  });

  describe('updatePet', () => {
    it('updates pet name', async () => {
      const upload = await petService.uploadPet(SAMPLE_BEEWASP, 'Old Name', 'Female');
      await petService.updatePet(upload.pet_id, { name: 'New Name' });
      const pet = await petService.getPet(upload.pet_id);
      expect(pet.name).toBe('New Name');
    });

    it('updates pet attributes', async () => {
      const upload = await petService.uploadPet(SAMPLE_BEEWASP, 'Bee', 'Female');
      await petService.updatePet(upload.pet_id, { toughness: 75, ferocity: 90 });
      const pet = await petService.getPet(upload.pet_id);
      expect(pet.toughness).toBe(75);
      expect(pet.ferocity).toBe(90);
    });
  });

  describe('deletePet', () => {
    it('deletes a pet', async () => {
      const upload = await petService.uploadPet(SAMPLE_BEEWASP, 'Bee', 'Female');
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
  });
});
