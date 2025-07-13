# PGBreeder Documentation

## Overview

PGBreeder is a web-based gene editing tool for Project Gorgon pet breeding. It provides an intuitive interface for viewing and editing genetic data for different animal types, with support for importing/exporting gene configurations and real-time change tracking.

## Table of Contents

- [Project Structure](#project-structure)
- [Architecture](#architecture)
- [Installation](#installation)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Database Schema](#database-schema)
- [Frontend Modules](#frontend-modules)
- [Development](#development)
- [Contributing](#contributing)

## Project Structure

```
PGBreeder/
├── src/pgbreeder/           # Main Python package
│   ├── __init__.py
│   ├── cli.py              # Command-line interface
│   ├── database.py         # Database operations (DuckDB)
│   ├── web_app.py          # FastAPI web application
│   ├── static/             # Static web assets
│   │   ├── styles.css      # Application styles
│   │   └── js/             # JavaScript modules
│   │       ├── api-client.js      # API communication
│   │       ├── app-controller.js  # Main application coordinator
│   │       ├── export-manager.js  # Export functionality
│   │       ├── gene-manager.js    # Gene editing logic
│   │       └── ui-utils.js        # UI utilities
│   └── templates/          # HTML templates
│       └── index.html      # Main application interface
├── assets/                 # Gene template files
│   ├── beewasp/           # Bee/Wasp gene data (JSON)
│   └── horse/             # Horse gene data (JSON)
├── data/                  # Raw gene data files
├── tests/                 # Test files
├── scripts/               # Utility scripts
├── docs/                  # Documentation
├── pyproject.toml         # Project configuration
├── populate_database.py   # Database population script
├── run_web_app.py         # Web application launcher
└── README.md              # Project overview
```

## Architecture

### Backend Stack
- **Python 3.13+**: Modern Python with latest type hints
- **FastAPI**: High-performance web framework with automatic API docs
- **DuckDB**: Embedded analytical database for gene data
- **Uvicorn**: ASGI server for development
- **Pydantic**: Data validation and serialization

### Frontend Stack
- **Vanilla JavaScript ES6+**: Modular, class-based architecture
- **CSS3**: Responsive design with Flexbox/Grid
- **HTML5**: Semantic markup

### Development Tools
- **uv**: Fast Python package manager
- **ruff**: Python linter and formatter
- **mypy**: Static type checking
- **pytest**: Testing framework

## Installation

### Prerequisites
- Python 3.13 or higher
- uv package manager

### Setup
1. Clone the repository:
   ```bash
   git clone https://github.com/jlopezpena/PGBreeder.git
   cd PGBreeder
   ```

2. Install dependencies:
   ```bash
   uv sync --dev
   ```

3. Populate the database:
   ```bash
   uv run python populate_database.py
   ```

4. Start the web application:
   ```bash
   uv run python run_web_app.py
   ```

5. Open your browser to `http://127.0.0.1:8000`

## Usage

### Basic Workflow

1. **Select Animal Type**: Choose from available animal types (Beewasp, Horse)
2. **Select Chromosome**: Pick a specific chromosome to edit
3. **Load Genes**: Display genes for the selected chromosome
4. **Edit Genes**: Modify dominant/recessive effects, appearance, and notes
5. **Save Changes**: Click Save button to persist changes
6. **Export Data**: Export modified genes to JSON files

### Gene Editing

- **Effects**: Select from predefined effect options (Intelligence+/-, Toughness+/-, etc.)
- **Appearance**: Free-text description of visual effects
- **Notes**: Additional comments or observations
- **Change Tracking**: Save buttons enable only when changes are detected

### Export Options

- **Single Chromosome**: Export currently selected chromosome
- **All Chromosomes**: Export all chromosomes for selected animal type
- **File Format**: Compatible JSON format for re-importing

## API Reference

### Animal Types
- `GET /api/animal-types` - Get list of available animal types

### Chromosomes
- `GET /api/chromosomes/{animal_type}` - Get chromosomes for animal type

### Genes
- `GET /api/genes/{animal_type}/{chromosome}` - Get genes for chromosome
- `GET /api/gene/{animal_type}/{gene}` - Get specific gene
- `PUT /api/gene` - Update gene data

### Effects
- `GET /api/effect-options` - Get available effect options

### Export
- `GET /api/export/{animal_type}` - Export all chromosomes
- `GET /api/export/{animal_type}/{chromosome}` - Export specific chromosome
- `GET /api/download/{animal_type}/{chromosome}` - Download chromosome file

## Database Schema

### Genes Table
```sql
CREATE TABLE genes (
    animal_type VARCHAR NOT NULL,      -- Animal type (beewasp, horse)
    chromosome VARCHAR NOT NULL,       -- Chromosome identifier
    gene VARCHAR NOT NULL,             -- Gene identifier (e.g., 01A1)
    effect_dominant VARCHAR,           -- Dominant effect
    effect_recessive VARCHAR,          -- Recessive effect
    appearance VARCHAR,                -- Appearance description
    notes VARCHAR,                     -- Additional notes
    created_at TIMESTAMP,              -- Creation timestamp
    updated_at TIMESTAMP,              -- Last update timestamp
    PRIMARY KEY (animal_type, gene)
);
```

## Frontend Modules

### ApiClient (`api-client.js`)
Handles all communication with the backend API.

**Key Methods:**
- `getAnimalTypes()` - Fetch available animal types
- `getGenes(animalType, chromosome)` - Fetch genes for chromosome
- `updateGene(updateData)` - Save gene changes
- `exportChromosome(animalType, chromosome)` - Export chromosome

### GeneManager (`gene-manager.js`)
Manages gene display, editing, and saving operations.

**Key Methods:**
- `displayGenes(genes, animalType)` - Render gene cards
- `createGeneCard(gene, animalType)` - Create individual gene card
- `saveGene(geneId, animalType)` - Save gene changes
- `checkForChanges(card)` - Track changes for save state

### UIUtils (`ui-utils.js`)
Provides common UI utilities and user feedback.

**Key Methods:**
- `showSuccess(message)` - Display success message
- `showError(message)` - Display error message
- `showLoading(message)` - Display loading state
- `updateButtonStates(animalType, chromosome)` - Update UI state

### ExportManager (`export-manager.js`)
Handles data export functionality.

**Key Methods:**
- `exportChromosome()` - Export single chromosome
- `exportAllChromosomes()` - Export all chromosomes

### AppController (`app-controller.js`)
Main application coordinator that initializes and connects all modules.

**Key Methods:**
- `initialize()` - Set up application
- `loadAnimalTypes()` - Load animal type options
- `setupEventListeners()` - Wire up UI events

## Development

### Code Style
- Follow PEP 8 for Python code (88 character line length)
- Use type hints for all functions and methods
- Use double quotes for strings
- Write docstrings for all public functions and classes

### Testing
```bash
# Run all tests
uv run pytest

# Run with coverage
uv run pytest --cov=pgbreeder

# Run specific test file
uv run pytest tests/test_database.py
```

### Linting and Formatting
```bash
# Check code style
uv run ruff check

# Format code
uv run ruff format

# Type checking
uv run mypy src/
```

### Development Server
```bash
# Start development server with auto-reload
uv run python run_web_app.py
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes
4. Run tests: `uv run pytest`
5. Check code style: `uv run ruff check`
6. Commit your changes: `git commit -am 'Add feature'`
7. Push to the branch: `git push origin feature-name`
8. Create a Pull Request

### Development Workflow
1. Always run `uv sync --dev` to install dependencies
2. Use `ruff check` for linting
3. Use `ruff format` for formatting
4. Use `mypy` for type checking
5. Use `pytest` for running tests

## Troubleshooting

### Common Issues

**Database Locked Error**
- Stop any running Python processes: `taskkill /F /IM python.exe`
- Restart the application

**Export Not Working**
- Check browser console for JavaScript errors
- Verify API endpoints are responding

**Gene Changes Not Saving**
- Check network tab for failed API requests
- Verify field names match API expectations

**UI Not Loading**
- Check if static files are being served correctly
- Verify JavaScript modules are loading in correct order

## License

This project is licensed under the MIT License - see the LICENSE file for details.
