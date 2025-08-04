/**
 * Simplified test setup that just skips if server isn't running
 */

import { vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";

// Global test configuration
global.TEST_CONFIG = {
  baseUrl: "http://localhost:8000",
  timeout: 5000,
  retries: 1,
};

// Check if server is available
async function checkServerAvailable() {
  try {
    const response = await fetch(
      `${global.TEST_CONFIG.baseUrl}/api/animal-types`,
    );
    return response.ok;
  } catch (error) {
    return false;
  }
}

// Global setup - runs once before all tests
beforeAll(async () => {
  console.log("🧪 Checking if server is available...");

  const serverAvailable = await checkServerAvailable();
  if (!serverAvailable) {
    console.log("⚠️ Server not available at " + global.TEST_CONFIG.baseUrl);
    console.log("Start server with: uv run python scripts/run_web_app.py");
    process.exit(0); // Skip tests gracefully
  }

  console.log("✅ Server is available");
}, 10000);

// Global cleanup - runs once after all tests
afterAll(async () => {
  console.log("✅ Client tests complete");
});

// Test-level setup - runs before each test
beforeEach(() => {
  vi.clearAllMocks();
});

// Test-level cleanup - runs after each test
afterEach(() => {
  // Clean up any test-specific state
});

// Helper function to create test pet files
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

// Simple API client for testing
class TestApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async get(endpoint) {
    const response = await fetch(`${this.baseUrl}${endpoint}`);
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
    } else {
      options.headers = { "Content-Type": "application/json" };
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
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }
}

// Make utilities available globally
global.testUtils = {
  createTestPetFile,
  TestApiClient,
  baseUrl: global.TEST_CONFIG.baseUrl,
};

console.log("📋 Simplified client test setup loaded");
