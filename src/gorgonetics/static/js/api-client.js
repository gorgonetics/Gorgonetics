/**
 * API Client for Gorgonetics web application.
 * Handles all communication with the backend API.
 */

class ApiClient {
  constructor(baseUrl = "") {
    this.baseUrl = baseUrl;
  }

  /**
   * Generic fetch wrapper with error handling
   */
  async fetchWithErrorHandling(url, options = {}) {
    try {
      const response = await window.fetch(url, options);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response;
    } catch (error) {
      console.error(`API request failed: ${url}`, error);
      throw error;
    }
  }

  /**
   * Load available animal types
   */
  async getAnimalTypes() {
    const response = await this.fetchWithErrorHandling("/api/animal-types");
    return response.json();
  }

  /**
   * Load effect options for dropdowns
   */
  async getEffectOptions() {
    const response = await this.fetchWithErrorHandling("/api/effect-options");
    return response.json();
  }

  /**
   * Load chromosomes for a specific animal type
   */
  async getChromosomes(animalType) {
    const response = await this.fetchWithErrorHandling(
      `/api/chromosomes/${animalType}`,
    );
    return response.json();
  }

  /**
   * Load genes for a specific chromosome
   */
  async getGenes(animalType, chromosome) {
    const response = await this.fetchWithErrorHandling(
      `/api/genes/${animalType}/${chromosome}`,
    );
    return response.json();
  }

  /**
   * Update a specific gene
   */
  async updateGene(updateData) {
    const response = await this.fetchWithErrorHandling("/api/gene", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updateData),
    });
    return response.json();
  }

  /**
   * Export a specific chromosome
   */
  async exportChromosome(animalType, chromosome) {
    return this.fetchWithErrorHandling(
      `/api/download/${animalType}/${chromosome}`,
    );
  }

  /**
   * Export all chromosomes for an animal type
   */
  async exportAllChromosomes(animalType) {
    const response = await this.fetchWithErrorHandling(
      `/api/export/${animalType}`,
    );
    return response.json();
  }

  /**
   * Get all pets
   */
  async getPets() {
    const response = await this.fetchWithErrorHandling("/api/pets");
    return response.json();
  }

  /**
   * Get a specific pet by ID
   */
  async getPet(petId) {
    const response = await this.fetchWithErrorHandling(`/api/pets/${petId}`);
    return response.json();
  }

  /**
   * Delete a pet
   */
  async deletePet(petId) {
    const response = await this.fetchWithErrorHandling(`/api/pets/${petId}`, {
      method: "DELETE",
    });
    return response.json();
  }

  /**
   * Update a pet's attributes
   */
  async updatePet(petId, updateData) {
    const response = await this.fetchWithErrorHandling(`/api/pets/${petId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updateData),
    });
    return response.json();
  }

  /**
   * Get pet genome data for visualization
   */
  async getPetGenome(petId) {
    const response = await this.fetchWithErrorHandling(
      `/api/pet-genome/${petId}`,
    );
    return response.json();
  }
}

// Export for use in other modules
window.ApiClient = ApiClient;
