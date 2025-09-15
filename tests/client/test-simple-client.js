/**
 * Simplified client-side API integration tests for Gorgonetics
 *
 * These tests verify that the JavaScript API client used by the frontend
 * receives proper responses from the backend and handles them correctly.
 *
 * Note: These tests assume a server is already running on localhost:8000
 * Run `uv run python scripts/run_web_app.py` first to start the server.
 */

import { describe, it, expect, beforeAll } from "vitest";

// Test configuration
const BASE_URL = "http://localhost:8000";

// Simple API client for testing
class TestApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.authToken = null;
  }

  setAuthToken(token) {
    this.authToken = token;
  }

  getAuthHeaders() {
    return this.authToken ? { 'Authorization': `Bearer ${this.authToken}` } : {};
  }

  async get(endpoint) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: this.getAuthHeaders()
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  async post(endpoint, data, files = null) {
    const options = {
      method: "POST",
    };

    if (files) {
      const formData = new FormData();
      if (data) {
        Object.entries(data).forEach(([key, value]) => {
          formData.append(key, value);
        });
      }
      Object.entries(files).forEach(([key, file]) => {
        formData.append(key, file);
      });
      options.body = formData;
      options.headers = this.getAuthHeaders();
    } else {
      options.headers = { "Content-Type": "application/json", ...this.getAuthHeaders() };
      options.body = JSON.stringify(data);
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, options);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  async delete(endpoint) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "DELETE",
      headers: this.getAuthHeaders()
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  async register(username, password) {
    return this.post('/api/auth/register', { username, password });
  }

  async login(username, password) {
    return this.post('/api/auth/login', { username, password });
  }
}

// Helper function to check if server is available
async function checkServerAvailable() {
  try {
    const response = await fetch(`${BASE_URL}/api/animal-types`);
    return response.ok;
  } catch (error) {
    return false;
  }
}

// Helper function to create a test pet file
function createTestPetFile(name = "Test Pet Client", uniqueId = Date.now()) {
  const content = `[Overview]
Format=v1.0
Character=TestBreeder
Entity=${name}
Genome=Horse

[Genes]
01=RDRD RDRD RDRD RDRD RRDD RRDD RDRD RD${uniqueId.toString().slice(-2)}

End of Genome`;

  return new File([content], `${name.toLowerCase().replace(" ", "_")}.txt`, {
    type: "text/plain",
  });
}

let apiClient;

