# Client-Side API Integration Tests

This directory contains JavaScript/client-side integration tests that verify the frontend API client receives proper responses from the backend. These tests ensure that the JavaScript code used by the Svelte frontend works correctly with the Python API.

## 🎯 Purpose

While the Python integration tests verify that API endpoints work correctly, these client tests verify that:
- ✅ The **JavaScript API client** receives expected response formats
- ✅ **Frontend code** can properly parse and use API responses  
- ✅ **Real browser behavior** matches expectations
- ✅ **Client-side error handling** works correctly
- ✅ **Complete user workflows** function end-to-end

## 🚀 Quick Start

```bash
# Run all client tests
pnpm run test:client

# Run with watch mode for development
pnpm run test:client:watch

# Open interactive test UI
pnpm run test:client:ui

# Run with coverage report
pnpm run test:client:coverage

# Alternative using shell script
./test.sh client
./test.sh client-ui
```

## 📁 Test Structure

```
tests/client/
├── README.md                 # This file
├── test-client-api.js        # Main client test suite
├── setup.js                  # Test environment setup
└── utils/                    # Test utilities (future)
```

## 🧪 Test Categories

### 🧬 Gene API Client Tests
**Critical for gene editor functionality**
- Tests that `apiClient.getAnimalTypes()` returns proper array
- Tests that `apiClient.getChromosomes(species)` works correctly
- Tests that `apiClient.getGenes(species, chromosome)` returns expected format
- Tests that `apiClient.getGeneEffects(species)` provides visualization data
- **Why crucial**: Gene editor UI depends on these exact data formats

### 🐾 Pet API Client Tests
**Critical for pet management workflows**
- Tests that `apiClient.uploadPet(file, name)` handles file uploads
- Tests that `apiClient.getPetGenome(id)` returns visualization-ready data
- Tests that `apiClient.deletePet(id)` works correctly
- Tests duplicate detection and error handling
- **Why crucial**: Pet upload/management is core user functionality

### 📊 Configuration API Client Tests
**Critical for UI configuration**
- Tests that `apiClient.getAttributeConfig(species)` returns proper config
- Tests configuration data structure matches frontend expectations
- **Why crucial**: UI layout and options depend on this data

### 🔄 Client Data Consistency Tests
**Prevents UI display bugs**
- Tests that gene data is consistent between different API calls
- Tests that field names match frontend expectations (camelCase)
- Tests that species names work across all client methods
- **Why crucial**: Prevents gene effects not showing, broken links between data

### ⚡ Client Performance Tests
**Ensures responsive UI**
- Tests that large datasets load within reasonable time
- Tests concurrent API calls work correctly
- Tests memory usage doesn't grow excessively
- **Why crucial**: Prevents UI freezing, slow responses

### 🚨 Client Error Handling Tests
**Prevents UI crashes**
- Tests network failure handling
- Tests malformed response handling
- Tests meaningful error messages
- **Why crucial**: Graceful degradation when backend has issues

### 🎯 Critical UI Workflow Tests
**End-to-end user scenarios**
- **Gene Editor Workflow**: Select species → load chromosomes → view genes → see effects
- **Pet Management Workflow**: Upload pet → view genome → delete pet
- **Why crucial**: These are complete user journeys that must work

## 🔍 What These Tests Catch

**Real issues that affect users:**

1. **Gene Effects Not Displaying**
   ```javascript
   // ❌ Backend returns snake_case but frontend expects camelCase
   expect(gene.effectDominant).toBeDefined(); // Would fail
   expect(gene.effectDominant).toBeDefined(); // Backend format
   ```

2. **Pet Upload Failures**
   ```javascript
   // ❌ File upload returns unexpected format
   const result = await apiClient.uploadPet(file, name);
   expect(result.pet_id).toBeNumber(); // Would fail if returns string
   ```

3. **Broken Gene Visualization**
   ```javascript
   // ❌ Pet genome data wrong format for visualization
   const genome = await apiClient.getPetGenome(id);
   expect(genome.genes['01']).toMatch(/^[RDx\s]+$/); // Would fail if wrong format
   ```

4. **Network Error Crashes**
   ```javascript
   // ❌ Network failure causes UI crash
   try {
     await apiClient.getAnimalTypes();
   } catch (error) {
     expect(error.message).toBeTruthy(); // Should have meaningful message
   }
   ```

## 🏃‍♂️ Running Tests

### Development Workflow

```bash
# Start development - watches for changes
pnpm run test:client:watch

# Run specific test category
node scripts/run_client_tests.js --filter "Gene API"

# Debug specific test
node scripts/run_client_tests.js --filter "should get gene effects" --verbose
```

### CI/CD Integration

```bash
# Run all tests (for CI)
pnpm run test:client

# Run with coverage (for reports)
pnpm run test:client:coverage

# Health check environment
node scripts/run_client_tests.js health
```

### Interactive Debugging

```bash
# Open test UI for visual debugging
pnpm run test:client:ui

# Run in browser environment
node scripts/run_client_tests.js ui
```

## 🔧 Test Environment

### Automatic Setup
Tests automatically:
- ✅ Start Python backend server
- ✅ Populate test database with gene data
- ✅ Wait for server to be ready
- ✅ Clean up after tests complete

### Environment Variables
```bash
GORGONETICS_DB_BACKEND=ducklake
GORGONETICS_CATALOG_TYPE=sqlite
GORGONETICS_CATALOG_PATH=test_client_metadata.sqlite
GORGONETICS_DATA_PATH=test_client_data
```

