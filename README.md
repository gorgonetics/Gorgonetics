# Gorgonetics

[![CI](https://github.com/gorgonetics/Gorgonetics/workflows/CI/badge.svg)](https://github.com/gorgonetics/Gorgonetics/actions/workflows/ci.yml)

A native desktop app for genetic breeding analysis in [Project Gorgon](https://projectgorgon.com). Upload, visualize, and edit pet genome data with an interactive gene visualization grid.

Built with **Tauri v2** (Rust) + **Svelte 5** (SvelteKit) + **TypeScript** + **SQLite**.

**[Website & Downloads](https://gorgonetics.github.io/Gorgonetics/)**

## Features

- Upload and manage pet genome files (.txt format from Project Gorgon), including auto-import from your game folder
- Interactive gene visualization grid with attribute/appearance views
- Attribute stats summary with counts and breakdowns
- Edit gene effects (dominant/recessive) per chromosome
- Breeding assistant and side-by-side pet comparison
- Per-pet image gallery with drag-and-drop reordering
- Optional community catalogue: share pets publicly and browse/import others' (opt-in)
- Species-specific attribute configuration (BeeWasp, Horse)
- Export gene data as JSON; back up and restore the whole database
- Automatic update checks for installed builds
- Native file dialogs, SQLite database, single-binary distribution
- Pet data is stored locally by default — accounts and the cloud are only involved if you opt in to community sharing

## Download

Pre-built installers for macOS, Windows, and Linux are available on the [releases page](https://github.com/gorgonetics/Gorgonetics/releases).

See the [website](https://gorgonetics.github.io/Gorgonetics/) for detailed installation instructions.

## Development

### Prerequisites

- [Rust](https://rustup.rs/) (stable toolchain)
- [Node.js](https://nodejs.org/) 22 (matches CI)
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

### Commands

| Command | Description |
|---------|-------------|
| `pnpm tauri:dev` | Launch native app (dev mode) |
| `pnpm dev` | Frontend dev server only (port 5174) |
| `pnpm build` | Build frontend (static site) |
| `pnpm tauri:build` | Build production native app |
| `pnpm tauri:build:windows` | Cross-compile Windows installer from macOS |
| `pnpm test` | Vitest unit tests |
| `pnpm test:e2e` | Playwright E2E tests |
| `pnpm test:e2e:headed` | E2E tests with visible browser |
| `pnpm test:firestore` | Firestore-emulator integration tests |
| `pnpm check` | `svelte-check` type checking |
| `pnpm run lint:ci` | Biome lint check |
| `pnpm run lint:fix` | Auto-fix formatting and lint issues |

### Architecture

```
src/
  routes/           SvelteKit pages (layout + main page)
  lib/
    components/     Svelte 5 components (layout, pet, gene, breeding,
                    comparison, community, stable, shared)
    services/       TypeScript service layer (database, parsing, breeding,
                    sharing, game-folder import, backup, updates)
    stores/         Svelte writable stores
    types/          TypeScript interfaces
src-tauri/          Tauri Rust backend + config
assets/             Gene template JSON source files
data/               Sample genome text files
scripts/            Build/release helpers (asset sync, release, screenshots)
tests/              Vitest unit tests + Playwright E2E (tests/e2e/)
```

### Tech Stack

- **Desktop Shell**: Tauri v2 (Rust)
- **Frontend**: SvelteKit + Svelte 5 (runes)
- **Styling**: Plain CSS + Svelte scoped styles (no CSS framework); shared classes in `src/app.css`
- **Database**: SQLite via tauri-plugin-sql
- **Community backend**: Firebase / Firestore (used only for opt-in pet sharing)
- **Icons**: `@lucide/svelte`
- **Testing**: Vitest (unit) + Playwright (E2E) + Firestore emulator (integration)
- **Linting**: Biome

## Species & Data

- **BeeWasp**: 10 chromosomes, attributes: Ferocity + 6 core
- **Horse**: 48 chromosomes, attributes: Temperament + 6 core
- Core attributes: Toughness, Ruggedness, Enthusiasm, Friendliness, Intelligence, Virility

### Gene data for community tools

Each tagged release attaches a `gorgonetics-genes.zip` artifact containing the canonical `assets/horse/` and `assets/beewasp/` JSONs plus a top-level `MANIFEST.json` (version, build date, per-species file count). The asset filename is intentionally version-free so this URL always resolves to the latest release:

```
https://github.com/gorgonetics/Gorgonetics/releases/latest/download/gorgonetics-genes.zip
```

Safe to use directly from `curl` / `wget` in build scripts. Detect updates by comparing the `version` field in the bundled `MANIFEST.json`. The asset format (`gene`, `effectDominant`, `effectRecessive`, `appearance`, `breed`, `notes`) round-trips through the gene editor and is stable.

## License

MIT
