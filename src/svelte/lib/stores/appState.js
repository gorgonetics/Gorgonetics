import { writable, derived } from "svelte/store";
import { apiClient } from "../services/apiClient.js";

// Core application state
export const pets = writable([]);
export const selectedPet = writable(null);
export const loading = writable(false);
export const error = writable("");

// Gene editing state
export const geneEditingView = writable(null);

// No derived stores needed for simplified pet management

// Action creators for updating state
export const appState = {
  // Pet management
  async loadPets() {
    try {
      loading.set(true);
      error.set(null);
      const petData = await apiClient.getPets();
      pets.set(petData);
    } catch (err) {
      error.set(`Failed to load pets: ${err.message}`);
      console.error("Error loading pets:", err);
    } finally {
      loading.set(false);
    }
  },

  async selectPet(pet) {
    try {
      loading.set(true);
      error.set(null);
      selectedPet.set(pet);
      console.log(`🐾 Selected pet: ${pet ? pet.name : "none"}`);
    } catch (err) {
      error.set(`Failed to select pet: ${err.message}`);
      console.error("Error selecting pet:", err);
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
      console.error("Error deleting pet:", err);
    } finally {
      loading.set(false);
    }
  },

  async uploadPet(file, petName) {
    try {
      loading.set(true);
      error.set(null);

      const formData = new FormData();
      formData.append("file", file);
      if (petName) {
        formData.append("name", petName);
      }

      await apiClient.uploadPet(formData);
      await this.loadPets(); // Reload pets list
    } catch (err) {
      error.set(`Failed to upload pet: ${err.message}`);
      console.error("Error uploading pet:", err);
    } finally {
      loading.set(false);
    }
  },

  // Gene editing methods
  setGeneEditingView(editingData) {
    geneEditingView.set(editingData);
    selectedPet.set(null); // Clear pet selection when editing genes
  },

  clearGeneEditingView() {
    geneEditingView.set(null);
  },

  // Utility methods
  clearError() {
    error.set(null);
  },

  setError(message) {
    error.set(message);
  },

  setSuccess(message) {
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
