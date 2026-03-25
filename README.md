# Gorgonetics

[![CI](https://github.com/jlopezpena/Gorgonetics/workflows/CI/badge.svg)](https://github.com/jlopezpena/Gorgonetics/actions/workflows/ci.yml)
[![Integration Tests](https://github.com/jlopezpena/Gorgonetics/workflows/Integration%20Tests/badge.svg)](https://github.com/jlopezpena/Gorgonetics/actions/workflows/integration.yml)
[![Python 3.13+](https://img.shields.io/badge/python-3.13+-blue.svg)](https://www.python.org/downloads/)
[![Code style: ruff](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/astral-sh/ruff/main/assets/badge/v2.json)](https://github.com/astral-sh/ruff)
[![uv](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/astral-sh/uv/main/assets/badge/v0.json)](https://github.com/astral-sh/uv)

A web-based genetic breeding tool for Project Gorgon pets. Provides an intuitive interface for viewing and editing genetic data for different animal types with real-time change tracking and export capabilities.

## Features

- **Gene Editing**: Interactive web interface for editing dominant/recessive effects, appearance, and notes
- **Multi-Species Support**: Handles different animal types (Beewasp, Horse) with chromosome-specific data
- **Export/Import**: JSON export functionality for backing up and sharing gene configurations
- **Real-time Updates**: Instant change detection and save state management
- **Authentication**: JWT-based user authentication with role-based access control (admin/user)
- **Multi-user**: Per-user data isolation with admin oversight capabilities
- **Data Versioning**: DuckLake with SQLite catalog for fast analytical queries and versioned data
- **Type Safety**: Full type annotations with ty type checker

## Quick Start

### Prerequisites

- Python 3.13+
- [uv](https://docs.astral.sh/uv/) package manager
- Node.js with [pnpm](https://pnpm.io/)

### Installation

```bash
git clone https://github.com/jlopezpena/Gorgonetics.git
cd Gorgonetics
uv sync --dev       # Install Python dependencies
pnpm install        # Install frontend dependencies
```

### Populate the Database

```bash
uv run gorgonetics populate
```

### Start the Application

Run both servers in separate terminals:

```bash
# Terminal 1: Backend API (port 8000)
uv run gorgonetics web

# Terminal 2: Frontend dev server (port 5173)
pnpm run dev
```

Visit `http://localhost:5173` to start editing genes. The frontend automatically proxies API calls to the backend.

### User Management

```bash
# Create an admin user
uv run gorgonetics create-admin --username admin --password yourpassword

# Check database status
uv run gorgonetics db-status
```

## Basic Workflow

1. **Register / Log in**: Create an account or sign in via the auth pages
2. **Select Animal Type**: Choose from available species (Beewasp, Horse)
3. **Select Chromosome**: Pick a chromosome to edit (chr01, chr02, etc.)
4. **Edit Properties**: Modify effects, appearance, and notes
5. **Save Changes**: Persist edits via the save controls
6. **Export Data**: Download modified genes as JSON files

## Documentation

Comprehensive documentation is available in the `docs/` directory:

- [API Reference](docs/API.md) -- REST API endpoints and usage examples
- [Database Guide](docs/DATABASE.md) -- Schema, operations, and optimization
- [Frontend Architecture](docs/FRONTEND.md) -- SvelteKit components and application structure
- [Development Guide](docs/DEVELOPMENT.md) -- Setup, testing, and contribution guidelines
- [Testing Guide](docs/TESTING.md) -- Test strategy and running tests
- [Release Procedure](docs/RELEASE.md) -- Versioning and release process
- [Configuration-Driven Attributes](docs/CONFIGURATION_DRIVEN_ATTRIBUTES.md) -- Dynamic attribute system
- [DuckLake Multi-User](docs/DUCKLAKE_MULTIUSER.md) -- Multi-user data architecture

## Development

### Commands

```bash
# Quality checks
uv run ruff check           # Linting
uv run ruff format --check  # Formatting check
uv run ty check src/gorgonetics # Type checking

# Python tests (96 tests)
uv run pytest

# Frontend linting
pnpm run lint:ci

# Frontend tests
pnpm run test:client

# Integration tests
./test.sh quick             # Quick integration suite
./test.sh all               # Full suite (integration + client)
```

### CLI Reference

```bash
uv run gorgonetics --help       # Show all commands
uv run gorgonetics populate     # Populate DB with sample data
uv run gorgonetics web          # Start backend API server
uv run gorgonetics db-status    # Show database status
uv run gorgonetics create-admin # Create an admin user
```

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | [FastAPI](https://fastapi.tiangolo.com/) -- high-performance async web API |
| **Database** | [DuckLake](https://ducklake.select/) with SQLite catalog -- versioned analytics storage |
| **Frontend** | [SvelteKit](https://svelte.dev/) + [Svelte 5](https://svelte.dev/) -- file-based routing, client-rendered SPA framework |
| **UI Components** | [Flowbite Svelte](https://flowbite-svelte.com/) + [Tailwind CSS](https://tailwindcss.com/) |
| **Build Tool** | [Vite](https://vitejs.dev/) -- fast dev server and bundler |
| **Python Packaging** | [uv](https://docs.astral.sh/uv/) -- fast package installer and resolver |
| **Frontend Packaging** | [pnpm](https://pnpm.io/) -- fast, disk-efficient package manager |
| **Type Safety** | [ty](https://github.com/astral-sh/ty) -- fast type checker by Astral |
| **Linting** | [ruff](https://docs.astral.sh/ruff/) (Python) + [ESLint](https://eslint.org/) (JS/Svelte) |
| **Testing** | [pytest](https://docs.pytest.org/) (backend) + [Vitest](https://vitest.dev/) (frontend) |
| **CLI** | [Typer](https://typer.tiangolo.com/) + [Rich](https://rich.readthedocs.io/) |

## Contributing

Contributions are welcome. Please see the [Development Guide](docs/DEVELOPMENT.md) for detailed instructions.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes following the coding standards
4. Run tests and quality checks: `uv run pytest && uv run ruff check && pnpm run lint:ci`
5. Submit a pull request with a clear description

## License

This project is licensed under the MIT License.
