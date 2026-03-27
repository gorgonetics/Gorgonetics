# Testing Documentation

## Test Commands

### Quick Commands
```bash
# Run all tests
./test.sh all

# Python integration tests only  
./test.sh quick

# JavaScript client tests
./test.sh client

# Interactive client test UI
./test.sh client-ui
```

### Specific Test Categories
```bash
./test.sh api         # API endpoints
./test.sh genes       # Gene endpoints  
./test.sh pets        # Pet endpoints
./test.sh consistency # Data consistency
```

### Package Manager Commands
```bash
# Client tests via pnpm
pnpm run test:client
pnpm run test:client:ui

# Full test suite
pnpm run test:all
```

## Test Structure

### Python Integration Tests
- **Location**: `tests/integration/test_api_integration.py`
- **Purpose**: Verify API endpoints work correctly
- **Database**: Uses isolated test databases via `conftest.py`
- **Run via**: `uv run pytest tests/integration/`

### JavaScript Client Tests  
- **Location**: `tests/client/test-simple-client.js`
- **Purpose**: Verify frontend can consume API responses
- **Server**: Auto-starts test server if needed
- **Run via**: `pnpm vitest tests/client/`

## Database Isolation

Tests use temporary databases to prevent production data contamination:
- DuckLake test database created via `test_database` fixture in `conftest.py`
- SQLite auth database created via `test_auth_db` fixture in `conftest.py`
- Environment variables (`GORGONETICS_CATALOG_PATH`, `GORGONETICS_DATA_PATH`, `GORGONETICS_AUTH_DB_PATH`) override production paths
- Automatic cleanup after each test

## Scripts

- `./test.sh` - Main test runner script
- `scripts/run_integration_tests.py` - Python test runner
- `scripts/run_client_tests.js` - JavaScript test runner

See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed testing workflows.