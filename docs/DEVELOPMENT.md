# Development Guide

## Prerequisites

- **Python 3.13+**
- **uv** -- Python package manager ([install](https://docs.astral.sh/uv/getting-started/installation/))
- **Node.js 20+** with **pnpm** -- frontend tooling
- **Git**

## Project Setup

```bash
# Clone and enter the repository
git clone https://github.com/jlopezpena/Gorgonetics.git
cd Gorgonetics

# Install Python dependencies
uv sync --dev

# Install Node.js dependencies
pnpm install

# Populate the database with sample gene data
uv run gorgonetics populate

# Start the backend API server (port 8000)
uv run gorgonetics web

# In a second terminal, start the frontend dev server (port 5173)
pnpm run dev
```

Verify everything works by visiting:

- **Application**: http://localhost:5173
- **API docs (Swagger)**: http://localhost:8000/docs
- **API docs (ReDoc)**: http://localhost:8000/redoc

The Vite dev server proxies `/api` and `/static` requests to the backend automatically (configured in `vite.config.js`).

## Project Structure

### Backend -- Python (`src/gorgonetics/`)

| File | Purpose |
|------|---------|
| `cli.py` | Typer CLI: `web`, `populate`, `db-status`, `db-snapshots`, `db-cleanup`, `create-admin` |
| `web_app.py` | FastAPI application with REST endpoints, auth middleware, rate limiting |
| `models.py` | Pydantic models for genes, pets, genomes |
| `ducklake_database.py` | `DuckLakeGeneDatabase` -- all database operations |
| `database_config.py` | `DatabaseConfig` dataclass, `create_database_instance()` factory |
| `genome_parser.py` | Parses Project Gorgon pet genome text files |
| `attribute_config.py` | Dynamic attribute system (core + species-specific attributes) |
| `constants.py` | Enums and constants (`Gender`, `UserRole`, `DEMO_USER_ID`) |
| `auth/models.py` | Pydantic models: `User`, `UserCreate`, `UserLogin`, `Token` |
| `auth/utils.py` | JWT creation/verification, password hashing (bcrypt) |
| `auth/dependencies.py` | FastAPI dependencies: `get_current_active_user`, `require_admin` |

### Frontend -- SvelteKit + Svelte 5 (`src/`)

| Path | Purpose |
|------|---------|
| `src/routes/+page.svelte` | Main application page |
| `src/routes/+layout.svelte` | Root layout |
| `src/routes/auth/login/` | Login page |
| `src/routes/auth/register/` | Registration page |
| `src/lib/components/` | Reusable components |
| `src/lib/components/AuthWrapper.svelte` | Authentication state wrapper |
| `src/lib/components/GeneEditingView.svelte` | Gene editing interface |
| `src/lib/components/gene/` | Gene visualization: `GeneEditor`, `GeneCell`, `GeneTooltip`, `GeneVisualizer`, `GeneStatsTable` |
| `src/lib/components/pet/` | Pet management: `PetEditor`, `PetVisualization`, `PetDataTable` |
| `src/lib/components/forms/` | `LoginForm`, `RegisterForm`, `PetUploadForm` |
| `src/lib/components/layout/` | `Sidebar`, `VisualizationHeader` |
| `src/lib/services/api.js` | API client -- all backend HTTP calls |
| `src/lib/stores/auth.js` | Authentication state (tokens, current user) |
| `src/lib/stores/pets.js` | Pet data state |

### Key configuration files

| File | Purpose |
|------|---------|
| `svelte.config.js` | SvelteKit config with static adapter, path aliases |
| `vite.config.js` | Vite config with Tailwind CSS plugin, dev server proxy |
| `package.json` | Frontend dependencies and scripts |
| `pyproject.toml` | Python project config, dependencies, ruff/mypy settings |
| `eslint.config.js` | ESLint config for JS/Svelte |

### UI framework

The frontend uses **Tailwind CSS v4** with **Flowbite Svelte** components and **Lucide** icons. Use Flowbite components when a suitable one exists; fall back to plain Tailwind for custom layouts.

## Common Commands

### Backend

```bash
uv run gorgonetics web                    # Start API server (port 8000)
uv run gorgonetics populate               # Populate gene database from assets/
uv run gorgonetics db-status              # Show database config and status
uv run gorgonetics db-snapshots           # List DuckLake version snapshots
uv run gorgonetics db-cleanup             # Clean up old Parquet files (dry run)
uv run gorgonetics create-admin           # Create an admin user
```

### Frontend

```bash
pnpm run dev                              # Start dev server (port 5173)
pnpm run build                            # Production build to build/
pnpm run preview                          # Preview production build
```

### Code quality

```bash
# Python
uv run ruff check .                       # Lint
uv run ruff format --check .              # Check formatting
uv run ruff format .                      # Auto-format
uv run mypy src/gorgonetics               # Type checking

# JavaScript / Svelte
pnpm run lint                             # ESLint
pnpm run lint:fix                         # ESLint with auto-fix
pnpm run lint:ci                          # ESLint strict (zero warnings)
```

### Testing

```bash
# Python unit tests
uv run pytest                             # All tests
uv run pytest -x                          # Stop on first failure
uv run pytest -v                          # Verbose output
uv run pytest --cov=gorgonetics           # With coverage
uv run pytest tests/test_models.py        # Specific file
uv run pytest -m "not slow"               # Skip slow tests

# Frontend client tests
pnpm run test:client                      # Run client tests
pnpm run test:client:ui                   # Interactive test UI
pnpm run test:client:watch                # Watch mode
pnpm run test:client:coverage             # With coverage

# Integration tests (shell script)
./test.sh quick                           # Python integration tests only
./test.sh all                             # Full suite (integration + client)
./test.sh api                             # API endpoint tests
./test.sh genes                           # Gene endpoint tests
./test.sh pets                            # Pet endpoint tests
./test.sh consistency                     # Data consistency tests
./test.sh client                          # JS client tests with auto server management

# pnpm aliases
pnpm run test:integration                 # Same as ./test.sh quick
pnpm run test:all                         # Same as ./test.sh all
```

## Coding Standards

### Python

- **Line length**: 120 characters
- **Formatter/linter**: ruff (configured in `pyproject.toml`)
- **Type checker**: mypy in strict mode
- **Type hints**: Required on all function signatures
- **Docstrings**: Required on all public functions, classes, and modules
- **String quotes**: Double quotes preferred
- **Target**: Python 3.13+ (use modern union syntax `X | None`, not `Optional[X]`)

```python
def update_gene_data(
    animal_type: str,
    gene_id: str,
    updates: dict[str, Any],
) -> bool:
    """
    Update gene data in the database.

    Args:
        animal_type: Species identifier (e.g., 'beewasp', 'horse').
        gene_id: Unique gene identifier (e.g., '01A1').
        updates: Dictionary of field names to new values.

    Returns:
        True if the update succeeded, False otherwise.

    Raises:
        ValueError: If gene_id is not found.
    """
    ...
```

Use `pathlib.Path` over `os.path`. Prefer `from __future__ import annotations` when forward references are needed.

### Svelte / JavaScript

- **Framework**: SvelteKit with Svelte 5 (runes syntax: `$state`, `$derived`, `$effect`)
- **Linter**: ESLint with `eslint-plugin-svelte`
- **Quotes**: Both single and double quotes are allowed (ESLint is configured to accept either)
- **API calls**: Always go through `src/lib/services/api.js`
- **State management**: Use Svelte stores in `src/lib/stores/` for shared state
- **Components**: Follow existing patterns -- props via `export let`, events via `dispatch`
- **Styling**: Tailwind CSS utility classes; Flowbite Svelte components for common UI patterns

```svelte
<script>
  import { Button } from 'flowbite-svelte';
  import { pets } from '$stores/pets.js';

  let { species = 'beewasp' } = $props();
  let filteredPets = $derived(
    $pets.filter(p => p.species === species)
  );
</script>

<div class="p-4">
  {#each filteredPets as pet}
    <p class="text-sm text-gray-700">{pet.name}</p>
  {/each}
  <Button on:click={() => console.log('clicked')}>Load more</Button>
</div>
```

### Mandatory: lint before committing

After modifying any Python or JS/Svelte file, run the relevant linters and fix all errors before committing. These are the same checks CI runs:

```bash
# Python
uv run ruff check .
uv run ruff format --check .

# JS / Svelte
pnpm run lint:ci
```

## Testing Details

### Python test files

```
tests/
  conftest.py                          # Shared fixtures (test_database, authenticated_client, etc.)
  test_models.py                       # Pydantic model tests
  test_cli.py                          # CLI command tests
  test_main.py                         # Entry point tests
  test_attribute_config.py             # Attribute system tests
  integration/
    test_api_integration.py            # Full API endpoint tests
    test_auth.py                       # Authentication flow tests
    test_authorization.py              # Role-based access control tests
  client/
    test-client-api.js                 # JS client API tests
    test-minimal.js                    # Minimal smoke tests
    test-simple-client.js              # Simple client integration tests
```

### Key test fixtures (from `conftest.py`)

- `test_database` -- creates an isolated DuckLake database in a temp directory per test, with environment variables pointed at the temp paths. Cleans up after the test.
- `authenticated_client` -- a `FastAPI.TestClient` with a pre-created user and valid JWT token baked into every request.
- `sample_pet_file` -- a temporary JSON genome file for upload tests.
- `runner` / `cli_app` -- Typer `CliRunner` and app instance for CLI tests.

### Writing a new Python test

```python
# tests/test_example.py
from gorgonetics.ducklake_database import DuckLakeGeneDatabase


class TestGeneOperations:
    def test_upsert_and_retrieve(self, test_database: DuckLakeGeneDatabase) -> None:
        """Inserting a gene and retrieving it returns the same data."""
        test_database._upsert_gene("beewasp", "chr01", "01A1", {
            "effectDominant": "Intelligence+",
            "effectRecessive": "None",
            "appearance": "Test",
            "notes": "Test note",
        })
        test_database.conn.commit()

        result = test_database.get_gene("beewasp", "01A1")
        assert result is not None
        assert result["effectDominant"] == "Intelligence+"
```

### Writing a new API test

```python
# tests/integration/test_example_api.py
from fastapi.testclient import TestClient


class TestGeneEndpoints:
    def test_get_animal_types(self, authenticated_client: TestClient) -> None:
        """GET /api/genes/animal-types returns a list."""
        response = authenticated_client.get("/api/genes/animal-types")
        assert response.status_code == 200
        assert isinstance(response.json(), list)
```

### Frontend tests

Frontend tests use **Vitest** with **jsdom**. Run them with `pnpm run test:client`. The test runner script (`scripts/run_client_tests.js`) manages server startup/shutdown automatically for integration tests.

## Debugging

### Backend

```bash
# Start with auto-reload (default)
uv run gorgonetics web

# Check database state
uv run gorgonetics db-status

# Run a single test with verbose output
uv run pytest tests/test_models.py -v -s
```

The backend uses Python's `logging` module. Set `LOG_LEVEL=DEBUG` for verbose output.

### Frontend

- **Browser DevTools**: Network tab to inspect API requests, Console for errors.
- **Vite HMR**: Changes to `.svelte` and `.js` files hot-reload automatically.
- **API proxy**: The Vite dev server proxies `/api` to `localhost:8000`, so check that the backend is running if API calls fail.

### Common issues

| Problem | Solution |
|---------|----------|
| `ModuleNotFoundError` | Run `uv sync --dev` to reinstall Python dependencies |
| Frontend shows blank page | Ensure the backend is running on port 8000 |
| `INSTALL ducklake` fails | DuckDB downloads extensions on first use -- check network access |
| Lint errors block commit | Run `uv run ruff check . --fix` and `pnpm run lint:fix` |
| Test database errors | The `test_database` fixture manages isolation; do not share state between tests |
| Port already in use | Kill the existing process: `lsof -ti:8000 | xargs kill` |

## Contributing

1. Create a feature branch from `main`.
2. Make changes following the coding standards above.
3. Run all quality checks:
   ```bash
   uv run ruff check .
   uv run ruff format --check .
   uv run mypy src/gorgonetics
   pnpm run lint:ci
   uv run pytest
   ```
4. Submit a pull request with a clear description and test coverage for new functionality.

## Resources

- [FastAPI docs](https://fastapi.tiangolo.com/)
- [SvelteKit docs](https://svelte.dev/docs/kit)
- [Svelte 5 runes](https://svelte.dev/docs/svelte/what-are-runes)
- [DuckDB docs](https://duckdb.org/docs/)
- [DuckLake](https://ducklake.select/)
- [Tailwind CSS v4](https://tailwindcss.com/docs)
- [Flowbite Svelte](https://flowbite-svelte.com/)
- [ruff](https://docs.astral.sh/ruff/)
- [Vitest](https://vitest.dev/)
- [uv](https://docs.astral.sh/uv/)
