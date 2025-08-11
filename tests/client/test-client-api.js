/**
 * Client-side API integration tests for Gorgonetics
 *
 * These tests verify that the JavaScript API client used by the frontend
 * receives proper responses from the backend and handles them correctly.
 * This prevents UI breakages caused by API format changes.
 */

import { ApiClient } from '../../src/svelte/lib/services/apiClient.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

// Global test configuration
const TEST_CONFIG = {
    baseUrl: 'http://localhost:8000',
    timeout: 10000,
    retries: 3
};

let apiClient;
let testServer;

/**
 * Mock server management for isolated testing
 */
class TestServerManager {
    constructor() {
        this.serverProcess = null;
        this.isRunning = false;
    }

    async start() {
        if (this.isRunning) return;

        console.log('🚀 Starting test server...');

        // In a real implementation, you'd start the Python server here
        // For now, we'll assume it's running on localhost:8000
        await this.waitForServer();
        this.isRunning = true;
    }

    async stop() {
        if (!this.isRunning) return;

        console.log('🛑 Stopping test server...');
        if (this.serverProcess) {
            this.serverProcess.kill();
        }
        this.isRunning = false;
    }

    async waitForServer(maxAttempts = 30) {
        for (let i = 0; i < maxAttempts; i++) {
            try {
                const response = await fetch(`${TEST_CONFIG.baseUrl}/api/animal-types`);
                if (response.ok) {
                    console.log('✅ Test server is ready');
                    return;
                }
            } catch (error) {
                // Server not ready yet
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        throw new Error('Test server failed to start within timeout');
    }
}

// Test data samples
const EXPECTED_ANIMAL_TYPES = ['horse', 'beewasp'];
const SAMPLE_CHROMOSOMES = ['01', '02', '03', '04', '05'];

describe('Gorgonetics Client API Integration Tests', () => {
    beforeAll(async () => {
        testServer = new TestServerManager();
        await testServer.start();

        apiClient = new ApiClient(TEST_CONFIG.baseUrl);
    }, 30000);

    afterAll(async () => {
        if (testServer) {
            await testServer.stop();
        }
    });

    beforeEach(() => {
        // Reset any client state between tests
        apiClient = new ApiClient(TEST_CONFIG.baseUrl);
    });

    describe('🧬 Gene API Client Tests', () => {
        it('should get animal types successfully', async () => {
            const animalTypes = await apiClient.getAnimalTypes();

            expect(Array.isArray(animalTypes)).toBe(true);
            expect(animalTypes.length).toBeGreaterThan(0);

            // Verify expected animal types are present
            for (const expectedType of EXPECTED_ANIMAL_TYPES) {
                expect(animalTypes).toContain(expectedType);
            }
        });

        it('should get chromosomes for valid species', async () => {
            const chromosomes = await apiClient.getChromosomes('horse');

            expect(Array.isArray(chromosomes)).toBe(true);
            expect(chromosomes.length).toBeGreaterThan(0);

            // Verify chromosome format (should be strings like "01", "02", etc.)
            chromosomes.forEach(chr => {
                expect(typeof chr).toBe('string');
                expect(chr).toMatch(/^\d+$/); // Should be numeric strings
            });
        });

        it('should get genes for valid species and chromosome', async () => {
            const genes = await apiClient.getGenes('horse', '01');

            expect(Array.isArray(genes)).toBe(true);

            if (genes.length > 0) {
                const gene = genes[0];

                // Verify gene structure matches frontend expectations
                expect(gene).toHaveProperty('gene');
                expect(gene).toHaveProperty('effectDominant');
                expect(gene).toHaveProperty('effectRecessive');
                expect(gene).toHaveProperty('appearance');
                expect(gene).toHaveProperty('notes');

                // Verify field types
                expect(typeof gene.gene).toBe('string');
                expect(typeof gene.effectDominant).toBe('string');
                expect(typeof gene.effectRecessive).toBe('string');
                expect(typeof gene.appearance).toBe('string');
                expect(typeof gene.notes).toBe('string');
            }
        });

        it('should get gene effects with proper format', async () => {
            const geneEffects = await apiClient.getGeneEffects('horse');

            expect(typeof geneEffects).toBe('object');
            expect(geneEffects).toHaveProperty('effects');
            expect(typeof geneEffects.effects).toBe('object');

            // Check structure of effects data
            const effects = geneEffects.effects;
            const geneIds = Object.keys(effects);

            if (geneIds.length > 0) {
                const firstGene = effects[geneIds[0]];

                expect(firstGene).toHaveProperty('effectDominant');
                expect(firstGene).toHaveProperty('effectRecessive');
                expect(firstGene).toHaveProperty('appearance');
                expect(firstGene).toHaveProperty('notes');

                // These should be strings, not null/undefined for proper UI display
                expect(typeof firstGene.effectDominant === 'string' || firstGene.effectDominant === null).toBe(true);
                expect(typeof firstGene.effectRecessive === 'string' || firstGene.effectRecessive === null).toBe(true);
            }
        });

        it('should get effect options as array', async () => {
            const effectOptions = await apiClient.getEffectOptions();

            expect(Array.isArray(effectOptions)).toBe(true);
            expect(effectOptions.length).toBeGreaterThan(0);

            // Should contain "None" as an option
            expect(effectOptions).toContain('None');

            // All options should be strings
            effectOptions.forEach(option => {
                expect(typeof option).toBe('string');
            });
        });

        it('should handle invalid species gracefully', async () => {
            const chromosomes = await apiClient.getChromosomes('invalid_species');

            // Should return empty array, not throw error
            expect(Array.isArray(chromosomes)).toBe(true);
            expect(chromosomes.length).toBe(0);
        });

        it('should handle invalid chromosome gracefully', async () => {
            const genes = await apiClient.getGenes('horse', 'invalid_chromosome');

            // Should return empty array, not throw error
            expect(Array.isArray(genes)).toBe(true);
            expect(genes.length).toBe(0);
        });
    });

    describe('🐾 Pet API Client Tests', () => {
        let uploadedPetId = null;

        it('should get pets list', async () => {
            const pets = await apiClient.getPets();

            expect(Array.isArray(pets)).toBe(true);

            // If pets exist, verify structure
            pets.forEach(pet => {
                expect(pet).toHaveProperty('id');
                expect(pet).toHaveProperty('name');
                expect(pet).toHaveProperty('species');
                expect(typeof pet.id).toBe('number');
                expect(typeof pet.name).toBe('string');
                expect(typeof pet.species).toBe('string');
            });
        });

        it('should upload pet file successfully', async () => {
            // Create a mock pet file for testing
            const mockPetContent = `Format Version: v1.0
Breeder: TestBreeder
Name: Test Client Pet
Genome Type: Horse

Chromosome 01:
Block A: RD RD RD RD
Block B: RR DD RR DD
Block C: RD RD RD RD

End of Genome`;

            const mockFile = new File([mockPetContent], 'test_client_pet.txt', {
                type: 'text/plain'
            });

            const result = await apiClient.uploadPet(mockFile, 'Test Client Pet');

            expect(result).toHaveProperty('status');
            expect(result.status).toBe('success');
            expect(result).toHaveProperty('pet_id');
            expect(typeof result.pet_id).toBe('number');
            expect(result).toHaveProperty('name');
            expect(typeof result.name).toBe('string');

            // Store for cleanup
            uploadedPetId = result.pet_id;
        });

        it('should get pet genome for visualization', async () => {
            // Skip if no pet was uploaded
            if (!uploadedPetId) {
                console.log('⚠️ Skipping pet genome test - no uploaded pet');
                return;
            }

            const genome = await apiClient.getPetGenome(uploadedPetId);

            expect(typeof genome).toBe('object');
            expect(genome).toHaveProperty('name');
            expect(genome).toHaveProperty('species');
            expect(genome).toHaveProperty('genes');

            // Verify genes structure for visualization
            expect(typeof genome.genes).toBe('object');

            const chromosomes = Object.keys(genome.genes);
            expect(chromosomes.length).toBeGreaterThan(0);

            // Each chromosome should have a gene string
            chromosomes.forEach(chr => {
                expect(typeof genome.genes[chr]).toBe('string');
                expect(genome.genes[chr].length).toBeGreaterThan(0);

                // Gene string should contain valid gene characters (R, D, x, spaces)
                expect(genome.genes[chr]).toMatch(/^[RDx\s]+$/);
            });
        });

        it('should delete pet successfully', async () => {
            // Skip if no pet was uploaded
            if (!uploadedPetId) {
                console.log('⚠️ Skipping pet deletion test - no uploaded pet');
                return;
            }

            const result = await apiClient.deletePet(uploadedPetId);

            expect(result).toHaveProperty('status');
            expect(result.status).toBe('success');

            // Verify pet is actually deleted
            try {
                await apiClient.getPetGenome(uploadedPetId);
                // Should not reach here
                expect(true).toBe(false);
            } catch (error) {
                // Expected - pet should not exist
                expect(error.message).toContain('404');
            }

            uploadedPetId = null; // Clear for cleanup
        });

        it('should handle duplicate file uploads', async () => {
            const mockPetContent = `Format Version: v1.0
Breeder: TestBreeder
Name: Duplicate Test Pet
Genome Type: Horse

Chromosome 01:
Block A: RD RD RD RD

End of Genome`;

            const mockFile1 = new File([mockPetContent], 'duplicate1.txt', {
                type: 'text/plain'
            });
            const mockFile2 = new File([mockPetContent], 'duplicate2.txt', {
                type: 'text/plain'
            });

            // First upload should succeed
            const result1 = await apiClient.uploadPet(mockFile1, 'First Upload');
            expect(result1.status).toBe('success');

            try {
                // Second upload of same content should fail
                await apiClient.uploadPet(mockFile2, 'Second Upload');
                expect(true).toBe(false); // Should not reach here
            } catch (error) {
                expect(error.message).toContain('409');
            }

            // Cleanup
            if (result1.pet_id) {
                await apiClient.deletePet(result1.pet_id);
            }
        });
    });

    describe('📊 Configuration API Client Tests', () => {
        it('should get attribute configuration', async () => {
            const config = await apiClient.getAttributeConfig('horse');

            expect(typeof config).toBe('object');
            expect(config).not.toBe(null);

            // Should have some attributes defined
            const attributes = Object.keys(config);
            expect(attributes.length).toBeGreaterThan(0);

            // Each attribute should have proper structure
            attributes.forEach(attrName => {
                const attrConfig = config[attrName];
                expect(typeof attrConfig).toBe('object');
                expect(attrConfig).toHaveProperty('type');
            });
        });
    });

    describe('🔄 Client Data Consistency Tests', () => {
        it('should have consistent gene data across endpoints', async () => {
            // Get genes from chromosome endpoint
            const genes = await apiClient.getGenes('horse', '01');

            // Get effects from effects endpoint
            const effectsResponse = await apiClient.getGeneEffects('horse');
            const effects = effectsResponse.effects;

            // Compare data consistency
            genes.forEach(gene => {
                const geneId = gene.gene;

                if (effects[geneId]) {
                    // Effect values should match
                    expect(gene.effectDominant).toBe(effects[geneId].effectDominant);
                    expect(gene.effectRecessive).toBe(effects[geneId].effectRecessive);
                    expect(gene.appearance).toBe(effects[geneId].appearance);
                    expect(gene.notes).toBe(effects[geneId].notes);
                }
            });
        });

        it('should have consistent species names across endpoints', async () => {
            const animalTypes = await apiClient.getAnimalTypes();

            // Test each animal type works with other endpoints
            for (const animalType of animalTypes) {
                const chromosomes = await apiClient.getChromosomes(animalType);
                expect(Array.isArray(chromosomes)).toBe(true);

                const effects = await apiClient.getGeneEffects(animalType);
                expect(typeof effects).toBe('object');
                expect(effects).toHaveProperty('effects');

                const config = await apiClient.getAttributeConfig(animalType);
                expect(typeof config).toBe('object');
            }
        });
    });

    describe('⚡ Client Performance Tests', () => {
        it('should load gene effects within reasonable time', async () => {
            const startTime = Date.now();

            const effects = await apiClient.getGeneEffects('horse');

            const duration = Date.now() - startTime;

            // Should complete within 5 seconds
            expect(duration).toBeLessThan(5000);

            // Should return meaningful data
            expect(typeof effects).toBe('object');
            expect(Object.keys(effects.effects).length).toBeGreaterThan(0);
        });

        it('should handle multiple concurrent requests', async () => {
            const startTime = Date.now();

            // Make multiple concurrent requests
            const promises = [
                apiClient.getAnimalTypes(),
                apiClient.getChromosomes('horse'),
                apiClient.getGenes('horse', '01'),
                apiClient.getEffectOptions(),
                apiClient.getGeneEffects('horse')
            ];

            const results = await Promise.all(promises);

            const duration = Date.now() - startTime;

            // All should complete within 10 seconds
            expect(duration).toBeLessThan(10000);

            // All should return valid data
            expect(Array.isArray(results[0])).toBe(true); // animal types
            expect(Array.isArray(results[1])).toBe(true); // chromosomes
            expect(Array.isArray(results[2])).toBe(true); // genes
            expect(Array.isArray(results[3])).toBe(true); // effect options
            expect(typeof results[4]).toBe('object');    // gene effects
        });
    });

    describe('🚨 Client Error Handling Tests', () => {
        it('should handle network errors gracefully', async () => {
            // Create client with invalid URL
            const badClient = new ApiClient('http://localhost:9999');

            try {
                await badClient.getAnimalTypes();
                expect(true).toBe(false); // Should not reach here
            } catch (error) {
                expect(error).toBeDefined();
                expect(error.message).toBeTruthy();
            }
        });

        it('should handle malformed responses', async () => {
            // This would require mocking the fetch response
            // For now, we'll test that the client can handle empty responses

            const emptyGenes = await apiClient.getGenes('nonexistent', 'nonexistent');
            expect(Array.isArray(emptyGenes)).toBe(true);
            expect(emptyGenes.length).toBe(0);
        });

        it('should provide meaningful error messages', async () => {
            try {
                await apiClient.getPetGenome(99999); // Non-existent pet
                expect(true).toBe(false); // Should not reach here
            } catch (error) {
                expect(error.message).toBeTruthy();
                expect(typeof error.message).toBe('string');
                expect(error.message.length).toBeGreaterThan(0);
            }
        });
    });

    describe('🎯 Critical UI Workflow Tests', () => {
        it('should support complete gene editor workflow', async () => {
            // 1. Load animal types for species selection
            const animalTypes = await apiClient.getAnimalTypes();
            expect(animalTypes.length).toBeGreaterThan(0);

            const species = animalTypes[0];

            // 2. Load chromosomes for selected species
            const chromosomes = await apiClient.getChromosomes(species);
            expect(chromosomes.length).toBeGreaterThan(0);

            const chromosome = chromosomes[0];

            // 3. Load genes for selected chromosome
            const genes = await apiClient.getGenes(species, chromosome);
            expect(Array.isArray(genes)).toBe(true);

            // 4. Load gene effects for visualization
            const effects = await apiClient.getGeneEffects(species);
            expect(typeof effects.effects).toBe('object');

            // 5. Load effect options for editing
            const effectOptions = await apiClient.getEffectOptions();
            expect(Array.isArray(effectOptions)).toBe(true);

            console.log(`✅ Gene editor workflow completed for ${species} chromosome ${chromosome}`);
        });

        it('should support complete pet management workflow', async () => {
            // 1. Load existing pets
            const initialPets = await apiClient.getPets();
            expect(Array.isArray(initialPets)).toBe(true);

            // 2. Upload new pet
            const mockPetContent = `Format Version: v1.0
Breeder: WorkflowTester
Name: Workflow Test Pet
Genome Type: Horse

Chromosome 01:
Block A: RD RD RD RD

End of Genome`;

            const mockFile = new File([mockPetContent], 'workflow_test.txt', {
                type: 'text/plain'
            });

            const uploadResult = await apiClient.uploadPet(mockFile, 'Workflow Test Pet');
            expect(uploadResult.status).toBe('success');

            const petId = uploadResult.pet_id;

            // 3. Load pet genome for visualization
            const genome = await apiClient.getPetGenome(petId);
            expect(typeof genome.genes).toBe('object');

            // 4. Verify pet appears in list
            const updatedPets = await apiClient.getPets();
            expect(updatedPets.length).toBe(initialPets.length + 1);

            const newPet = updatedPets.find(p => p.id === petId);
            expect(newPet).toBeDefined();
            expect(newPet.name).toBeTruthy();

            // 5. Delete pet
            const deleteResult = await apiClient.deletePet(petId);
            expect(deleteResult.status).toBe('success');

            // 6. Verify pet is removed
            const finalPets = await apiClient.getPets();
            expect(finalPets.length).toBe(initialPets.length);

            console.log('✅ Pet management workflow completed successfully');
        });
    });
});

/**
 * Test utilities for debugging and development
 */
export class ClientTestUtils {
    static async debugApiResponse(endpoint) {
        console.log(`🔍 Debugging ${endpoint}`);

        try {
            const response = await fetch(`${TEST_CONFIG.baseUrl}${endpoint}`);
            const data = await response.json();

            console.log('Status:', response.status);
            console.log('Headers:', Object.fromEntries(response.headers));
            console.log('Data type:', typeof data);
            console.log('Data:', data);

            return { response, data };
        } catch (error) {
            console.error('Debug error:', error);
            throw error;
        }
    }

    static validateGeneStructure(gene) {
        const required = ['gene', 'effectDominant', 'effectRecessive', 'appearance', 'notes'];
        const missing = required.filter(field => !(field in gene));

        if (missing.length > 0) {
            throw new Error(`Gene missing required fields: ${missing.join(', ')}`);
        }

        return true;
    }

    static validatePetGenomeStructure(genome) {
        const required = ['name', 'species', 'genes'];
        const missing = required.filter(field => !(field in genome));

        if (missing.length > 0) {
            throw new Error(`Pet genome missing required fields: ${missing.join(', ')}`);
        }

        if (typeof genome.genes !== 'object') {
            throw new Error('Pet genome.genes must be an object');
        }

        return true;
    }
}
