/**
 * API Client for Gorgonetics native app.
 * Delegates to local TypeScript services instead of making HTTP requests.
 */

import * as geneService from './geneService.js';
import * as petService from './petService.js';

class ApiClient {
  async getAnimalTypes() {
    return geneService.getAnimalTypes();
  }

  async getChromosomes(animalType: string) {
    return geneService.getChromosomes(animalType);
  }

  async getPets() {
    return petService.getAllPets();
  }

  async deletePet(petId: number) {
    await petService.deletePet(petId);
    return { message: 'Pet deleted' };
  }

  async updatePet(petId: number, updateData: Record<string, unknown>) {
    await petService.updatePet(petId, updateData);
    return { success: true };
  }

  async uploadPet(fileContent: string, name = '', gender = 'Male', notes: string | null = null) {
    return petService.uploadPet(fileContent, name, gender, notes ?? undefined);
  }

  async reorderPets(orderedIds: number[]) {
    return petService.reorderPets(orderedIds);
  }
}

export const apiClient = new ApiClient();
export { ApiClient };
