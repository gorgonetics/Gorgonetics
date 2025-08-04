# Integration Tests for Gorgonetics

This directory contains integration tests that ensure the API endpoints work correctly and prevent regressions that would break UI functionality.

## 🎯 Purpose

These tests verify that:
- ✅ All API endpoints return the expected data format
- ✅ Gene effects display correctly in the UI
- ✅ Pet upload and management work properly
- ✅ Database backends (DuckDB and DuckLake) are compatible
- ✅ Error handling prevents UI crashes

## 🚀 Quick Start

```bash
# Run most important tests (gene endpoints)
./test.sh genes

# Run quick tests (excludes slow performance tests)
./test.sh quick

# Run data consistency tests (prevents UI bugs)
./test.sh consistency

# Run all tests
./test.sh all
```

## 📁 Test Structure

```
tests/integration/
├── README.md                     # This file
├── test_api_integration.py       # Main test suite
└── conftest.py                   # (Future: shared fixtures)
```

## 🧪 Test Categories

### 🧬 Gene API Tests - `TestGeneEndpoints`
**Critical for gene editor functionality**
- `/api/animal-types` - Species selection dropdown
- `/api/chromosomes/{species}` - Chromosome navigation
- `/api/genes/{species}/{chromosome}` - Gene data loading
- `/api/gene-effects/{species}` - Gene effect tooltips and visualization
- `/api/effect-options` - Effect dropdown options

### 🐾 Pet API Tests - `TestPetEndpoints`  
**Critical for pet management**
- `/api/pets/upload` - Pet genome file upload
- `/api/pets` - Pet list display
- `/api/pet-genome/{id}` - Pet visualization
- `/api/pets/{id}` - Pet details and deletion

### ⚙️ Config Tests - `TestConfigEndpoints`
**Critical for UI configuration**
- `/api/attribute-config/{species}` - Species-specific settings
- `/api/appearance-config` - Visual configuration

### 🔄 Data Consistency Tests - `TestDataConsistency`
**Prevents UI display bugs**
- Gene data matches between endpoints
- Field names are consistent (camelCase vs snake_case)
- Species names work across all endpoints

### 🚨 Error Handling Tests - `TestErrorHandling`
**Prevents UI crashes**
- Invalid species/chromosome handling
- File upload error handling
- Non-existent pet handling

### ⚡ Performance Tests - `TestPerformance`
**Ensures responsive UI**
- Large dataset handling (< 5 seconds)
- Concurrent request handling
- Memory usage validation

## 🎯 Critical Test Results

**✅ MUST PASS for UI to work:**
- `test_get_gene_effects` - Gene tooltips depend on this
- `test_get_pet_genome_visualization` - Pet display depends on this
- `test_gene_data_consistency` - Prevents gene effect display bugs
- `test_upload_pet` - Core user workflow

**⚠️ Should pass but UI can degrade gracefully:**
- Performance tests
- Error handling edge cases
- Configuration endpoints

## 🐛 Common Test Failures

### Gene Effects Not Showing
```
FAILED test_get_gene_effects - KeyError: 'effectDominant'
```
**Cause:** Database returning snake_case (`effect_dominant`) instead of camelCase (`effectDominant`)
**Fix:** Update database methods to return camelCase field names

### Pet Upload Failures  
```
FAILED test_upload_pet - AssertionError: assert 500 == 200
```
**Cause:** Usually JSON parsing or field name mismatch
**Fix:** Check genome_data serialization in database layer

### Data Consistency Failures
```
FAILED test_gene_data_consistency - AssertionError: gene effects don't match
```
**Cause:** Different endpoints returning different data formats
**Fix:** Ensure all endpoints use same database methods

### Performance Issues
```
FAILED test_large_dataset_handling - TimeoutError
```
**Cause:** Database queries taking too long
**Fix:** Check database indexes and query optimization

## 🔧 Running Specific Tests

```bash
# Test specific endpoint
uv run python -m pytest tests/integration/test_api_integration.py::TestGeneEndpoints::test_get_gene_effects -v

# Test specific category
uv run python -m pytest tests/integration/test_api_integration.py::TestGeneEndpoints -v

# Test with verbose output
uv run python -m pytest tests/integration/ -v -s

# Test with coverage
uv run python -m pytest tests/integration/ --cov=src/gorgonetics --cov-report=html
```

## 🚦 CI/CD Integration

Tests run automatically on:
- **Push to main/develop** - Full test suite
- **Pull requests** - Full test suite  
- **Daily schedule** - Extended test suite with performance tests
- **Manual trigger** - Custom test configurations

GitHub Actions workflow: `.github/workflows/integration-tests.yml`

## 📊 Test Data

Tests use minimal sample data:
- **Horse genes**: 2 test genes with different effects
- **BeeWasp genes**: 1 test gene with effects
- **Sample pet file**: Valid genome format for upload testing

Test data is automatically populated from the main gene JSON files in `assets/`.

## 🛠️ Adding New Tests

### For New API Endpoints

1. Add test method to appropriate test class
2. Test both success and error cases
3. Verify response format matches frontend expectations

```python
def test_new_endpoint(self, client, test_database):
    """Test new API endpoint."""
    response = client.get("/api/new-endpoint")
    
    assert response.status_code == 200
    data = response.json()
    assert "required_field" in data
```

### For New Features

1. Create new test class if needed
2. Test the complete user workflow
3. Add performance test if handling large data
4. Add error handling test for edge cases

## 🔍 Debugging Failed Tests

### 1. Check Test Logs
```bash
uv run python -m pytest tests/integration/ -v -s --tb=long
```

### 2. Run Single Test
```bash
uv run python -m pytest tests/integration/test_api_integration.py::TestGeneEndpoints::test_get_gene_effects -v -s
```

### 3. Check Database State
```bash
# Manually test database
uv run python -c "
from src.gorgonetics.database_config import create_database_instance
db = create_database_instance()
print('Animal types:', db.get_animal_types())
"
```

### 4. Test API Directly
```bash
# Start web app and test manually
uv run python scripts/run_web_app.py &
curl http://localhost:8000/api/animal-types
```

## 📈 Success Metrics

**API Reliability:**
- All critical endpoints return 200 OK
- Response times under target thresholds
- Data format consistency maintained

**UI Compatibility:**
- Gene effects display correctly
- Pet uploads work end-to-end
- Error states handled gracefully

**Performance:**
- Gene effects load in < 5 seconds
- Pet uploads complete in < 10 seconds
- Concurrent users supported

## 🎉 What Success Looks Like

When all tests pass:
```
🧬 Gene API Tests
==================================================
✅ test_get_animal_types PASSED
✅ test_get_gene_effects PASSED
✅ test_get_chromosomes PASSED

🐾 Pet API Tests  
==================================================
✅ test_upload_pet PASSED
✅ test_get_pet_genome_visualization PASSED
✅ test_delete_pet PASSED

🔄 Data Consistency Tests
==================================================
✅ test_gene_data_consistency PASSED
✅ test_species_consistency PASSED

🎉 All integration tests passed!
✅ API endpoints are working correctly
✅ UI functionality should not be broken
```

**This means:**
- Users can select species and view chromosomes
- Gene effects show up in tooltips and visualization
- Pet uploads work correctly
- Pet genome visualization displays properly
- Gene editor loads and functions correctly
- No UI crashes from API errors

Remember: **Integration test failures usually mean the UI will be broken for users!**