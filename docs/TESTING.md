# Testing Guide for Gorgonetics

This document explains the testing strategy and how to run tests for the Gorgonetics project.

## Overview

Gorgonetics uses a comprehensive testing strategy to ensure that API endpoints work correctly and prevent regressions that would break UI functionality. The testing approach focuses on integration tests that verify the complete data flow from database to API endpoints.

## Test Structure

```
tests/
├── integration/
│   └── test_api_integration.py    # Main integration test suite
└── unit/                          # (Future: unit tests)
```

## Test Categories

### 1. Gene API Tests (`TestGeneEndpoints`)
Tests all gene-related API endpoints that the frontend depends on:
- `/api/animal-types` - Get available species
- `/api/chromosomes/{species}` - Get chromosomes for a species
- `/api/genes/{species}/{chromosome}` - Get genes for a chromosome
- `/api/gene-effects/{species}` - Get gene effects for visualization
- `/api/effect-options` - Get available effect options

**Why these matter for UI:**
- Gene editor needs to load chromosomes and genes
- Gene effects are critical for visualization and tooltips
- Effect options are needed for gene editing dropdowns

### 2. Pet API Tests (`TestPetEndpoints`)
Tests all pet-related functionality:
- `/api/pets` - List pets
- `/api/pets/upload` - Upload pet genome files
- `/api/pets/{id}` - Get specific pet data
- `/api/pet-genome/{id}` - Get pet genome for visualization
- `/api/pets/{id}` (DELETE) - Delete pets

**Why these matter for UI:**
- Pet upload is a core user workflow
- Pet visualization requires genome data in specific format
- Pet management (view, delete) is essential functionality

### 3. Configuration Tests (`TestConfigEndpoints`)
Tests configuration endpoints:
- `/api/attribute-config/{species}` - Species-specific attributes
- `/api/appearance-config` - Appearance configuration

### 4. Error Handling Tests (`TestErrorHandling`)
Tests that the API handles edge cases gracefully:
- Invalid species names
- Non-existent chromosomes
- Invalid file uploads
- Missing pets

**Why these matter for UI:**
- Prevents crashes when users provide invalid input
- Ensures graceful degradation of functionality

### 5. Data Consistency Tests (`TestDataConsistency`)
Tests that data is consistent across different endpoints:
- Gene data matches between chromosome and effects endpoints
- Species names are consistent across all endpoints
- Field names match expected format (camelCase vs snake_case)

**Why these matter for UI:**
- Prevents display bugs caused by data mismatches
- Ensures gene effects properly map to genome visualization

### 6. Performance Tests (`TestPerformance`)
Tests that endpoints respond within reasonable time limits:
- Large dataset handling
- Concurrent request handling

## Running Tests

### Quick Start

```bash
# Install dependencies
make setup

# Run all integration tests
make test-integration

# Run quick tests (excludes performance tests)
make test-quick

# Run specific test categories
make test-api
```

### Detailed Test Running

```bash
# Run tests with detailed category breakdown
uv run python scripts/run_integration_tests.py --categories

# Run only performance tests
uv run python scripts/run_integration_tests.py --performance

# Run tests with coverage report
uv run python scripts/run_integration_tests.py --coverage

# Run specific test class
uv run pytest tests/integration/test_api_integration.py::TestGeneEndpoints -v

# Run specific test method
uv run pytest tests/integration/test_api_integration.py::TestGeneEndpoints::test_get_gene_effects -v
```

### Test Environment

Tests automatically set up an isolated test environment:
- Uses temporary database files
- Populates test data from gene JSON files
- Cleans up after completion

Environment variables are automatically configured for testing:
```bash
GORGONETICS_DB_BACKEND=ducklake
GORGONETICS_CATALOG_TYPE=sqlite
GORGONETICS_CATALOG_PATH=/tmp/test_metadata.sqlite
GORGONETICS_DATA_PATH=/tmp/test_data
```

## Understanding Test Output

### Successful Test Run
```
🧬 Gene API Tests
==================================================
✅ test_get_animal_types PASSED
✅ test_get_chromosomes PASSED
✅ test_get_gene_effects PASSED

🐾 Pet API Tests
==================================================
✅ test_upload_pet PASSED
✅ test_get_pet_genome_visualization PASSED
✅ test_delete_pet PASSED

📊 Test Results Summary
==================================================
✅ PASS 🧬 Gene API Tests
✅ PASS 🐾 Pet API Tests
✅ PASS ⚙️ Config API Tests
✅ PASS 🚨 Error Handling Tests
✅ PASS 🔄 Data Consistency Tests

Overall: 5/5 categories passed
🎉 All integration tests passed!
```

