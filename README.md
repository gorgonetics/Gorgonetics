# PGBreeder

A simple Python CLI application built with modern Python tooling.

## Features

- **CLI Interface**: Built with typer and rich for beautiful terminal output
- **Type Safety**: Full type annotations with mypy strict mode
- **Code Quality**: Linting and formatting with ruff
- **Modern Tooling**: Built with uv, pytest, and typer

## Installation

### Prerequisites

- Python 3.9+
- [uv](https://docs.astral.sh/uv/) package manager

### Install from source

```bash
git clone <repository-url>
cd PGBreeder
uv sync --dev
```

### Install in development mode

```bash
uv pip install -e .
```

## Usage

### Say hello

```bash
pgbreeder hello
```

### Say hello to someone specific

```bash
pgbreeder hello Alice
```

### Show version

```bash
pgbreeder --version
```

### Show help

```bash
pgbreeder --help
```

## Development

### Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   uv sync --dev
   ```

### Development Commands

```bash
# Run tests
uv run pytest

# Run tests with coverage
uv run pytest --cov=pgbreeder

# Lint code
uv run ruff check

# Format code
uv run ruff format

# Type check
uv run mypy src/

# Check for typos
uv run typos

# Run all checks
uv run ruff check && uv run mypy src/ && uv run pytest
```

### Project Structure

```
src/
├── pgbreeder/
│   ├── __init__.py      # Package initialization
│   └── cli.py           # Command-line interface
tests/
├── __init__.py          # Test package
├── conftest.py          # Test configuration
├── test_cli.py          # CLI tests
└── test_main.py         # Main module tests
docs/
└── index.md             # Documentation
```

## Technology Stack

- **Package Manager**: [uv](https://docs.astral.sh/uv/) - Fast Python package installer and resolver
- **Type Checker**: [mypy](https://mypy.readthedocs.io/) - Static type checker
- **Linter/Formatter**: [ruff](https://docs.astral.sh/ruff/) - Fast Python linter and formatter
- **Testing**: [pytest](https://docs.pytest.org/) - Testing framework
- **CLI Framework**: [typer](https://typer.tiangolo.com/) - CLI framework with rich output

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run the development commands to ensure quality
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
