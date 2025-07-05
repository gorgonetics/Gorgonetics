# PGBreeder Documentation

Welcome to PGBreeder, a simple Python CLI application.

## Table of Contents

- [Installation](#installation)
- [Getting Started](#getting-started)
- [CLI Commands](#cli-commands)
- [Development](#development)

## Installation

Install PGBreeder using uv:

```bash
uv add pgbreeder
```

Or install in development mode:

```bash
uv sync --dev
```

## Getting Started

1. Say hello:
   ```bash
   pgbreeder hello
   ```

2. Say hello to someone specific:
   ```bash
   pgbreeder hello Alice
   ```

3. Check version:
   ```bash
   pgbreeder --version
   ```

## CLI Commands

### `pgbreeder hello [NAME]`
Says hello to the specified name (defaults to "World").

### `pgbreeder --version`
Shows the version information.

### `pgbreeder --help`
Shows help information.

## Development

See the main [README.md](../README.md) for development instructions.
