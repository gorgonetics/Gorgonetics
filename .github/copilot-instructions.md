# Copilot Instructions for PGBreeder

<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

## Project Overview

PGBreeder is a simple Python CLI application built with modern Python tooling and follows best practices.

## Tech Stack

- **Package Manager**: uv
- **Type Checker**: ty with strict settings
- **Linter/Formatter**: ruff
- **Testing**: pytest
- **CLI Framework**: typer with rich for beautiful output

## Code Style Guidelines

- Follow PEP 8 with 88 character line length
- Use type hints for all functions and methods
- Prefer double quotes for strings
- Use docstrings for all public functions, classes, and modules
- Keep functions focused and small
- Target python 3.13+ for type hints and features

## Project Structure

```
src/pgbreeder/    # Main package
tests/            # Test files
docs/             # Documentation
```

## Development Workflow

1. Always run `uv sync --dev` to install dependencies
2. Use `ruff check` for linting
3. Use `ruff format` for formatting
4. Use `mypy` for type checking
5. Use `pytest` for running tests
6. Use `typos` for spell checking

## Testing

- Write tests for all new features
- Use pytest fixtures for common test setup
- Test both success and error cases
- Use descriptive test names that explain what is being tested

## CLI Design

- Use typer for command-line interface
- Use rich for beautiful terminal output
- Provide helpful error messages
- Include progress indicators for long-running operations