describe("🧬 Gorgonetics Client API Tests", () => {
  beforeAll(async () => {
    apiClient = new TestApiClient(BASE_URL);

    // Check if server is available
    const serverAvailable = await checkServerAvailable();
    if (!serverAvailable) {
      throw new Error(
        "Server is not available at " +
          BASE_URL +
          ". Please start the server with: uv run python scripts/run_web_app.py",
      );
    }
  });

  describe("🔬 Gene API Tests", () => {
    it("should get animal types", async () => {
      const animalTypes = await apiClient.get("/api/animal-types");

      expect(Array.isArray(animalTypes)).toBe(true);
      expect(animalTypes.length).toBeGreaterThan(0);
      expect(animalTypes).toContain("horse");
    });

    it("should get chromosomes for horse", async () => {
      const chromosomes = await apiClient.get("/api/chromosomes/horse");

      expect(Array.isArray(chromosomes)).toBe(true);
      expect(chromosomes.length).toBeGreaterThan(0);
      expect(chromosomes).toContain("01");
    });

    it("should get genes for horse chromosome 01", async () => {
      const genes = await apiClient.get("/api/genes/horse/01");

      expect(Array.isArray(genes)).toBe(true);
      expect(genes.length).toBeGreaterThan(0);

      // Check gene structure
      const firstGene = genes[0];
      expect(firstGene).toHaveProperty("gene");
      expect(firstGene).toHaveProperty("effectDominant");
      expect(firstGene).toHaveProperty("effectRecessive");
    });

    it("should get gene effects", async () => {
      const effects = await apiClient.get("/api/gene-effects/horse");

      expect(typeof effects).toBe("object");
      expect(Object.keys(effects).length).toBeGreaterThan(0);
    });

    it("should get effect options", async () => {
      const options = await apiClient.get("/api/effect-options");

      expect(Array.isArray(options)).toBe(true);
      expect(options.length).toBeGreaterThan(0);
      expect(options).toContain("None");
    });
  });

  describe("🐾 Pet API Tests", () => {
    let testPetId;

    beforeAll(async () => {
      // Create and authenticate test user
      const testUsername = `testuser_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const testPassword = 'testpassword123';

      try {
        // Register test user
        await apiClient.register(testUsername, testPassword);

        // Login test user
        const loginResult = await apiClient.login(testUsername, testPassword);

        // Set auth token
        apiClient.setAuthToken(loginResult.access_token);
      } catch (error) {
        console.error('Failed to setup test user for pet tests:', error);
        throw error;
      }
    });

    it("should get empty pets list initially", async () => {
      const pets = await apiClient.get("/api/pets");

      expect(Array.isArray(pets)).toBe(true);
      // Note: May not be empty if previous tests ran
    });

    it("should upload a pet file", async () => {
      const testFile = createTestPetFile("Client Test Pet");

      const result = await apiClient.post(
        "/api/pets/upload",
        { name: "Client Test Pet" },
        { file: testFile },
      );

      expect(result).toHaveProperty("status", "success");
      expect(result).toHaveProperty("pet_id");
      expect(typeof result.pet_id).toBe("number");

      testPetId = result.pet_id;
    });

    it("should get pet by ID", async () => {
      if (!testPetId) {
        // Upload a pet first if none exists
        const testFile = createTestPetFile("Fallback Pet");
        const uploadResult = await apiClient.post(
          "/api/pets/upload",
          { name: "Fallback Pet" },
          { file: testFile },
        );
        testPetId = uploadResult.pet_id;
      }

      const pet = await apiClient.get(`/api/pets/${testPetId}`);

      expect(pet).toHaveProperty("id", testPetId);
      expect(pet).toHaveProperty("name");
      expect(pet).toHaveProperty("species");
      expect(pet).toHaveProperty("created_at");
    });

    it("should get pet genome for visualization", async () => {
      if (!testPetId) {
        const testFile = createTestPetFile("Viz Pet");
        const uploadResult = await apiClient.post(
          "/api/pets/upload",
          { name: "Viz Pet" },
          { file: testFile },
        );
        testPetId = uploadResult.pet_id;
      }

      const genomeData = await apiClient.get(`/api/pet-genome/${testPetId}`);

      expect(genomeData).toHaveProperty("name");
      expect(genomeData).toHaveProperty("species");
      expect(genomeData).toHaveProperty("genes");
      expect(typeof genomeData.genes).toBe("object");
    });

    it("should delete a pet", async () => {
      if (!testPetId) {
        const testFile = createTestPetFile("Delete Pet");
        const uploadResult = await apiClient.post(
          "/api/pets/upload",
          { name: "Delete Pet" },
          { file: testFile },
        );
        testPetId = uploadResult.pet_id;
      }

      const result = await apiClient.delete(`/api/pets/${testPetId}`);

      expect(result).toHaveProperty("status", "success");

      // Verify pet is deleted by trying to get it (should fail)
      try {
        await apiClient.get(`/api/pets/${testPetId}`);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error.message).toContain("404");
      }
    });
  });

  describe("⚙️ Configuration API Tests", () => {
    it("should get attribute configuration for horse", async () => {
      const config = await apiClient.get("/api/attribute-config/horse");

      expect(config).toHaveProperty("species", "horse");
      expect(config).toHaveProperty("attributes");
      expect(Array.isArray(config.attributes)).toBe(true);
      expect(config.attributes.length).toBeGreaterThan(0);
    });

    it("should get appearance configuration for horse", async () => {
      const config = await apiClient.get("/api/appearance-config/horse");

      expect(config).toHaveProperty("species", "horse");
      expect(config).toHaveProperty("appearance_attributes");
      expect(Array.isArray(config.appearance_attributes)).toBe(true);
    });
  });

  describe("🚨 Error Handling Tests", () => {
    beforeAll(async () => {
      // Create and authenticate test user for error tests
      const testUsername = `testuser_err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const testPassword = 'testpassword123';

      try {
        // Register test user
        await apiClient.register(testUsername, testPassword);

        // Login test user
        const loginResult = await apiClient.login(testUsername, testPassword);

        // Set auth token
        apiClient.setAuthToken(loginResult.access_token);
      } catch (error) {
        console.error('Failed to setup test user for error tests:', error);
        throw error;
      }
    });
    it("should handle invalid species gracefully", async () => {
      const chromosomes = await apiClient.get(
        "/api/chromosomes/invalid_species",
      );

      // Should return empty array for invalid species
      expect(Array.isArray(chromosomes)).toBe(true);
      expect(chromosomes.length).toBe(0);
    });

    it("should handle invalid pet ID gracefully", async () => {
      try {
        await apiClient.get("/api/pets/99999");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error.message).toContain("404");
      }
    });

    it("should handle invalid file upload gracefully", async () => {
      const invalidFile = new File(["invalid content"], "invalid.txt", {
        type: "text/plain",
      });

      try {
        await apiClient.post(
          "/api/pets/upload",
          { name: "Invalid Pet" },
          { file: invalidFile },
        );
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error.message).toContain("400");
      }
    });
  });
});