### Failed Test Analysis
When tests fail, check these common issues:

1. **Field Name Mismatch** (e.g., `effectDominant` vs `effect_dominant`)
   ```
   AssertionError: assert 'effect_dominant' in gene
   ```
   - Indicates database is returning snake_case instead of camelCase
   - Frontend expects camelCase field names

2. **Missing Data**
   ```
   AssertionError: assert len(data) > 0
   ```
   - Database may not be populated
   - Check gene data loading

3. **Type Errors**
   ```
   AssertionError: assert isinstance(data['genome_data'], str)
   ```
   - Database returning wrong data type
   - Check JSON serialization

4. **Timeout Errors**
   ```
   TimeoutExpired: Command timed out after 120 seconds
   ```
   - Performance issue or infinite loop
   - Check database query efficiency

## Critical API Requirements for UI

The frontend depends on these specific API contract requirements:

### Gene Effects Format
```json
{
  "effects": {
    "01A1": {
      "effectDominant": "None",
      "effectRecessive": "Intelligence+",
      "appearance": "Mane Color",
      "notes": "Test notes"
    }
  }
}
```

### Pet Genome Format
```json
{
  "name": "Pet Name",
  "owner": "Breeder Name",
  "species": "Horse",
  "format": "v1.0",
  "genes": {
    "01": "RDRD RDRR RDRD...",
    "02": "RRDD RRDD RRDD..."
  }
}
```

### Gene Data Format
```json
[
  {
    "gene": "01A1",
    "effectDominant": "None",
    "effectRecessive": "Intelligence+",
    "appearance": "Mane Color",
    "notes": "Test notes"
  }
]
```

## Continuous Integration

Tests run automatically on:
- Push to `main` or `develop` branches
- Pull requests
- Daily schedule (2 AM UTC)

GitHub Actions workflow includes:
- Multiple Python versions (3.11, 3.12, 3.13)
- Database compatibility tests (DuckDB vs DuckLake)
- API endpoint availability checks
- Coverage reporting

## Adding New Tests

### For New API Endpoints

1. Add test to appropriate test class in `test_api_integration.py`
2. Test both success and error cases
3. Verify response format matches frontend expectations
4. Add performance test if endpoint handles large data

Example:
```python
def test_new_endpoint(self, client, test_database):
    """Test new API endpoint."""
    response = client.get("/api/new-endpoint")
    
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict)
    assert "required_field" in data
```

### For Data Format Changes

1. Update existing tests to expect new format
2. Add backward compatibility tests if needed
3. Test both database backends (DuckDB and DuckLake)
4. Verify frontend compatibility

## Troubleshooting

### Test Database Issues
```bash
# Clear test databases
rm -f test_*.db test_*.sqlite
rm -rf test_data/

# Repopulate test data
make populate-db
```

### Dependency Issues
```bash
# Reinstall all dependencies
make clean
make setup
```

### Permission Issues
```bash
# Ensure scripts are executable
chmod +x scripts/run_integration_tests.py
```

## Performance Benchmarks

Target performance requirements:
- Gene effects endpoint: < 5 seconds
- Pet genome endpoint: < 2 seconds
- Concurrent requests: 5 simultaneous requests < 10 seconds total
- Individual API calls: < 2 seconds each

## Test Coverage Goals

- **API endpoints**: 100% coverage of critical paths
- **Error handling**: All error conditions tested
- **Data formats**: All response formats verified
- **Database backends**: Both DuckDB and DuckLake tested

Current coverage targets:
- Integration tests: 80%+ coverage of web API code
- Critical paths: 100% coverage
- Error handling: 90%+ coverage

## Best Practices

1. **Test the Contract, Not Implementation**
   - Focus on API response format
   - Don't test internal database details

2. **Test Real User Workflows**
   - Upload pet → view genome → delete pet
   - Select species → load chromosomes → view genes

3. **Test Error Conditions**
   - Invalid inputs
   - Missing data
   - Network timeouts

4. **Keep Tests Fast**
   - Use minimal test data
   - Parallelize where possible
   - Cache expensive operations

5. **Make Tests Readable**
   - Clear test names
   - Good assertions messages
   - Logical test grouping

## When Tests Fail in CI

1. **Check the logs** - GitHub Actions provides detailed output
2. **Reproduce locally** - Run the same test command locally
3. **Check for environment differences** - Database versions, dependencies
4. **Verify test data** - Ensure gene data is loading correctly
5. **Test database backends** - Try both DuckDB and DuckLake

Remember: **Integration tests failing usually means the UI will be broken**. Fix tests before merging changes.