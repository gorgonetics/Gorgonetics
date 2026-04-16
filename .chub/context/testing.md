---
name: Testing Strategy
description: "E2E test structure, helpers, database setup, and CI integration"
tags: testing, playwright, vitest, e2e
---

# Testing Strategy

## E2E Tests (Playwright)

- **Location:** `tests/e2e/` (10 spec files, ~30 tests)
- **Config:** `playwright.config.js` — `baseURL: http://localhost:5174`, auto-starts `pnpm dev`
- **Execution:** Sequential (`fullyParallel: false`), 1 retry on failure
- **Browser:** Chromium only
- **Reports:** HTML report (never auto-opened), screenshots on failure only

### Helpers

```javascript
waitForAppReady()   // Waits for loading screen to disappear
waitForPets()       // Waits for pet list to populate
openGeneEditor()    // Navigates to gene editor tab
openEditor()        // Opens pet editor modal
```

### Database in Tests

Tests use the in-memory database fallback (no Tauri dependency). Demo data (Sample Fae Bee, Sample Horse) is auto-loaded by `demoService` on startup.

### Asset Requirements

CI must copy assets before running tests:
```bash
mkdir -p src/static/assets src/static/data
cp -r assets/* src/static/assets/
cp -r data/* src/static/data/
```

Without this, gene templates and demo genomes won't load — tests fail silently with empty data.

## Unit Tests (Vitest)

- **Location:** `tests/unit/`
- **Run:** `pnpm test` (Vitest)
- **Database:** Uses `InMemoryDatabase` adapter directly
- **Coverage:** Service layer functions (parsing, comparison, stats)

## Quality Gates (CI enforced)

```bash
pnpm lint:ci        # Biome — zero diagnostics (errors + warnings + infos)
cargo check         # Rust compilation (from src-tauri/)
pnpm test:e2e       # Playwright E2E
```

All three must pass before merging.
