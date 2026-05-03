import { derived, type Writable, writable } from 'svelte/store';
import type { UploadPetOptions } from '$lib/services/petService.js';
import * as petService from '$lib/services/petService.js';
import type { Pet } from '$lib/types/index.js';

export type Tab = 'pets' | 'editor' | 'compare' | 'stable' | 'breeding';

export const pets: Writable<Pet[]> = writable([]);
export const selectedPet: Writable<Pet | null> = writable(null);
export const loading = writable(false);
export const error: Writable<string | null> = writable(null);
export const geneEditingView: Writable<unknown> = writable(null);
export const activeTab: Writable<Tab> = writable('pets');

/** All unique tags across all pets, sorted. Shared by PetEditor and PetList. */
export const allTags = derived(pets, ($pets) => [...new Set($pets.flatMap((p) => p.tags ?? []))].sort());

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
      const { items } = await petService.getAllPets();
      pets.set(items as Pet[]);
    } catch (err: unknown) {
      error.set(`Failed to load pets: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      loading.set(false);
    }
  },

  selectPet(pet: Pet) {
    selectedPet.set(pet);
  },

  async deletePet(petId: number) {
    try {
      loading.set(true);
      error.set(null);
      await petService.deletePet(petId);
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
      await petService.updatePet(petId, updateData);
      await this.loadPets();
    } catch (err: unknown) {
      error.set(`Failed to update pet: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    } finally {
      loading.set(false);
    }
  },

  async uploadPet(content: string, options: UploadPetOptions = {}) {
    try {
      loading.set(true);
      error.set(null);
      const result = await petService.uploadPet(content, options);
      // petService surfaces validation/duplicate failures via the
      // result envelope (no throw), so silently reloading would hide
      // those from the user.
      if (result.status === 'error') {
        error.set(`Failed to upload pet: ${result.message}`);
        return result;
      }
      await this.loadPets();
      return result;
    } catch (err: unknown) {
      error.set(`Failed to upload pet: ${err instanceof Error ? err.message : String(err)}`);
      return { status: 'error' as const, message: err instanceof Error ? err.message : String(err) };
    } finally {
      loading.set(false);
    }
  },

  async uploadPetQuiet(content: string, options: UploadPetOptions = {}) {
    return petService.uploadPet(content, options);
  },

  async reorderPets(orderedIds: number[]) {
    try {
      await petService.reorderPets(orderedIds);
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
    } else if (tab === 'compare' || tab === 'stable' || tab === 'breeding') {
      selectedPet.set(null);
      geneEditingView.set(null);
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
