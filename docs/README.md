# Gorgonetics Documentation

## Overview

Gorgonetics is a web-based genetic breeding tool for Project Gorgon pets. It provides a Python/FastAPI backend with a SvelteKit frontend for managing pet genetics data, including gene editing, pet genome upload, and genome visualization.

## Table of Contents

### Core Documentation
- [Project Structure](#project-structure)
- [Architecture](#architecture)
- [Installation](#installation)
- [Usage](#usage)
- [API Quick Reference](#api-quick-reference)
- [Database Schema](#database-schema)

### Technical References
- [API Reference](API.md) -- Complete REST API documentation with authentication
- [Database Schema](DATABASE.md) -- DuckLake database architecture and operations
- [Frontend Architecture](FRONTEND.md) -- SvelteKit component documentation
- [Development Guide](DEVELOPMENT.md) -- Setup, workflow, and contribution guidelines
- [Testing Strategy](TESTING.md) -- Comprehensive testing documentation
- [Release Procedure](RELEASE.md) -- Release workflow and deployment

### Advanced Topics
- [Configuration-Driven Attributes](CONFIGURATION_DRIVEN_ATTRIBUTES.md) -- Dynamic attribute system architecture
- [DuckLake Multi-User Setup](DUCKLAKE_MULTIUSER.md) -- Multi-user database configuration

## Project Structure

```
Gorgonetics/
├── src/
│   ├── gorgonetics/                # Python backend package
│   │   ├── __init__.py
│   │   ├── __main__.py             # Entry point
│   │   ├── cli.py                  # Typer CLI (populate, web, create-admin, db-status)
│   │   ├── web_app.py              # FastAPI application with REST endpoints
│   │   ├── models.py               # Pydantic data models
│   │   ├── ducklake_database.py    # DuckLake database with versioning
│   │   ├── database_config.py      # Database configuration and connections
│   │   ├── genome_parser.py        # Project Gorgon genome file parser
│   │   ├── attribute_config.py     # Dynamic species attribute system
│   │   ├── constants.py            # Shared constants
│   │   └── auth/                   # Authentication module
│   │       ├── __init__.py
│   │       ├── dependencies.py     # FastAPI auth dependencies
│   │       ├── models.py           # User and token models
│   │       └── utils.py            # JWT and password utilities
│   ├── lib/                        # SvelteKit frontend library
│   │   ├── components/
│   │   │   ├── AuthWrapper.svelte
│   │   │   ├── GeneEditingView.svelte
│   │   │   ├── forms/              # LoginForm, RegisterForm, PetUploadForm
│   │   │   ├── gene/               # GeneEditor, GeneCell, GeneVisualizer, etc.
│   │   │   ├── layout/             # Sidebar, VisualizationHeader
│   │   │   └── pet/                # PetEditor, PetDataTable, PetVisualization
│   │   ├── services/
│   │   │   └── api.js              # API communication layer
│   │   ├── stores/
│   │   │   ├── auth.js             # Authentication state
│   │   │   └── pets.js             # Pet data state
│   │   └── utils/
│   │       └── apiUtils.js         # API helper utilities
│   ├── routes/                     # SvelteKit file-based routing
│   │   ├── +page.svelte            # Home page
│   │   ├── +layout.svelte          # Root layout
│   │   ├── auth/login/             # Login page
│   │   ├── auth/register/          # Registration page
│   │   ├── genes/                  # Gene management page
│   │   └── pets/                   # Pet management page
│   ├── static/                     # Static assets (favicon, logos, styles)
│   ├── app.html                    # HTML shell
│   └── app.css                     # Global styles
├── assets/                         # Gene template data (JSON)
│   ├── beewasp/                    # Beewasp chromosome files
│   └── horse/                      # Horse chromosome files
├── data/                           # Sample genome files
├── tests/                          # Test suite (pytest + Vitest)
├── docs/                           # Documentation
├── nbs/                            # Jupyter notebooks
├── .github/                        # GitHub Actions workflows
├── svelte.config.js                # SvelteKit configuration
├── vite.config.js                  # Vite build configuration
├── tailwind.config.js              # Tailwind CSS configuration
├── vitest.config.js                # Vitest test configuration
├── eslint.config.js                # ESLint configuration
├── pyproject.toml                  # Python project and tool configuration
├── Dockerfile                      # Container build
├── docker-compose.yml              # Development compose
├── docker-compose.prod.yml         # Production compose
├── test.sh                         # Integration test runner
└── README.md                       # Project overview
```

## Architecture

### Backend Stack
- **Python 3.13+** with modern type hints
- **FastAPI** with automatic OpenAPI documentation
- **DuckLake** (DuckDB + SQLite catalog) for analytics and data versioning
- **Uvicorn** ASGI server
- **Pydantic** for data validation
- **JWT authentication** with role-based access control

### Frontend Stack
- **SvelteKit** with Svelte 5 runes
- **Vite** build tool and dev server
- **Tailwind CSS** utility-first styling
- **Flowbite Svelte** UI component library

### Development Tools
- **uv** -- Python package manager
- **pnpm** -- Node.js package manager
- **ruff** -- Python linter and formatter
- **ty** -- Static type checking
- **ESLint** -- JavaScript/Svelte linting
- **pytest** -- Python tests
- **Vitest** -- Frontend tests

## Installation

### Prerequisites
- Python 3.13 or higher
- uv package manager
- Node.js (with pnpm)

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/jlopezpena/Gorgonetics.git
   cd Gorgonetics
   ```

2. Install dependencies:
   ```bash
   uv sync --dev
   pnpm install
   ```

3. Populate the database with gene template data:
   ```bash
   uv run gorgonetics populate
   ```

4. Create an admin user (optional):
   ```bash
   uv run gorgonetics create-admin --username admin --password yourpassword
   ```

5. Start the backend API server (port 8000):
   ```bash
   uv run gorgonetics web
   ```

6. In a separate terminal, start the frontend dev server (port 5173):
   ```bash
   pnpm run dev
   ```

7. Open your browser to `http://localhost:5173`.

## Usage

### Basic Workflow

1. **Register or log in** through the authentication UI.
2. **Upload a pet genome** file (.txt) exported from Project Gorgon.
3. **Browse pets** in the data table view, filter by species.
4. **Visualize genomes** with the interactive gene grid.
5. **Edit genes** by selecting a species and chromosome, then modifying effects and notes.
6. **Export data** as JSON for sharing or backup.

### CLI Commands

```bash
uv run gorgonetics populate             # Load gene templates from assets/
uv run gorgonetics web                  # Start the FastAPI backend
uv run gorgonetics create-admin         # Create an admin user
uv run gorgonetics db-status            # Check database status
```

### Supported Species
- **Beewasp** -- Multi-chromosome genetic data
- **Horse** -- Multi-chromosome genetic data
- Extensible via `attribute_config.py`

## API Quick Reference

Full documentation: [API.md](API.md)

Interactive docs available at `http://localhost:8000/docs` (Swagger UI) when the backend is running.

### Public Endpoints (no auth required)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/animal-types` | List available species |
| GET | `/api/chromosomes/{animal_type}` | List chromosomes for a species |
| GET | `/api/genes/{animal_type}/{chromosome}` | Get genes for a chromosome |
| GET | `/api/effect-options` | List available gene effects |

### Authenticated Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register a new user |
| POST | `/api/auth/login` | Log in and receive JWT tokens |
| GET | `/api/auth/me` | Get current user info |
| PUT | `/api/gene` | Update a single gene |
| PUT | `/api/genes` | Bulk update genes (admin only) |
| GET | `/api/pets` | List pets for current user |
| POST | `/api/pets/upload` | Upload a pet genome file |
| GET | `/api/pets/{pet_id}` | Get a specific pet |
| PUT | `/api/pets/{pet_id}` | Update a pet |
| DELETE | `/api/pets/{pet_id}` | Delete a pet |
| GET | `/api/pet-genome/{pet_id}` | Get pet genome for visualization |
| GET | `/api/export/{animal_type}` | Export all chromosomes as JSON |
| GET | `/api/download/{animal_type}/{chromosome}` | Download a chromosome file |

## Database Schema

Gorgonetics uses DuckLake (DuckDB with a SQLite catalog) for data storage and versioning. Full documentation: [DATABASE.md](DATABASE.md)

### users
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| username | VARCHAR(50) | Unique username |
| password_hash | VARCHAR(255) | Bcrypt password hash |
| role | VARCHAR(20) | `admin` or `user` |
| is_active | BOOLEAN | Account active flag |
| created_at | TIMESTAMP | Creation time |
| updated_at | TIMESTAMP | Last update time |

### genes
| Column | Type | Description |
|--------|------|-------------|
| animal_type | VARCHAR | Species identifier (e.g., `beewasp`, `horse`) |
| chromosome | VARCHAR | Chromosome identifier (e.g., `chr01`) |
| gene | VARCHAR | Gene identifier (e.g., `01A1`) |
| effectDominant | VARCHAR | Dominant allele effect |
| effectRecessive | VARCHAR | Recessive allele effect |
| appearance | VARCHAR | Visual appearance description |
| notes | VARCHAR | Additional notes |
| created_at | TIMESTAMP | Creation time |
| updated_at | TIMESTAMP | Last update time |
| last_modified_by | INTEGER | User ID of last editor |

Primary key: `(animal_type, gene)`

### pets
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| user_id | INTEGER | Owner user ID |
| name | VARCHAR | Pet name |
| species | VARCHAR | Species (e.g., `beewasp`, `horse`) |
| gender | VARCHAR | Pet gender |
| breed | VARCHAR | Breed (species-dependent) |
| breeder | VARCHAR | Breeder/owner name |
| content_hash | VARCHAR | Deduplication hash of genome file |
| genome_data | JSON | Complete genome structure |
| notes | TEXT | Additional notes |
| is_public | BOOLEAN | Public visibility flag |
| created_at | TIMESTAMP | Upload time |
| updated_at | TIMESTAMP | Last update time |
| *(dynamic)* | *(varies)* | Species-specific attribute columns |

The pets table includes dynamic columns generated from `attribute_config.py` for species-specific traits.

## Development

### Code Quality

```bash
# Python
uv run ruff check .              # Lint
uv run ruff format --check .     # Format check
uv run ty check src/gorgonetics  # Type check

# Frontend
pnpm run lint                    # ESLint
pnpm run lint:ci                 # Strict lint (CI mode)
```

### Testing

```bash
# Python tests
uv run pytest

# Frontend tests
pnpm run test:client

# Integration tests
./test.sh quick                  # Python integration tests
./test.sh all                    # Full suite (integration + client)
./test.sh genes                  # Gene endpoint tests
./test.sh pets                   # Pet endpoint tests
./test.sh consistency            # Data consistency tests
```

See [TESTING.md](TESTING.md) for full details.

## License

This project is licensed under the MIT License. See the LICENSE file for details.
