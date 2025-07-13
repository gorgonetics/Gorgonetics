# PGBreeder

A web-based gene editing tool for Project Gorgon pet breeding. Provides an intuitive interface for viewing and editing genetic data for different animal types with real-time change tracking and export capabilities.

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
git clone https://github.com/jlopezpena/PGBreeder.git
cd PGBreeder
uv sync --dev
```

### Setup Database

```bash
uv run python populate_database.py
```

### Start Web Application

```bash
uv run python run_web_app.py
```

Visit `http://127.0.0.1:8000` to start editing genes!

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
uv run ruff check && uv run mypy src/ && uv run pytest

# Start development server
uv run python run_web_app.py
```

### Available Tasks (VS Code)

- **Install Dependencies**: `uv sync --dev`
- **Run Tests**: `uv run pytest`
- **Run Tests with Coverage**: `uv run pytest --cov=pgbreeder`
- **Lint Code**: `uv run ruff check`
- **Format Code**: `uv run ruff format`
- **Type Check**: `uv run mypy src/`

### Project Architecture

```
src/pgbreeder/           # Main Python package
├── database.py          # DuckDB operations
├── web_app.py          # FastAPI web server
├── cli.py              # Command-line interface
├── static/             # Web assets (CSS, JavaScript)
└── templates/          # HTML templates

assets/                 # Gene template data
├── beewasp/           # Bee/Wasp genetic data
└── horse/             # Horse genetic data

docs/                  # Comprehensive documentation
tests/                 # Test suite
```

## Technology Stack

- **Backend**: [FastAPI](https://fastapi.tiangolo.com/) + [DuckDB](https://duckdb.org/) - High-performance web API with embedded analytics database
- **Frontend**: Vanilla JavaScript ES6+ - Modular architecture with clean separation of concerns
- **Package Manager**: [uv](https://docs.astral.sh/uv/) - Fast Python package installer and resolver
- **Type Safety**: [mypy](https://mypy.readthedocs.io/) - Static type checker with strict mode
- **Code Quality**: [ruff](https://docs.astral.sh/ruff/) - Fast Python linter and formatter
- **Testing**: [pytest](https://docs.pytest.org/) - Comprehensive testing framework
- **CLI**: [typer](https://typer.tiangolo.com/) + [rich](https://rich.readthedocs.io/) - Beautiful command-line interface

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
