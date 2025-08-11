# Copilot Instructions for Gorgonetics

## Response Style

- Do not provide summaries of work completed unless specifically requested
- NEVER PROVIDE SUMMARIES OF WORK COMPLETED
- Keep responses concise and focused on the immediate task
- Only explain what you're doing if there's ambiguity or complexity that needs clarification
- Do not use emojis or emoticons

## Project Overview

Gorgonetics is a simple Python CLI application built with modern Python tooling and follows best practices.

## Tech Stack

- **Package Manager**: uv
- **Type Checker**: ty with strict settings
- **Linter/Formatter**: ruff
- **Testing**: pytest
- **CLI Framework**: typer with rich for beautiful output

## Code Style Guidelines

- Follow PEP 8 with 120 character line length
- Use type hints for all functions and methods
- Prefer double quotes for strings
- Use docstrings for all public functions, classes, and modules
- Keep functions focused and small
- Target python 3.13+ for type hints and features

## Project Structure

```
src/gorgonetics/    # Main package
tests/            # Test files
docs/             # Documentation
assets/           # Static assets (e.g., genome files)
scripts/         # Utility scripts
.github/          # GitHub workflows and configurations
.github/copilot-instructions.md  # Copilot instructions (this file)
```

## Development Workflow

0. Never try to run `python`, always use `uv run python`
1. Always run `uv sync --dev` to install dependencies
2. Use `ruff check` for linting
3. Use `ruff format` for formatting
4. Use `mypy` for type checking
5. Use `pytest` for running tests
6. Avoid creating new terminal tabs, reuse the existing ones. If creating a new terminal tab, ensure it is for a specific task (e.g., running tests, starting the server) and not just for convenience, and close it when done.

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