### Dependencies
- **Vitest**: Modern testing framework
- **jsdom**: Browser environment simulation
- **Node.js 16+**: Runtime environment

## 📊 Understanding Test Results

### ✅ Successful Test Run
```
🧬 Gene API Client Tests
✅ should get animal types successfully
✅ should get chromosomes for valid species  
✅ should get gene effects with proper format

🐾 Pet API Client Tests
✅ should upload pet file successfully
✅ should get pet genome for visualization
✅ should delete pet successfully

🎯 Critical UI Workflow Tests
✅ should support complete gene editor workflow
✅ should support complete pet management workflow

All tests passed! JavaScript API client is working correctly.
```

### ❌ Common Test Failures

**Gene Effects Format Error:**
```
❌ should get gene effects with proper format
   Expected gene.effectDominant to be string, got undefined

Fix: Backend returning snake_case instead of camelCase
```

**Pet Upload Error:**
```
❌ should upload pet file successfully
   Expected response.pet_id to be number, got string

Fix: Backend returning wrong data type for pet_id
```

**Network Timeout:**
```
❌ should load gene effects within reasonable time
   Test timed out after 5000ms

Fix: Backend performance issue or server not responding
```

## 🛠️ Writing New Client Tests

### For New API Methods

```javascript
it('should test new API method', async () => {
    const result = await apiClient.newMethod(params);
    
    // Test response structure
    expect(result).toHaveProperty('expectedField');
    expect(typeof result.expectedField).toBe('string');
    
    // Test data validity
    expect(result.data.length).toBeGreaterThan(0);
});
```

### For UI Workflows

```javascript
it('should support new user workflow', async () => {
    // Step 1: User action
    const step1 = await apiClient.firstAction();
    expect(step1.status).toBe('success');
    
    // Step 2: Dependent action
    const step2 = await apiClient.secondAction(step1.id);
    expect(step2).toHaveProperty('expectedResult');
    
    // Step 3: Verification
    const final = await apiClient.verify();
    expect(final.includes(step2.expectedResult)).toBe(true);
});
```

### For Error Handling

```javascript
it('should handle specific error gracefully', async () => {
    try {
        await apiClient.methodThatFails();
        expect(true).toBe(false); // Should not reach here
    } catch (error) {
        expect(error.message).toContain('meaningful error');
        expect(error.status).toBe(expectedStatusCode);
    }
});
```

## 🔄 Integration with Python Tests

| Python Tests | Client Tests | What They Verify |
|-------------|-------------|------------------|
| `test_get_gene_effects` | `should get gene effects with proper format` | Backend returns data + Frontend receives it correctly |
| `test_upload_pet` | `should upload pet file successfully` | Backend accepts upload + Frontend handles response |
| `test_data_consistency` | `should have consistent gene data` | Backend data consistent + Frontend sees consistency |

**Both test suites must pass** for full confidence that the UI will work correctly.

## 🚨 Critical Tests That Must Pass

### For Gene Editor to Work:
- ✅ `should get animal types successfully`
- ✅ `should get chromosomes for valid species`
- ✅ `should get gene effects with proper format`
- ✅ `should support complete gene editor workflow`

### For Pet Management to Work:
- ✅ `should upload pet file successfully`
- ✅ `should get pet genome for visualization`
- ✅ `should delete pet successfully`
- ✅ `should support complete pet management workflow`

### For UI Stability:
- ✅ `should handle network errors gracefully`
- ✅ `should have consistent gene data across endpoints`
- ✅ All performance tests under time limits

## 🏆 Success Metrics

When all client tests pass, you can be confident that:

✅ **Gene Editor Will Work**
- Species dropdown populates correctly
- Chromosome navigation functions
- Gene effects show in tooltips
- Gene data loads properly

✅ **Pet Management Will Work**  
- File uploads complete successfully
- Pet genome visualizes correctly
- Pet deletion removes pets
- Duplicate detection prevents conflicts

✅ **UI Won't Crash**
- Network errors show friendly messages
- Malformed responses handled gracefully
- Large datasets don't freeze interface
- Concurrent operations work correctly

✅ **Data Consistency Maintained**
- Gene effects match between endpoints
- Field names consistent throughout
- Species names work everywhere

## 🔮 Future Enhancements

Planned additions:
- **Visual regression tests** - Screenshots of UI components
- **Performance benchmarks** - Track response time trends
- **Cross-browser testing** - Verify Safari, Firefox compatibility
- **Mobile responsiveness** - Test touch interactions
- **Accessibility testing** - Screen reader compatibility
- **Security testing** - XSS, injection prevention

## 📞 Troubleshooting

### Tests Won't Start
```bash
# Check Node.js version
node --version  # Should be 16+

# Install dependencies
pnpm install

# Check test files exist
ls tests/client/
```

### Server Connection Issues
```bash
# Check if server is running
curl http://localhost:8000/api/animal-types

# Check test database
ls test_client_*

# Restart with clean environment
./test.sh clean
./test.sh setup
```

### Memory/Performance Issues
```bash
# Run single test category
node scripts/run_client_tests.js --filter "Gene API"

# Check resource usage
node --max-old-space-size=4096 scripts/run_client_tests.js
```

Remember: **Client test failures usually mean the frontend JavaScript code won't work correctly with the backend API!**