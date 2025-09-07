/**
 * API Client for Gorgonetics Svelte application.
 * Handles all communication with the backend API.
 */

class ApiClient {
  constructor(baseUrl = "") {
    this.baseUrl = baseUrl;
    this.currentToken = null;
  }

  /**
   * Set authentication token for requests
   */
  setAuthToken(token) {
    this.currentToken = token;
  }

  /**
   * Get authentication headers
   */
  getAuthHeaders(token = null) {
    const authToken = token || this.currentToken;
    return authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
  }

  /**
   * Generic fetch wrapper with error handling and authentication
   */
  async fetchWithErrorHandling(url, options = {}) {
    try {
      const fullUrl = url.startsWith('http') ? url : `${this.baseUrl}${url}`;
      
      // Add auth headers if available
      const headers = {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders(),
        ...options.headers
      };

      const response = await fetch(fullUrl, {
        ...options,
        headers
      });
      
      if (!response.ok) {
        // Handle authentication errors
        if (response.status === 401) {
          throw new Error('Authentication required');
        }
        if (response.status === 403) {
          throw new Error('Access forbidden');
        }
        
        // Try to get error details from response
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const errorData = await response.json();
          if (errorData.detail) {
            errorMessage = errorData.detail;
          }
        } catch {
          // Ignore JSON parsing errors, use default message
        }
        
        throw new Error(errorMessage);
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
      body: JSON.stringify({
        animal_type: updateData.animal_type,
        gene: updateData.gene || updateData.position?.toString(),
        effectDominant: updateData.effectDominant,
        effectRecessive: updateData.effectRecessive,
        appearance: updateData.appearance,
        notes: updateData.notes,
      }),
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

  /**
   * Upload a pet file
   */
  async uploadPet(file, name = "", gender = "Male", notes = null) {
    const formData = new FormData();
    formData.append("file", file);
    if (name) {
      formData.append("name", name);
    }
    formData.append("gender", gender);
    if (notes) {
      formData.append("notes", notes);
    }
    
    const response = await this.fetchWithErrorHandling("/api/pets/upload", {
      method: "POST",
      body: formData,
    });
    return response.json();
  }

  /**
   * Get gene effects for a species
   */
  async getGeneEffects(animalType) {
    const response = await this.fetchWithErrorHandling(`/api/gene-effects/${animalType}`);
    return response.json();
  }

  /**
   * Get attribute configuration for a species
   */
  async getAttributeConfig(animalType) {
    const response = await this.fetchWithErrorHandling(`/api/attribute-config/${animalType}`);
    return response.json();
  }

  // ===== Authentication Methods =====

  /**
   * User login
   */
  async login(username, password) {
    const response = await this.fetchWithErrorHandling('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    return response.json();
  }

  /**
   * User registration
   */
  async register(username, password) {
    const response = await this.fetchWithErrorHandling('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    return response.json();
  }

  /**
   * Get current user info
   */
  async getCurrentUser(token = null) {
    const response = await this.fetchWithErrorHandling('/api/auth/me', {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    return response.json();
  }

  /**
   * User logout
   */
  async logout(token = null) {
    const response = await this.fetchWithErrorHandling('/api/auth/logout', {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    return response.json();
  }

  /**
   * Initialize the API client
   */
  async initialize() {
    // Any initialization logic can go here
    console.log("API Client initialized");
  }
}

// Create and export a singleton instance
export const apiClient = new ApiClient();

// Also export the class for testing
export { ApiClient };
