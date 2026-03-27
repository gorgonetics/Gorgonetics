# AGENTS.md

Shared directives for AI coding assistants working in this repository.
Tool-specific files (CLAUDE.md, .github/copilot-instructions.md) extend these.

## Project Overview

Gorgonetics is a web-based genetic breeding tool for Project Gorgon pets. Python CLI/FastAPI backend + SvelteKit frontend for editing and analyzing pet genetics data.

## Architecture

### Backend (`src/gorgonetics/`)
- **`cli.py`**: Typer CLI with rich output
- **`web_app.py`**: FastAPI REST API with JWT auth
- **`models.py`**: Pydantic data models (Gene, Genome, Pet)
- **`ducklake_database.py`**: DuckLake database with SQLite catalog + Parquet storage
- **`database_config.py`**: Connection factories (`create_database_instance()`, `create_auth_database_instance()`)
- **`genome_parser.py`**: Parses Project Gorgon pet genome text files
- **`attribute_config.py`**: Species-specific attribute definitions (beewasp, horse)
- **`constants.py`**: Shared enums (UserRole, Gender) and constants
- **`auth/`**: JWT authentication module
  - `database.py`: SQLite-backed auth store (`users.sqlite`) for users and sessions
  - `dependencies.py`: FastAPI auth dependencies (`get_current_active_user`, etc.)
  - `models.py`: User, UserUpdate, Token, TokenData models
  - `utils.py`: Password hashing, token creation/verification

### Frontend (SvelteKit)
- **`src/routes/`**: File-based routing (`+page.svelte`, `+layout.svelte`)
- **`src/lib/components/`**: Svelte 5 components organized by domain
  - `forms/`: LoginForm, RegisterForm, PetUploadForm
  - `gene/`: GeneCell, GeneEditor, GeneVisualizer, GeneStatsTable, GeneTooltip
  - `pet/`: PetEditor, PetDataTable, PetVisualization
  - `layout/`: Sidebar, VisualizationHeader
- **`src/lib/services/api.js`**: ApiClient singleton (auth headers, token refresh)
- **`src/lib/stores/`**: Svelte writable stores
  - `pets.js`: Pet data, loading state, active tab
  - `auth.js`: User, isAuthenticated, token management
- **`src/lib/utils/apiUtils.js`**: Species normalization, cached API config loaders

### Database
- **Auth**: SQLite (`users.sqlite`) — users and sessions (ACID transactional)
- **Data**: DuckLake with SQLite catalog (`metadata.sqlite`) + Parquet files — genes and pets
- JWT auth with `admin` and `user` roles; registration is invite-only (admin creates accounts)

## Development Setup

### Prerequisites
- Python 3.13+, [uv](https://docs.astral.sh/uv/)
- Node.js 20+, [pnpm](https://pnpm.io/)

### Commands

```bash
# Setup
uv sync --dev                     # Python dependencies
pnpm install                      # JS dependencies
uv run gorgonetics populate       # Load gene templates into DB

# Run
uv run gorgonetics web            # Backend API (port 8000)
pnpm run dev                      # Frontend dev server (port 5173)

# Quality (MUST pass before committing)
uv run ruff check .               # Python lint
uv run ruff format --check .      # Python format check
uv run ty check src/gorgonetics   # Type checking
pnpm run lint:ci                  # ESLint (zero warnings)

# Tests
uv run pytest                     # Python tests (96 tests)
pnpm run test:client              # Frontend tests (vitest)
./test.sh quick                   # Integration tests
./test.sh all                     # Full suite

# Admin / user management
uv run gorgonetics create-admin --username X --password Y
uv run gorgonetics list-users
uv run gorgonetics set-role --username X --role admin
uv run gorgonetics delete-user --username X
uv run gorgonetics db-status
```

## Code Standards

### Python
- **Line length**: 120 characters
- **Type hints**: Required on all functions (ty type checker)
- **Docstrings**: Required on public functions, classes, modules
- **Strings**: Double quotes
- **Parameters**: Never run bare `python`, always `uv run python`
- **SQL**: Use named parameters (`$param`), never positional (`?`)
- **Imports**: Use `from gorgonetics.constants import ...` for shared enums/constants

### JavaScript / Svelte
- **Framework**: Svelte 5 with runes (`$props()`, `$state()`, `$derived()`, `$effect()`)
- **API calls**: Always use `apiClient` from `$lib/services/api.js` (handles auth + refresh)
- **State**: Use writable stores from `$lib/stores/` for shared state
- **Imports**: Use `$lib/` alias (e.g., `import { apiClient } from '$lib/services/api.js'`)
- **CSS**: Tailwind CSS v4 via `@import 'tailwindcss'` in app.css; Flowbite Svelte for components
- **No raw fetch**: All API calls must go through the ApiClient to ensure auth headers are attached

### Quality Gates (enforced by CI)
After modifying **any** file, run the relevant linters and fix all errors before committing:
```bash
# Python changes:
uv run ruff check . && uv run ruff format --check . && uv run ty check src/gorgonetics

# JS/Svelte changes:
pnpm run lint:ci
```

## Testing Strategy

- **pytest**: Unit + integration tests in `tests/`
- **Vitest**: Frontend tests in `tests/client/`
- **Integration**: `./test.sh` spins up the API server and runs endpoint tests
- Write tests for both success and error paths
- Use pytest fixtures from `tests/conftest.py` (test_database, authenticated_client, etc.)

## Key Patterns

### Adding a Feature
1. Define models in `models.py`
2. Add DB operations to `ducklake_database.py`
3. Create API endpoints in `web_app.py` with auth dependencies
4. Build Svelte components in `src/lib/components/`
5. Add tests for backend and frontend

### Database Access
- Use `Depends(get_database)` in FastAPI endpoints (auto-closes connection)
- Auth dependencies manage their own connections via `create_database_instance()`
- Validate user-supplied column names against allowlists before using in SQL

### Security
- All pet mutation endpoints use `_authorize_pet_mutation()` for ownership checks
- Attribute update keys are validated against `AttributeConfig` allowlist
- Never interpolate user input into SQL column names or identifiers
- Never fabricate personal information (names, emails, etc.) about the user

## File Organization

```
src/gorgonetics/        # Python backend
src/lib/                # Svelte components, stores, services
src/routes/             # SvelteKit pages
src/static/             # Favicon, logos
assets/                 # Gene template JSON files (beewasp, horse)
data/                   # Sample genome text files
tests/                  # Python + JS tests
scripts/                # Build/test/DB utility scripts
docs/                   # Project documentation
```

## Species & Data

- **Beewasp**: Chromosomes chr01-chr02, attributes: Ferocity, Toughness, etc.
- **Horse**: Chromosomes chr01-chr48, attributes: Temperament, Toughness, etc.
- Extensible via `attribute_config.py` for new species
- Gene data: species -> chromosome -> gene positions with dominant/recessive effects
