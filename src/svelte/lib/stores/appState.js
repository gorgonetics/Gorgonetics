import { writable } from "svelte/store";
import { apiClient } from "../services/apiClient.js";

// Core application state
export const pets = writable([]);
export const selectedPet = writable(null);
export const loading = writable(false);
export const error = writable("");

// Gene editing state
export const geneEditingView = writable(null);

// Pet table view state
export const petTableView = writable(false);

// Current active tab state
export const activeTab = writable("pets");

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

  async updatePet(petId, updateData) {
    try {
      loading.set(true);
      error.set(null);
      await apiClient.updatePet(petId, updateData);
      await this.loadPets(); // Reload pets list
      console.log(`🐾 Updated pet: ${petId}`);
    } catch (err) {
      error.set(`Failed to update pet: ${err.message}`);
      console.error("Error updating pet:", err);
      throw err; // Re-throw so the editor can handle it
    } finally {
      loading.set(false);
    }
  },

  async uploadPet(file, petName, petGender = "Male") {
    try {
      loading.set(true);
      error.set(null);

      // Pass individual parameters to apiClient.uploadPet which creates its own FormData
      await apiClient.uploadPet(file, petName, petGender, null); // gender and notes parameters
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
    petTableView.set(false); // Clear table view when editing genes
  },

  clearGeneEditingView() {
    geneEditingView.set(null);
  },

  // Pet table view methods
  showPetTableView() {
    petTableView.set(true);
    selectedPet.set(null); // Clear pet selection when showing table
    geneEditingView.set(null); // Clear gene editing when showing table
  },

  hidePetTableView() {
    petTableView.set(false);
  },

  // Tab management
  switchTab(tab) {
    activeTab.set(tab);
    // Clear other views when switching tabs
    if (tab === "pets") {
      geneEditingView.set(null);
    } else if (tab === "editor") {
      selectedPet.set(null);
      petTableView.set(false);
    }
  },

  // Utility methods
  clearError() {
    error.set(null);
  },

  setError(message) {
    error.set(message);
  },

  setSuccess(_message) {
    // For now, just clear any existing error
    error.set(null);
  },

  reset() {
    selectedPet.set(null);
    geneEditingView.set(null);
    petTableView.set(false);
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
