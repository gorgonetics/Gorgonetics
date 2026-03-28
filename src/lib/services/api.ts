/**
 * API Client for Gorgonetics native app.
 * Same interface as the original api.js but delegates to local TypeScript services
 * instead of making HTTP requests. This preserves component compatibility.
 */

import * as petService from './petService.js';
import * as geneService from './geneService.js';
import * as configService from './configService.js';
import { TOKEN_KEY, REFRESH_TOKEN_KEY } from '$lib/stores/auth.js';

class ApiClient {
  constructor() {
    this.currentToken = null;
  }

  // Auth methods — no-ops in native app
  setAuthToken(_token) {}
  getAuthHeaders() { return {}; }

  /**
   * Route-based dispatcher for components that call fetchWithErrorHandling directly.
   * Parses the URL pattern and delegates to the correct service.
   */
  async fetchWithErrorHandling(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();

    // Gene effects: GET /api/gene-effects/{species}
    let match = url.match(/\/api\/gene-effects\/(.+)/);
    if (match) {
      const data = await geneService.getGeneEffects(match[1]);
      return this._jsonResponse(data);
    }

    // Effect options for species: GET /api/effect-options/{species}
    match = url.match(/\/api\/effect-options\/(.+)/);
    if (match) {
      const data = configService.getEffectOptionsForSpecies(match[1]);
      return this._jsonResponse(data);
    }

    // Effect options (all): GET /api/effect-options
    if (url === '/api/effect-options') {
      const data = configService.getEffectOptions();
      return this._jsonResponse(data);
    }

    // Genes by chromosome: GET /api/genes/{type}/{chr}
    match = url.match(/\/api\/genes\/([^/]+)\/([^/]+)/);
    if (match && method === 'GET') {
      const data = await geneService.getGenesByChromosome(match[1], match[2]);
      return this._jsonResponse(data);
    }

    // Bulk gene update: PUT /api/genes
    if (url === '/api/genes' && method === 'PUT') {
      const body = JSON.parse(options.body);
      const count = await geneService.updateGenesBulk(
        body.animal_type, body.chromosome, body.genes
      );
      return this._jsonResponse({ updated: count });
    }

    // Download chromosome: GET /api/download/{type}/{chr}
    match = url.match(/\/api\/download\/([^/]+)\/([^/]+)/);
    if (match) {
      const data = await geneService.exportGenesToJson(match[1], match[2]);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      return new Response(blob);
    }

    // Attribute config: GET /api/attribute-config/{species}
    match = url.match(/\/api\/attribute-config\/(.+)/);
    if (match) {
      const data = configService.getAttributeConfig(match[1]);
      return this._jsonResponse(data);
    }

    // Appearance config: GET /api/appearance-config/{species}
    match = url.match(/\/api\/appearance-config\/(.+)/);
    if (match) {
      const data = configService.getAppearanceConfig(match[1]);
      return this._jsonResponse(data);
    }

    // Pet genome: GET /api/pet-genome/{id}
    match = url.match(/\/api\/pet-genome\/(\d+)/);
    if (match) {
      const data = await petService.getPetGenome(parseInt(match[1]));
      return this._jsonResponse(data);
    }

    console.warn(`Unhandled API route: ${method} ${url}`);
    throw new Error(`Route not found: ${url}`);
  }

  /** Helper: wrap data in a Response-like object with .json() */
  _jsonResponse(data) {
    return {
      ok: true,
      status: 200,
      json: async () => data,
      text: async () => JSON.stringify(data),
    };
  }

  // --- Gene methods ---

  async getAnimalTypes() {
    return geneService.getAnimalTypes();
  }

  async getEffectOptions() {
    return configService.getEffectOptions();
  }

  async getChromosomes(animalType) {
    return geneService.getChromosomes(animalType);
  }

  async getGenes(animalType, chromosome) {
    return geneService.getGenesByChromosome(animalType, chromosome);
  }

  async updateGene(updateData) {
    await geneService.updateGene(updateData.animal_type, updateData.gene, {
      effectDominant: updateData.effectDominant,
      effectRecessive: updateData.effectRecessive,
      appearance: updateData.appearance,
      notes: updateData.notes,
    });
    return { success: true };
  }

  async exportChromosome(animalType, chromosome) {
    const data = await geneService.exportGenesToJson(animalType, chromosome);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    return new Response(blob);
  }

  async exportAllChromosomes(animalType) {
    return geneService.exportAllChromosomes(animalType);
  }

  async getGeneEffects(animalType) {
    return geneService.getGeneEffects(animalType);
  }

  async getAttributeConfig(animalType) {
    return configService.getAttributeConfig(animalType);
  }

  // --- Pet methods ---

  async getPets() {
    return petService.getAllPets();
  }

  async getPet(petId) {
    return petService.getPet(petId);
  }

  async deletePet(petId) {
    await petService.deletePet(petId);
    return { message: 'Pet deleted' };
  }

  async updatePet(petId, updateData) {
    await petService.updatePet(petId, updateData);
    return { success: true };
  }

  async getPetGenome(petId) {
    return petService.getPetGenome(petId);
  }

  /**
   * Upload a pet from file content.
   * In the native app, this receives content as a string (not a File blob).
   */
  async uploadPet(fileContent, name = "", gender = "Male", notes = null) {
    return petService.uploadPet(fileContent, name, gender, notes ?? undefined);
  }

  // --- Auth methods (no-ops in native app) ---

  async login() {
    return { access_token: 'local', refresh_token: 'local' };
  }

  async register() {
    return {};
  }

  async getCurrentUser() {
    return { id: 1, username: 'local', role: 'admin', is_active: true };
  }

  async logout() {
    return { message: 'ok' };
  }
}

// Create and export a singleton instance
export const apiClient = new ApiClient();

// Also export the class for testing
export { ApiClient };
