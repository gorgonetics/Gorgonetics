/**
 * API Client for Gorgonetics native app.
 * Same interface as the original api.js but delegates to local TypeScript services
 * instead of making HTTP requests. This preserves component compatibility.
 */

import * as configService from './configService.js';
import * as geneService from './geneService.js';
import * as petService from './petService.js';

class ApiClient {
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
      const count = await geneService.updateGenesBulk(body.animal_type, body.chromosome, body.genes);
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
      const data = await petService.getPetGenome(parseInt(match[1], 10));
      return this._jsonResponse(data);
    }

    console.warn(`Unhandled API route: ${method} ${url}`);
    throw new Error(`Route not found: ${url}`);
  }

  _jsonResponse(data) {
    return {
      ok: true,
      status: 200,
      json: async () => data,
      text: async () => JSON.stringify(data),
    };
  }

  async getAnimalTypes() {
    return geneService.getAnimalTypes();
  }

  async getChromosomes(animalType) {
    return geneService.getChromosomes(animalType);
  }

  async getPets() {
    return petService.getAllPets();
  }

  async deletePet(petId) {
    await petService.deletePet(petId);
    return { message: 'Pet deleted' };
  }

  async updatePet(petId, updateData) {
    await petService.updatePet(petId, updateData);
    return { success: true };
  }

  async uploadPet(fileContent, name = '', gender = 'Male', notes = null) {
    return petService.uploadPet(fileContent, name, gender, notes ?? undefined);
  }

  async reorderPets(orderedIds) {
    return petService.reorderPets(orderedIds);
  }
}

export const apiClient = new ApiClient();
export { ApiClient };
