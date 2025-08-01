# Gorgonetics Documentation

Welcome to Gorgonetics, a web-based gene editing tool for Project Gorgon pet breeding.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Documentation](#documentation)
- [CLI Commands](#cli-commands)
- [Development](#development)

## Overview

Gorgonetics provides an intuitive web interface for viewing and editing genetic data for different animal types, with support for importing/exporting gene configurations and real-time change tracking.

### Key Features

- 🧬 **Gene Editing**: Interactive web interface for editing dominant/recessive effects
- 📊 **Multi-Species Support**: Handles different animal types (Beewasp, Horse)
- 💾 **Export/Import**: JSON export functionality for gene configurations
- 🎮 **Pet Management**: Upload and visualize pet genome data
- ⚡ **Real-time Updates**: Instant change detection and save state management
- 🔒 **Type Safety**: Full type annotations with mypy strict mode

## Quick Start

### Installation

```bash
# Clone and setup
git clone https://github.com/jlopezpena/Gorgonetics.git
cd Gorgonetics
uv sync --dev
```

### Start Web Application

```bash
# Start the development server
uv run python scripts/run_web_app.py
```

Visit `http://127.0.0.1:8000` to start editing genes!

### Basic Workflow

1. Select animal type (Beewasp, Horse)
2. Select chromosome (chr01, chr02, etc.)
3. Click "Load Genes" to display gene cards
4. Edit gene properties (effects, appearance, notes)
5. Save changes when modifications are detected
6. Export data as JSON files

## Documentation

📚 **Comprehensive documentation:**

- **[Complete Guide](README.md)** - Full project overview and setup
- **[API Reference](API.md)** - REST API endpoints and examples
- **[Database Guide](DATABASE.md)** - Schema and operations
- **[Frontend Architecture](FRONTEND.md)** - JavaScript modules and UI
- **[Development Guide](DEVELOPMENT.md)** - Setup, testing, and contribution

## CLI Commands

### `gorgonetics --version`
Shows the version information.

### `gorgonetics --help`
Shows help information and available commands.

### Web Application

```bash
# Start web server
uv run python scripts/run_web_app.py

# Setup database (optional - auto-initializes)
uv run python scripts/populate_database.py
```

## Development

### Quick Setup

```bash
# Install dependencies
uv sync --dev

# Run quality checks
uv run ruff check && uv run mypy src/gorgonetics && uv run pytest

# Start development server
uv run python scripts/run_web_app.py
```

### Technology Stack

- **Backend**: FastAPI + DuckDB - High-performance web API with embedded database
- **Frontend**: Vanilla JavaScript ES6+ - Modular architecture
- **Tools**: uv, ruff, mypy, pytest - Modern Python development stack

For detailed development instructions, see the [Development Guide](DEVELOPMENT.md).
