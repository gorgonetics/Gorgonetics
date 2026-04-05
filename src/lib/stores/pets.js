import { writable } from 'svelte/store';
import { apiClient } from '$lib/services/api.js';

// Core application state
export const pets = writable([]);
export const selectedPet = writable(null);
export const loading = writable(false);
export const error = writable('');

// Gene editing state
export const geneEditingView = writable(null);

// Current active tab state
export const activeTab = writable('pets');

// Action creators for updating state
export const appState = {
  // Pet management
  async loadPets() {
    try {
      loading.set(true);
      error.set(null);

      // Load pets for both authenticated and anonymous users
      // Anonymous users will see demo pets, authenticated users see their own pets
      const response = await apiClient.getPets();
      // Backend returns { items, total, limit, offset }; the store holds just the array
      const petData = response.items ?? response;
      pets.set(petData);
    } catch (err) {
      error.set(`Failed to load pets: ${err.message}`);
      console.error('Error loading pets:', err);
    } finally {
      loading.set(false);
    }
  },

  async selectPet(pet) {
    try {
      loading.set(true);
      error.set(null);
      selectedPet.set(pet);
    } catch (err) {
      error.set(`Failed to select pet: ${err.message}`);
      console.error('Error selecting pet:', err);
    } finally {
      loading.set(false);
    }
  },

  async deletePet(petId) {
    try {
      loading.set(true);
      error.set(null);
      await apiClient.deletePet(petId);
      await this.loadPets(); // Reload pets list

      // Clear selection if the deleted pet was selected
      const currentPet = getCurrentValue(selectedPet);
      if (currentPet && currentPet.id === petId) {
        selectedPet.set(null);
      }
    } catch (err) {
      error.set(`Failed to delete pet: ${err.message}`);
      console.error('Error deleting pet:', err);
    } finally {
      loading.set(false);
    }
  },

  async updatePet(petId, updateData) {
    try {
      loading.set(true);
      error.set(null);
      await apiClient.updatePet(petId, updateData);
      await this.loadPets(); // Reload pets list
    } catch (err) {
      error.set(`Failed to update pet: ${err.message}`);
      console.error('Error updating pet:', err);
      throw err; // Re-throw so the editor can handle it
    } finally {
      loading.set(false);
    }
  },

  async uploadPet(file, petName, petGender = 'Male') {
    try {
      loading.set(true);
      error.set(null);

      // Pass individual parameters to apiClient.uploadPet which creates its own FormData
      await apiClient.uploadPet(file, petName, petGender, null); // gender and notes parameters
      await this.loadPets(); // Reload pets list
    } catch (err) {
      error.set(`Failed to upload pet: ${err.message}`);
      console.error('Error uploading pet:', err);
    } finally {
      loading.set(false);
    }
  },

  async uploadPetQuiet(file, petName, petGender = 'Male') {
    return apiClient.uploadPet(file, petName, petGender, null);
  },

  // Gene editing methods
  setGeneEditingView(editingData) {
    geneEditingView.set(editingData);
    selectedPet.set(null);
  },

  clearGeneEditingView() {
    geneEditingView.set(null);
  },

  // Tab management
  switchTab(tab) {
    activeTab.set(tab);
    if (tab === 'pets') {
      geneEditingView.set(null);
    } else if (tab === 'editor') {
      selectedPet.set(null);
    }
  },

  // Utility methods
  clearError() {
    error.set(null);
  },

  setError(message) {
    error.set(message);
  },

  setSuccess() {
    // For now, just clear any existing error
    error.set(null);
  },

  reset() {
    selectedPet.set(null);
    geneEditingView.set(null);
    error.set(null);
    loading.set(false);
  },
};

// Helper function to get current value from a store
function getCurrentValue(store) {
  let value;
  const unsubscribe = store.subscribe((v) => (value = v));
  unsubscribe();
  return value;
}
