import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, initDatabase } from '$lib/services/database.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';
import { activeTab, appState, error, geneEditingView, loading, pets, selectedPet } from '$lib/stores/pets.js';

const SAMPLE_BEEWASP = readFileSync(resolve('data/Genes_SampleFaeBee.txt'), 'utf-8');
const SAMPLE_HORSE = readFileSync(resolve('data/Genes_SampleHorse.txt'), 'utf-8');

describe('Pets Store', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
    appState.reset();
    pets.set([]);
    activeTab.set('pets');
  });

  describe('initial state', () => {
    it('starts with empty pets list', () => {
      expect(get(pets)).toEqual([]);
    });

    it('starts with no selected pet', () => {
      expect(get(selectedPet)).toBeNull();
    });

    it('starts with no error', () => {
      expect(get(error)).toBeNull();
    });

    it('starts on pets tab', () => {
      expect(get(activeTab)).toBe('pets');
    });

    it('starts not loading', () => {
      expect(get(loading)).toBe(false);
    });
  });

  describe('selectPet', () => {
    it('sets the selected pet', () => {
      const fakePet = { id: 1, name: 'TestBee' };
      appState.selectPet(fakePet);
      expect(get(selectedPet)).toEqual(fakePet);
    });
  });

  describe('switchTab', () => {
    it('switches to editor tab and clears selected pet', () => {
      appState.selectPet({ id: 1, name: 'TestBee' });
      appState.switchTab('editor');
      expect(get(activeTab)).toBe('editor');
      expect(get(selectedPet)).toBeNull();
    });

    it('switches to pets tab and clears gene editing view', () => {
      appState.setGeneEditingView({ some: 'data' });
      appState.switchTab('pets');
      expect(get(activeTab)).toBe('pets');
      expect(get(geneEditingView)).toBeNull();
    });
  });

  describe('setGeneEditingView', () => {
    it('sets editing data and clears selected pet', () => {
      appState.selectPet({ id: 1, name: 'TestBee' });
      appState.setGeneEditingView({ gene: 'data' });
      expect(get(geneEditingView)).toEqual({ gene: 'data' });
      expect(get(selectedPet)).toBeNull();
    });
  });

  describe('clearGeneEditingView', () => {
    it('clears the gene editing view', () => {
      appState.setGeneEditingView({ gene: 'data' });
      appState.clearGeneEditingView();
      expect(get(geneEditingView)).toBeNull();
    });
  });

  describe('error management', () => {
    it('sets an error message', () => {
      appState.setError('something went wrong');
      expect(get(error)).toBe('something went wrong');
    });

    it('clears an error', () => {
      appState.setError('something went wrong');
      appState.clearError();
      expect(get(error)).toBeNull();
    });
  });

  describe('reset', () => {
    it('resets all state to defaults', () => {
      appState.selectPet({ id: 1, name: 'TestBee' });
      appState.setGeneEditingView({ gene: 'data' });
      appState.setError('oops');
      loading.set(true);

      appState.reset();

      expect(get(selectedPet)).toBeNull();
      expect(get(geneEditingView)).toBeNull();
      expect(get(error)).toBeNull();
      expect(get(loading)).toBe(false);
    });
  });

  describe('loadPets', () => {
    it('loads pets from the database', async () => {
      await petService.uploadPet(SAMPLE_BEEWASP, { name: 'TestBee', gender: 'Female' });

      await appState.loadPets();
      const loaded = get(pets);
      expect(loaded.length).toBeGreaterThan(0);
      expect(loaded[0]).toHaveProperty('name');
    });

    it('sets loading to false after load', async () => {
      await appState.loadPets();
      expect(get(loading)).toBe(false);
    });

    it('sets error on failure', async () => {
      vi.spyOn(petService, 'getAllPets').mockRejectedValueOnce(new Error('db failed'));
      await appState.loadPets();
      expect(get(error)).toContain('db failed');
      expect(get(loading)).toBe(false);
    });
  });

  describe('deletePet', () => {
    it('deletes a pet and clears selection if it was selected', async () => {
      await petService.uploadPet(SAMPLE_BEEWASP, { name: 'DeleteMe', gender: 'Male' });
      await appState.loadPets();

      const pet = get(pets)[0];
      appState.selectPet(pet);
      await appState.deletePet(pet.id);

      expect(get(selectedPet)).toBeNull();
      expect(get(pets)).toHaveLength(0);
    });

    it('keeps selection if a different pet is deleted', async () => {
      await petService.uploadPet(SAMPLE_BEEWASP, { name: 'Keep', gender: 'Female' });
      await petService.uploadPet(SAMPLE_HORSE, { name: 'Remove', gender: 'Male' });
      await appState.loadPets();

      const allPets = get(pets);
      expect(allPets).toHaveLength(2);
      const [first, second] = allPets;
      appState.selectPet(first);

      await appState.deletePet(second.id);
      expect(get(selectedPet).id).toBe(first.id);
    });

    it('sets error on failure', async () => {
      vi.spyOn(petService, 'deletePet').mockRejectedValueOnce(new Error('delete failed'));
      await appState.deletePet(999);
      expect(get(error)).toContain('delete failed');
    });
  });

  describe('updatePet', () => {
    it('updates a pet and reloads the list', async () => {
      await petService.uploadPet(SAMPLE_BEEWASP, { name: 'Original', gender: 'Female' });
      await appState.loadPets();

      const pet = get(pets)[0];
      await appState.updatePet(pet.id, { name: 'Updated' });

      const updated = get(pets);
      expect(updated[0].name).toBe('Updated');
    });

    it('sets error and re-throws on failure', async () => {
      vi.spyOn(petService, 'updatePet').mockRejectedValueOnce(new Error('update failed'));
      await expect(appState.updatePet(999, { name: 'X' })).rejects.toThrow('update failed');
      expect(get(error)).toContain('update failed');
    });
  });

  describe('reorderPets', () => {
    it('sets error on failure', async () => {
      vi.spyOn(petService, 'reorderPets').mockRejectedValueOnce(new Error('reorder failed'));
      await expect(appState.reorderPets([1, 2])).rejects.toThrow('reorder failed');
      expect(get(error)).toContain('reorder failed');
    });
  });

  describe('uploadPet', () => {
    it('uploads a pet and reloads the list', async () => {
      await appState.uploadPet(SAMPLE_BEEWASP, { name: 'UploadTest', gender: 'Female' });
      const loaded = get(pets);
      expect(loaded.length).toBeGreaterThan(0);
    });

    it('sets loading to false after upload', async () => {
      await appState.uploadPet(SAMPLE_BEEWASP, { name: 'UploadTest', gender: 'Female' });
      expect(get(loading)).toBe(false);
    });

    it('sets error on failure', async () => {
      vi.spyOn(petService, 'uploadPet').mockRejectedValueOnce(new Error('upload failed'));
      await appState.uploadPet('bad', { name: 'Bad', gender: 'Male' });
      expect(get(error)).toContain('upload failed');
      expect(get(loading)).toBe(false);
    });

    it('surfaces validation failures returned in the result envelope', async () => {
      // petService reports invalid-format as { status: 'error', message }
      // rather than throwing. The store must still set the error and
      // return the envelope so the caller can branch.
      const result = await appState.uploadPet('not a genome file', { name: 'Bad' });
      expect(result.status).toBe('error');
      expect(get(error)).toContain('Invalid genome file format');
    });
  });

  describe('uploadPetQuiet', () => {
    it('delegates to petService without setting loading state', async () => {
      const result = await appState.uploadPetQuiet(SAMPLE_BEEWASP, { name: 'QuietTest' });
      expect(result.status).toBe('success');
      // loading should not have been toggled (quiet mode)
      expect(get(loading)).toBe(false);
    });
  });
});
