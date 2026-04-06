# AGENTS.md

Shared directives for AI coding assistants working in this repository.
Tool-specific files (CLAUDE.md, .github/copilot-instructions.md) extend these.

## Project Overview

Gorgonetics is a native desktop app for genetic breeding analysis in Project Gorgon. Built with Tauri v2 (Rust shell) + SvelteKit/Svelte 5 frontend + TypeScript service layer with SQLite database.

## Architecture

### Frontend (`src/lib/`, `src/routes/`)
- **`src/routes/+layout.svelte`**: App shell — TopBar + MasterPanel + DetailPane
- **`src/routes/+page.svelte`**: Detail pane content (pet visualization or gene editor)
- **`src/lib/components/layout/TopBar.svelte`**: App header with tab switcher (Pets/Genes)
- **`src/lib/components/layout/MasterPanel.svelte`**: Left panel — PetList or GeneEditor
- **`src/lib/components/pet/PetList.svelte`**: Searchable pet card list with upload
- **`src/lib/components/pet/PetCard.svelte`**: Compact pet card (name, species, gene count)
- **`src/lib/components/pet/PetVisualization.svelte`**: Pet detail view with gene visualizer
- **`src/lib/components/pet/PetEditor.svelte`**: Modal for editing pet attributes
- **`src/lib/components/gene/GeneEditor.svelte`**: Animal type + chromosome selector
- **`src/lib/components/GeneEditingView.svelte`**: Gene effect editor grid
- **`src/lib/components/gene/GeneVisualizer.svelte`**: Interactive gene grid visualization
- **`src/lib/components/gene/GeneCell.svelte`**: Individual gene cell
- **`src/lib/components/gene/GeneStatsTable.svelte`**: Attribute stats table
- **`src/lib/components/gene/GeneTooltip.svelte`**: Gene hover tooltip
- **`src/lib/components/AuthWrapper.svelte`**: App initializer (DB + demo data)

### TypeScript Service Layer (`src/lib/services/`)
- **`database.ts`**: SQLite via tauri-plugin-sql (in-memory fallback for tests)
- **`geneService.ts`**: Gene CRUD operations
- **`petService.ts`**: Pet CRUD + genome visualization
- **`configService.ts`**: Species attribute/appearance configuration
- **`genomeParser.ts`**: Genome text file parser
- **`fileService.ts`**: Native file dialogs (Tauri) with browser fallback
- **`demoService.ts`**: First-launch gene template + demo pet loading
- **`api.ts`**: ApiClient adapter (same interface, calls services directly)

### Stores (`src/lib/stores/`)
- **`pets.js`**: Pet list, selection, gene editing state, tab state
- **`auth.ts`**: Stub (always authenticated in desktop app)

### Types (`src/lib/types/`)
- **`index.ts`**: Gene, Genome, Pet, GeneRecord, AttributeInfo interfaces

### Tauri Backend (`src-tauri/`)
- **`src/lib.rs`**: Plugin registration (sql, dialog, fs)
- **`tauri.conf.json`**: Window config, resource bundling
- **`capabilities/default.json`**: Permission declarations
- **`resources/`**: Bundled gene templates + demo genomes

### Database
- SQLite via tauri-plugin-sql (single file, `gorgonetics.db`)
- Tables: `genes` (gene effects), `pets` (pet data + genome JSON)
- No auth tables (single-user desktop app)

## Development Setup

