import { type Writable, writable } from 'svelte/store';
import { apiClient } from '$lib/services/api.js';
import type { Pet } from '$lib/types/index.js';

export type Tab = 'pets' | 'editor';

export const pets: Writable<Pet[]> = writable([]);
export const selectedPet: Writable<Pet | null> = writable(null);
export const loading = writable(false);
export const error: Writable<string | null> = writable(null);
export const geneEditingView: Writable<unknown> = writable(null);
export const activeTab: Writable<Tab> = writable('pets');

function getCurrentValue<T>(store: Writable<T>): T | undefined {
  let value: T | undefined;
  const unsubscribe = store.subscribe((v) => (value = v));
  unsubscribe();
  return value;
}

export const appState = {
  async loadPets() {
    try {
      loading.set(true);
      error.set(null);
      const response = await apiClient.getPets();
      const petData = response.items ?? response;
      pets.set(petData as Pet[]);
    } catch (err: unknown) {
      error.set(`Failed to load pets: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      loading.set(false);
    }
  },

  selectPet(pet: Pet) {
    loading.set(true);
    error.set(null);
    selectedPet.set(pet);
    loading.set(false);
  },

  async deletePet(petId: number) {
    try {
      loading.set(true);
      error.set(null);
      await apiClient.deletePet(petId);
      await this.loadPets();

      const currentPet = getCurrentValue(selectedPet);
      if (currentPet && currentPet.id === petId) {
        selectedPet.set(null);
      }
    } catch (err: unknown) {
      error.set(`Failed to delete pet: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      loading.set(false);
    }
  },

  async updatePet(petId: number, updateData: Record<string, unknown>) {
    try {
      loading.set(true);
      error.set(null);
      await apiClient.updatePet(petId, updateData);
      await this.loadPets();
    } catch (err: unknown) {
      error.set(`Failed to update pet: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    } finally {
      loading.set(false);
    }
  },

  async uploadPet(file: string, petName: string, petGender = 'Male') {
    try {
      loading.set(true);
      error.set(null);
      await apiClient.uploadPet(file, petName, petGender, null);
      await this.loadPets();
    } catch (err: unknown) {
      error.set(`Failed to upload pet: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      loading.set(false);
    }
  },

  async uploadPetQuiet(file: string, petName: string, petGender = 'Male') {
    return apiClient.uploadPet(file, petName, petGender, null);
  },

  async reorderPets(orderedIds: number[]) {
    try {
      await apiClient.reorderPets(orderedIds);
    } catch (err: unknown) {
      error.set(`Failed to save order: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  },

  setGeneEditingView(editingData: unknown) {
    geneEditingView.set(editingData);
    selectedPet.set(null);
  },

  clearGeneEditingView() {
    geneEditingView.set(null);
  },

  switchTab(tab: Tab) {
    activeTab.set(tab);
    if (tab === 'pets') {
      geneEditingView.set(null);
    } else if (tab === 'editor') {
      selectedPet.set(null);
    }
  },

  clearError() {
    error.set(null);
  },

  setError(message: string) {
    error.set(message);
  },

  reset() {
    selectedPet.set(null);
    geneEditingView.set(null);
    error.set(null);
    loading.set(false);
  },
};
