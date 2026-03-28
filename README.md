# Gorgonetics

[![CI](https://github.com/jlopezpena/Gorgonetics/workflows/CI/badge.svg)](https://github.com/jlopezpena/Gorgonetics/actions/workflows/ci.yml)

A native desktop app for genetic breeding analysis in [Project Gorgon](https://projectgorgon.com). View, edit, and analyze pet genome data with an interactive gene visualization grid.

Built with **Tauri v2** (Rust) + **Svelte 5** (SvelteKit) + **TypeScript** + **SQLite**.

## Features

- Upload and manage pet genome files (.txt format from Project Gorgon)
- Interactive gene visualization grid with attribute/appearance views
- Edit gene effects (dominant/recessive) per chromosome
- Species-specific attribute configuration (BeeWasp, Horse)
- Export gene data as JSON
- Native file dialogs, SQLite database, single-binary distribution

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) (stable toolchain)
- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/)

### Setup

```bash
pnpm install          # Install JavaScript dependencies
```

### Run

```bash
pnpm tauri:dev        # Launch the native app
```

This starts the Vite dev server and opens the Tauri window.

### Build

```bash
pnpm tauri:build      # Build production app (.app/.dmg on macOS)
```

## Development

### Commands

| Command | Description |
|---------|-------------|
| `pnpm tauri:dev` | Launch native app (dev mode) |
| `pnpm dev` | Frontend dev server only (port 5174) |
| `pnpm build` | Build frontend (static site) |
| `pnpm tauri:build` | Build production native app |
| `pnpm run lint:ci` | ESLint (zero warnings) |
| `pnpm test:e2e` | Playwright E2E tests |
| `pnpm test:e2e:headed` | E2E tests with visible browser |

### Architecture

```
src/
  routes/           SvelteKit pages (layout + main page)
  lib/
    components/     Svelte 5 components (layout, pet, gene)
    services/       TypeScript service layer (database, API, parsing)
    stores/         Svelte writable stores
    types/          TypeScript interfaces
src-tauri/          Tauri Rust backend + config
assets/             Gene template JSON source files
data/               Sample genome text files
tests/e2e/          Playwright E2E tests
```

### Tech Stack

- **Desktop Shell**: Tauri v2 (Rust)
- **Frontend**: SvelteKit + Svelte 5 (runes)
- **Styling**: Tailwind CSS v4, Flowbite Svelte
- **Database**: SQLite via tauri-plugin-sql
- **Icons**: Lucide Svelte
- **Testing**: Playwright
- **Linting**: ESLint

## Species & Data

- **BeeWasp**: 10 chromosomes, attributes: Ferocity + 6 core
- **Horse**: 48 chromosomes, attributes: Temperament + 6 core
- Core attributes: Toughness, Ruggedness, Enthusiasm, Friendliness, Intelligence, Virility

## License

MIT