### Prerequisites
- [Rust](https://rustup.rs/) (stable)
- Node.js 20+, [pnpm](https://pnpm.io/)

### Commands

```bash
# Setup
pnpm install                      # JS dependencies

# Run
pnpm tauri:dev                    # Launch native app (Vite + Tauri)
pnpm dev                          # Frontend dev server only (port 5174)

# Quality (MUST pass before committing)
pnpm run lint:ci                  # Biome (zero errors)
cargo check                       # Rust compilation (run from src-tauri/)

# Tests
pnpm test                         # Vitest unit tests
pnpm test:e2e                     # Playwright E2E tests
pnpm test:e2e:headed              # E2E tests with visible browser
pnpm test:e2e:ui                  # Playwright UI mode

# Build
pnpm tauri:build                  # Production app bundle (.app/.dmg)
pnpm tauri:build:windows          # Cross-compile Windows installer from macOS/Linux
pnpm build                        # Frontend only (static site)
```

### Cross-Compiling for Windows

Build Windows `.exe` installers from macOS or Linux without a Windows machine or CI.

**Prerequisites** (one-time setup):
```bash
brew install nsis llvm            # macOS (use apt on Linux)
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
```

**Build**:
```bash
pnpm tauri:build:windows
```

Output: `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Gorgonetics_*_x64-setup.exe`

**Notes**:
- First build downloads the Windows SDK (~1 GB, cached for subsequent builds)
- Produces NSIS installer only (MSI requires a Windows host)
- Code signing is skipped — use `bundler > windows > sign_command` in `tauri.conf.json` to configure external signing

## Code Standards

### TypeScript / JavaScript
- **Framework**: Svelte 5 with runes (`$props()`, `$state()`, `$derived()`, `$effect()`)
- **Services**: All data access goes through `src/lib/services/` modules
- **State**: Svelte writable stores in `src/lib/stores/`
- **Imports**: Use `$lib/` alias (e.g., `import { getDb } from '$lib/services/database.js'`)
- **CSS**: Plain CSS with Svelte scoped styles; shared classes in `src/app.css`
- **No raw fetch**: All data access through service layer, not HTTP calls

### Rust (src-tauri/)
- Minimal — only plugin registration and Tauri boilerplate
- No custom Tauri commands (all logic in TypeScript)

### Quality Gates (enforced by CI)
```bash
pnpm run lint:ci                  # Biome — must produce zero diagnostics (errors, warnings, and infos)
cargo check                       # Rust compilation
pnpm test:e2e                     # Playwright E2E tests
```
- Lint must be fully clean: zero errors, zero warnings, zero infos. Use `node:` protocol for Node.js builtins, optional chaining where suggested, and keep imports sorted.

## Testing Strategy

- **Vitest unit tests**: `tests/unit/` — service layer tests with in-memory database
- **Playwright E2E**: `tests/e2e/` — UI flow tests across multiple spec files
- Tests run against Vite dev server with in-memory database fallback
- Gene templates loaded from `src/static/assets/` (copies of `assets/`)
- Demo pets loaded from `src/static/data/` (copies of `data/`)

## Key Patterns

### Releasing
```bash
pnpm release patch   # or: minor, major
```
This runs `scripts/release.sh` which:
1. Bumps version in package.json, tauri.conf.json, Cargo.toml, Cargo.lock, docs/index.html
2. Regenerates docs screenshots via `pnpm screenshots`
3. Runs lint and E2E tests
4. Builds changelog from commits since last tag
5. Commits, creates annotated tag with changelog, pushes
6. The tag triggers the Release workflow (builds macOS/Windows/Linux binaries)
7. The Pages workflow deploys docs on release publish

After binaries are built, edit the draft release on GitHub to publish it.

### Adding a Feature
1. Define types in `src/lib/types/index.ts`
2. Add service functions in `src/lib/services/`
3. Update stores if needed in `src/lib/stores/`
4. Build Svelte components in `src/lib/components/`
5. Add E2E tests in `tests/e2e/`

### Database Access
- Use `getDb()` from `database.ts` for all SQL queries
- `initDatabase()` called once in AuthWrapper on app startup
- In-memory fallback auto-detected when not running in Tauri
- Use named `$name` parameters (with `Record<string, unknown>` bind values) instead of positional `?` placeholders

### Serving Local Files to the Webview
To display local files (images, videos) in HTML tags via `convertFileSrc()`, BOTH of these are required in `tauri.conf.json`:
1. **CSP**: `img-src` must include `asset: http://asset.localhost`
2. **`app.security.assetProtocol`**: must have `enable: true` and a `scope` array

Missing either one causes silent failure (broken images, no error). Never use blob URLs as a workaround.

### Master-Detail Layout
- MasterPanel (left, 260px): PetList or GeneEditor based on active tab
- DetailPane (right, flex): PetVisualization or GeneEditingView based on selection
- State drives navigation: `selectedPet`, `geneEditingView`, `activeTab` stores

## File Organization

```
src/lib/                # Svelte components, stores, services, types
src/routes/             # SvelteKit pages (+layout, +page)
src/static/             # Static assets (logos, icons)
src-tauri/              # Tauri Rust backend + config + bundled resources
assets/                 # Gene template JSON source files
data/                   # Sample genome text files
tests/e2e/              # Playwright E2E tests
```

## Species & Data

- **Beewasp**: 10 chromosomes, attributes: Ferocity + 6 core
- **Horse**: 48 chromosomes, attributes: Temperament + 6 core
- Core attributes: Toughness, Ruggedness, Enthusiasm, Friendliness, Intelligence, Virility
- Extensible via `configService.ts` for new species
