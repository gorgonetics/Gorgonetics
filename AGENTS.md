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
- **`src/lib/components/pet/PetImageGallery.svelte`**: Pet image gallery with drag-and-drop reordering
- **`src/lib/components/layout/DataMenu.svelte`**: Export/import menu
- **`src/lib/components/layout/ExportDialog.svelte`**: Export dialog
- **`src/lib/components/layout/ImportDialog.svelte`**: Import dialog
- **`src/lib/components/layout/SettingsModal.svelte`**: Settings UI
- **`src/lib/components/AuthWrapper.svelte`**: App initializer (DB + demo data)

### TypeScript Service Layer (`src/lib/services/`)
- **`database.ts`**: SQLite via tauri-plugin-sql (in-memory fallback for tests)
- **`migrationService.ts`**: Schema versioning via PRAGMA user_version
- **`geneService.ts`**: Gene CRUD operations
- **`petService.ts`**: Pet CRUD + genome visualization
- **`imageService.ts`**: Pet image upload, gallery, reordering
- **`configService.ts`**: Species attribute/appearance configuration
- **`genomeParser.ts`**: Genome text file parser
- **`nameParser.ts`**: Structured pet name parsing (breed/gender/attributes)
- **`fileService.ts`**: Native file dialogs (Tauri) with browser fallback
- **`backupService.ts`**: Database export/import (zip archive)
- **`settingsService.ts`**: User preferences (key-value store)
- **`demoService.ts`**: First-launch gene template + demo pet loading

### Stores (`src/lib/stores/`)
- **`pets.js`**: Pet list, selection, gene editing state, tab state
- **`settings.ts`**: User settings store
- **`auth.ts`**: Stub (always authenticated in desktop app)

### Types (`src/lib/types/`)
- **`index.ts`**: Gene, Genome, Pet, GeneRecord, AttributeInfo interfaces

### Tauri Backend (`src-tauri/`)
- **`src/lib.rs`**: Plugin registration (sql, dialog, fs)
- **`tauri.conf.json`**: Window config, resource bundling
- **`capabilities/default.json`**: Permission declarations
- **`resources/`**: Gene templates + demo genomes for Tauri to bundle. Gitignored — auto-mirrored from the canonical `assets/` and `data/` at the repo root by `pnpm sync:bundled-assets` (runs as part of `pnpm dev`/`pnpm build`).

### Database
- SQLite via tauri-plugin-sql (single file, `gorgonetics.db`)
- Tables: `genes` (gene effects), `pets` (pet data + genome JSON), `pet_images` (gallery metadata), `settings` (key-value preferences)
- Schema versioning via PRAGMA user_version + migration engine
- No auth tables (single-user desktop app)

## Development Setup

### Prerequisites
- [Rust](https://rustup.rs/) (stable)
- Node.js 22 (matches CI), [pnpm](https://pnpm.io/)

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
- Minimal — plugin registration, Tauri boilerplate, and a small set of custom
  commands only for work the webview genuinely can't do well in JS:
  - `db_execute_transaction` — real multi-statement SQLite transactions
    (tauri-plugin-sql exposes only per-statement execute; see issue #153)
  - `write_zip` — streams the backup archive to disk so a large image library
    is never fully resident in the JS heap (issue #92)
- Default to TypeScript; add a command only when there's a memory, atomicity,
  or capability reason the frontend can't satisfy.

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
- Gene templates served from `src/static/assets/` and demo pets from `src/static/data/` — both auto-mirrored from the canonical `assets/` and `data/` by `pnpm sync:bundled-assets` (runs via `pnpm dev`, which Playwright invokes as its `webServer.command`)

## Key Patterns

### Releasing
```bash
pnpm release patch   # or: minor, major
```
This runs `scripts/release.sh` which:
1. Bumps version in package.json, tauri.conf.json, Cargo.toml, Cargo.lock, docs/index.html
2. Regenerates docs screenshots via `pnpm screenshots`
3. Runs lint and E2E tests
4. Deploys `firestore.rules` to the live project **if they changed since the last tag** (`firebase deploy --only firestore:rules`). The sharing catalogue has no auth — it's secured entirely by these rules, which CI does not deploy. If the client payload changes without the deployed rules matching, every share fails with `permission-denied`, so rules must never drift behind a release.
5. Builds changelog from commits since last tag
6. Commits, creates annotated tag with changelog, pushes
7. The tag triggers the Release workflow (builds macOS/Windows/Linux binaries)
8. The Pages workflow deploys docs on release publish

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
assets/                 # Canonical gene template JSON source files (mirrored to src-tauri/resources/assets and src/static/assets at build)
data/                   # Canonical sample genome text files (mirrored to src-tauri/resources/data and src/static/data at build)
tests/e2e/              # Playwright E2E tests
```

## Context Hub (chub)

This project uses [chub](https://chub.nrl.ai) for shared AI context — pinned docs, annotations, and lessons learned.

### Mandatory: Keep chub annotations up to date

When working in this codebase, proactively maintain chub annotations:

- **After discovering a bug or gotcha** with a dependency: `chub annotate <doc-id> --kind issue`
- **After finding a workaround**: `chub annotate <doc-id> --kind fix`
- **After validating a useful pattern**: `chub annotate <doc-id> --kind practice`

Before starting work, check existing annotations for relevant context:
```bash
chub context --task "your task description"
```

When adding new dependencies, pin their docs:
```bash
chub detect --pin
```

Do not wait to be asked — treat annotation maintenance the same as running lint before committing.

## Species & Data

- **Beewasp**: 10 chromosomes, attributes: Ferocity + 6 core
- **Horse**: 48 chromosomes, attributes: Temperament + 6 core
- Core attributes: Toughness, Ruggedness, Enthusiasm, Friendliness, Intelligence, Virility
- Extensible via `configService.ts` for new species
