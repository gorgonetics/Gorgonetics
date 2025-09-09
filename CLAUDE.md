# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gorgonetics is a web-based genetic breeding tool for Project Gorgon pets. It provides a Python CLI/FastAPI backend with a modern Svelte frontend for editing and analyzing pet genetics data.

## Development Environment Setup

### Package Management
- **Python**: Use `uv` for all Python operations (never use `python` directly, always use `uv run python`)
- **Node.js**: Use `pnpm` for frontend dependencies and scripts
- **Required**: Python 3.13+, uv package manager

### Essential Setup Commands
```bash
# Initial setup
uv sync --dev        # Install Python dependencies
pnpm install         # Install Node.js dependencies

# Database initialization
uv run gorgonetics populate    # Populate with sample data
```

## Common Development Commands

### Python Backend
```bash
# Start backend API server (port 8000)
uv run gorgonetics web

# Run all Python tests
uv run pytest

# Code quality checks
uv run ruff check           # Linting
uv run ruff format          # Code formatting
uv run mypy src/gorgonetics # Type checking
```

### Svelte Frontend
```bash
# Start frontend dev server (port 5173)
pnpm run dev

# Build for production
pnpm run build

# Frontend linting
pnpm run lint
pnpm run lint:fix

# Frontend testing
pnpm run test:client        # Run client tests
pnpm run test:client:ui     # Run with interactive UI
```

### Integrated Testing
```bash
# Quick Python integration tests
./test.sh quick

# Full test suite (integration + client)
./test.sh all

# API integration test categories
./test.sh api

# Specific test categories
./test.sh genes       # Gene endpoint tests
./test.sh pets        # Pet endpoint tests
./test.sh consistency # Data consistency tests
```

## Architecture Overview

### Backend Structure (`src/gorgonetics/`)
- **`cli.py`**: Typer-based command-line interface with rich output
- **`web_app.py`**: FastAPI application with REST endpoints and authentication
- **`models.py`**: Pydantic data models for genes, pets, and genetics
- **`ducklake_database.py`**: DuckLake-based analytics database with versioning
- **`genome_parser.py`**: Parses Project Gorgon pet genome files
- **`attribute_config.py`**: Dynamic attribute system for different species
- **`database_config.py`**: Database configuration and connection management
- **`auth/`**: Authentication and authorization module
  - **`models.py`**: User and authentication data models
  - **`utils.py`**: JWT token handling and password utilities
  - **`dependencies.py`**: FastAPI authentication dependencies

### Frontend Structure (`src/svelte/`)
- **`App.svelte`**: Main application component with reactive state
- **`lib/components/`**: Reusable Svelte components for gene editing UI
  - **`AuthWrapper.svelte`**: Authentication state management wrapper
  - **`LoginForm.svelte`** / **`RegisterForm.svelte`**: User authentication forms
  - **`GeneEditor.svelte`**, **`PetEditor.svelte`**: Main editing interfaces
- **`lib/services/apiClient.js`**: API communication layer with authentication
- **`lib/stores/`**: Reactive state management
  - **`appState.js`**: Application and pet data state
  - **`authStore.js`**: Authentication state management

### Database Architecture
- **Primary**: DuckLake with SQLite catalog for analytics and versioning
- **Storage**: Stores pet genetics data with chromosome-level organization
- **Authentication**: JWT-based user authentication with role-based access control
- **Multi-user**: Separate data isolation per user with admin oversight capabilities
- **Features**: Data versioning, fast analytical queries, user management

## Code Quality Standards

### Python (Follows Copilot Instructions)
- **Line length**: 120 characters
- **Type hints**: Required for all functions and methods (mypy strict mode)
- **Docstrings**: Required for all public functions, classes, and modules
- **String quotes**: Prefer double quotes
- **Target**: Python 3.13+ features and type hints

### JavaScript/Svelte
- **ESLint**: Configured to allow both single and double quotes
- **Components**: Follow existing Svelte 5 patterns
- **API calls**: Use centralized `apiClient.js` service
- **State**: Use stores for shared state management

## Testing Strategy

### Python Tests
- **Framework**: pytest with fixtures
- **Coverage**: pytest-cov for coverage reporting
- **Integration**: Full API endpoint testing via `./test.sh`
- **Markers**: `slow` and `integration` test markers available

### Frontend Tests
- **Framework**: Vitest with jsdom
- **Commands**: Use `pnpm run test:client:*` variants
- **Integration**: `pnpm run test:integration` runs `./test.sh quick`
- **Complete Suite**: `pnpm run test:all` runs `./test.sh all`
- **UI Testing**: Interactive test UI available with `test:client:ui`

## Species and Data Structure

### Supported Species
- **Beewasp**: With chromosome data (chr01, chr02, etc.)
- **Horse**: Multi-chromosome genetic data
- **Extensible**: Framework supports adding new species via `attribute_config.py`

### Gene Data Format
- Genes organized by species → chromosome → individual gene positions
- Dynamic attributes system allows species-specific genetic traits
- Export/import functionality for sharing genetic configurations

## Authentication System

### User Management
- **JWT Authentication**: Access and refresh token-based authentication
- **User Roles**: `admin` and `user` roles with different permissions
- **Admin Features**: Can manage all pets, create admin users via CLI
- **User Features**: Can only access their own pets and data

### CLI User Management
```bash
# Create admin user
uv run gorgonetics create-admin --username admin --password yourpassword

# Check database status
uv run gorgonetics db-status
```

### API Authentication
- All pet management endpoints require authentication
- Admin-only endpoints for bulk operations and system management
- Token-based session management with automatic refresh

## Key Development Patterns

### Adding New Features
1. Define data models in `models.py` with proper type hints
2. Add database operations to `ducklake_database.py`
3. Create API endpoints in `web_app.py` with appropriate authentication
4. Build Svelte components for UI interaction
5. Add comprehensive tests for both backend and frontend

### Database Operations
- Always use the DuckLake database instance via `create_database_instance()`
- Follow existing patterns for gene data queries and mutations
- Leverage analytics capabilities for complex genetic analysis

### API Development
- Use FastAPI dependency injection patterns
- Return appropriate HTTP status codes
- Include comprehensive error handling
- Follow existing endpoint naming conventions

## Integration Notes

### Development Servers
- Backend runs on port 8000 (API only)
- Frontend dev server on port 5173 (proxies API calls to backend)
- Access the web application at http://localhost:5173 during development

### File Organization
- Python code: `src/gorgonetics/`
- Frontend code: `src/svelte/`
- Static assets: `assets/` (gene template data)
- Sample data: `data/` directory
- Documentation: `docs/` with comprehensive guides