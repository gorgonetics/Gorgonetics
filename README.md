# Gorgonetics

[![CI](https://github.com/jlopezpena/Gorgonetics/workflows/CI/badge.svg)](https://github.com/jlopezpena/Gorgonetics/actions/workflows/ci.yml)
[![Code Quality](https://github.com/jlopezpena/Gorgonetics/workflows/Code%20Quality/badge.svg)](https://github.com/jlopezpena/Gorgonetics/actions/workflows/code-quality.yml)
[![Integration Tests](https://github.com/jlopezpena/Gorgonetics/workflows/Integration%20Tests/badge.svg)](https://github.com/jlopezpena/Gorgonetics/actions/workflows/integration.yml)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![Code style: ruff](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/astral-sh/ruff/main/assets/badge/v2.json)](https://github.com/astral-sh/ruff)
[![uv](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/astral-sh/uv/main/assets/badge/v0.json)](https://github.com/astral-sh/uv)

A web-based gene editing tool for Project Gorgon pet breeding. Provides an intuitive interface for viewing and editing genetic data for different animal types with real-time change tracking and export capabilities.

> 🧬 **Gorgonetics** = *Gorgon* + *Genetics* - A punny name for a powerful breeding tool!

## Features

- **🧬 Gene Editing**: Interactive web interface for editing dominant/recessive effects, appearance, and notes
- **📊 Multi-Species Support**: Handles different animal types (Beewasp, Horse) with chromosome-specific data
- **💾 Export/Import**: JSON export functionality for backing up and sharing gene configurations
- **⚡ Real-time Updates**: Instant change detection and save state management
- **🔒 Type Safety**: Full type annotations with mypy strict mode
- **🎨 Modern UI**: Responsive design with collapsible gene cards and intuitive controls
- **📈 Performance**: DuckDB embedded database for fast analytical queries

## Quick Start

### Prerequisites

- Python 3.13+
- [uv](https://docs.astral.sh/uv/) package manager

### Installation

```bash
git clone https://github.com/jlopezpena/Gorgonetics.git
cd Gorgonetics
uv sync --dev
```

### Setup Database (Optional)

The database is automatically initialized when you first start the web application. To manually populate it with sample data:

```bash
uv run python scripts/populate_database.py
```

### Start Web Application

```bash
uv run python scripts/run_web_app.py
```

Visit `http://127.0.0.1:8000` to start editing genes!

> **Note**: The database will be automatically created and initialized on first run. No manual setup required!

## Documentation

📚 **Comprehensive documentation is available in the `docs/` directory:**

- **[Complete Documentation](docs/README.md)** - Full project overview and setup guide
- **[API Reference](docs/API.md)** - REST API endpoints and usage examples  
- **[Database Guide](docs/DATABASE.md)** - Schema, operations, and optimization
- **[Frontend Architecture](docs/FRONTEND.md)** - JavaScript modules and UI components
- **[Development Guide](docs/DEVELOPMENT.md)** - Setup, testing, and contribution guidelines

### Basic Workflow

1. **Select Animal Type**: Choose from available species (Beewasp, Horse)
2. **Select Chromosome**: Pick a chromosome to edit (chr01, chr02, etc.)
3. **Load Genes**: Display genes for editing
4. **Edit Properties**: Modify effects, appearance, and notes
5. **Save Changes**: Click save buttons when changes are detected
6. **Export Data**: Download modified genes as JSON files

### Example: Editing a Gene

1. Select "beewasp" from the animal type dropdown
2. Select "chr01" from the chromosome dropdown  
3. Click "Load Genes" to display gene cards
4. Find gene "01A1" and modify its properties:
   - **Dominant Effect**: Intelligence+
   - **Recessive Effect**: Intelligence-
   - **Appearance**: "Brighter antenna glow"
   - **Notes**: "Observed in laboratory conditions"
5. Click "Save" button to persist changes
6. Use "Export Chromosome" to download the modified data

## Development

The project follows modern Python development practices with comprehensive tooling:

### Quick Development Setup

```bash
# Install dependencies
uv sync --dev

# Run all quality checks
uv run ruff check && uv run mypy src/gorgonetics && uv run pytest

# Start development server (database auto-initializes)
uv run python scripts/run_web_app.py
```

### Available Tasks (VS Code)

- **Install Dependencies**: `uv sync --dev`
- **Run Tests**: `uv run pytest`
- **Run Tests with Coverage**: `uv run pytest --cov=gorgonetics`
- **Lint Code**: `uv run ruff check`
- **Format Code**: `uv run ruff format`
- **Type Check**: `uv run mypy src/gorgonetics`

### CLI Usage

The project provides a CLI interface:

```bash
# Basic CLI interface
uv run gorgonetics --help

# Web application server
uv run python scripts/run_web_app.py
```

### Project Architecture

```
src/gorgonetics/           # Main Python package
├── __init__.py          # Package initialization
├── cli.py              # Command-line interface  
├── database.py          # DuckDB operations
├── genome_parser.py     # Genome data parsing
├── models.py           # Data models
├── web_app.py          # FastAPI web server
├── static/             # Web assets
│   ├── styles.css      # Application styles
│   ├── favicon.png     # Site icon
│   └── js/             # JavaScript modules
│       ├── api-client.js      # API communication
│       ├── app-controller.js   # Main app logic
│       ├── export-manager.js   # Data export
│       ├── gene-manager.js     # Gene editing
│       ├── gene-visualizer.js  # Gene visualization
│       └── ui-utils.js        # UI utilities
└── templates/          # HTML templates

scripts/                # Utility scripts
├── generate_gene_templates.py  # Template generation
├── populate_database.py        # Database setup
└── run_web_app.py             # Development server

assets/                 # Gene template data
├── beewasp/           # Bee/Wasp genetic data
└── horse/             # Horse genetic data

data/                  # Sample data files
├── Genes_BabyFaeBee178.txt    # Sample bee genome
└── Genes_Roach.txt            # Sample roach genome

docs/                  # Comprehensive documentation
├── API.md             # REST API reference
├── DATABASE.md        # Database guide
├── DEVELOPMENT.md     # Development setup
├── FRONTEND.md        # Frontend architecture
└── README.md          # Complete documentation

tests/                 # Test suite
nbs/                   # Jupyter notebooks
.github/               # GitHub workflows
```

## Technology Stack

- **Backend**: [FastAPI](https://fastapi.tiangolo.com/) + [DuckDB](https://duckdb.org/) - High-performance web API with embedded analytics database
- **Frontend**: Vanilla JavaScript ES6+ - Modular architecture with clean separation of concerns
- **Frontend Package Manager**: [pnpm](https://pnpm.io/) - Fast, disk-efficient Node.js package manager
- **Python Package Manager**: [uv](https://docs.astral.sh/uv/) - Fast Python package installer and resolver
- **Type Safety**: [mypy](https://mypy.readthedocs.io/) - Static type checker with strict mode
- **Code Quality**: [ruff](https://docs.astral.sh/ruff/) - Fast Python linter and formatter
- **Testing**: [pytest](https://docs.pytest.org/) - Comprehensive testing framework
- **CLI**: [typer](https://typer.tiangolo.com/) + [rich](https://rich.readthedocs.io/) - Beautiful command-line interface

## Recent Updates

### Code Quality Improvements
- ✅ **JavaScript Cleanup**: Removed unnecessary files (`emoji-test.html`, duplicate ESLint config)
- ✅ **Cache Management**: Cleaned up development cache directories and updated `.gitignore`
- ✅ **Test Fixes**: Updated CLI tests to match actual functionality
- ✅ **ESLint Configuration**: Configured to allow both single and double quotes
- ✅ **Code Formatting**: Applied consistent formatting across all JavaScript and Python files

### Development Workflow
- ✅ **Linting**: All code passes `ruff check` without issues
- ✅ **Type Safety**: All code passes `mypy` strict type checking
- ✅ **Testing**: 17 tests passing with 100% success rate
- ✅ **Documentation**: Updated README to reflect current project structure
- ✅ **Entry Points**: Removed proof-of-concept `gorgonetics-web` entry point, standardized on script-based startup

## Contributing

We welcome contributions! Please see our [Development Guide](docs/DEVELOPMENT.md) for detailed instructions.

### Quick Contribution Steps

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes following our coding standards
4. Run tests and quality checks: `uv run pytest && uv run ruff check`
5. Submit a pull request with a clear description

## License

This project is licensed under the MIT License - see the LICENSE file for details.
