/**
 * API Test Utility for debugging Gorgonetics API integration
 */

import { apiClient } from '../services/apiClient.js';

export class ApiTester {
  constructor() {
    this.results = [];
  }

  async runAllTests() {
    console.log('🧪 Starting API Tests...');
    this.results = [];

    await this.testAnimalTypes();
    await this.testChromosomes();
    await this.testGenes();
    await this.testPets();
    await this.testEffectOptions();

    console.log('✅ API Tests Complete!');
    return this.results;
  }

  async testAnimalTypes() {
    try {
      console.log('Testing: /api/animal-types');
      const animalTypes = await apiClient.getAnimalTypes();
      console.log('✅ Animal Types:', animalTypes);
      this.results.push({
        test: 'Animal Types',
        status: 'success',
        data: animalTypes,
        error: null
      });
    } catch (error) {
      console.error('❌ Animal Types failed:', error);
      this.results.push({
        test: 'Animal Types',
        status: 'error',
        data: null,
        error: error.message
      });
    }
  }

  async testChromosomes() {
    try {
      console.log('Testing: /api/chromosomes/horse');
      const chromosomes = await apiClient.getChromosomes('horse');
      console.log('✅ Chromosomes:', chromosomes);
      this.results.push({
        test: 'Chromosomes',
        status: 'success',
        data: chromosomes,
        error: null
      });
    } catch (error) {
      console.error('❌ Chromosomes failed:', error);
      this.results.push({
        test: 'Chromosomes',
        status: 'error',
        data: null,
        error: error.message
      });
    }
  }

  async testGenes() {
    try {
      console.log('Testing: /api/genes/horse/1');
      const genes = await apiClient.getGenes('horse', '1');
      console.log('✅ Genes:', genes.slice(0, 3)); // Show first 3 genes
      this.results.push({
        test: 'Genes',
        status: 'success',
        data: `${genes.length} genes loaded`,
        error: null
      });
    } catch (error) {
      console.error('❌ Genes failed:', error);
      this.results.push({
        test: 'Genes',
        status: 'error',
        data: null,
        error: error.message
      });
    }
  }

  async testPets() {
    try {
      console.log('Testing: /api/pets');
      const pets = await apiClient.getPets();
      console.log('✅ Pets:', pets);
      this.results.push({
        test: 'Pets',
        status: 'success',
        data: `${pets.length} pets found`,
        error: null
      });
    } catch (error) {
      console.error('❌ Pets failed:', error);
      this.results.push({
        test: 'Pets',
        status: 'error',
        data: null,
        error: error.message
      });
    }
  }

  async testEffectOptions() {
    try {
      console.log('Testing: /api/effect-options');
      const effects = await apiClient.getEffectOptions();
      console.log('✅ Effect Options:', effects);
      this.results.push({
        test: 'Effect Options',
        status: 'success',
        data: effects,
        error: null
      });
    } catch (error) {
      console.error('❌ Effect Options failed:', error);
      this.results.push({
        test: 'Effect Options',
        status: 'error',
        data: null,
        error: error.message
      });
    }
  }

  printResults() {
    console.table(this.results);
  }
}

// Export a singleton instance for easy use
export const apiTester = new ApiTester();

// Add to window for manual testing in browser console
if (typeof window !== 'undefined') {
  window.apiTester = apiTester;
}
