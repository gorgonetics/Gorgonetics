---
name: Project Architecture
description: "Gorgonetics app architecture — Tauri v2 + SvelteKit 5 + TypeScript services + SQLite"
tags: architecture, tauri, svelte, typescript
---

# Architecture Overview

Gorgonetics is a Tauri v2 desktop app for genetic breeding analysis in Project Gorgon.

## Layer Diagram

```
Frontend (Svelte 5 + SvelteKit)
├── Routes (+layout.svelte, +page.svelte)
├── Components (pet/, gene/, comparison/, layout/)
└── Stores (pets.ts, settings.ts, comparison.ts)

Service Layer (TypeScript)
├── Database access (database.ts — Tauri adapter + in-memory fallback)
├── Business logic (petService, geneService, comparisonService, etc.)
└── Utilities (parsing, analysis, configuration)

Tauri Backend (Rust — minimal)
└── Plugin registration (sql, dialog, fs, updater, process)

SQLite Database (gorgonetics.db)
└── Tables: genes, pets, pet_images, pet_tags, settings
```

## Key Data Flows

1. **App startup:** AuthWrapper → `initDatabase()` → `runMigrations()` → `populateGenesIfNeeded()` → `loadDemoPetsIfNeeded()` → `settingsActions.load()`
2. **Pet upload:** File dialog (Tauri) → genome text parsing → SHA-256 content hash → DB insert
3. **Gene visualization:** Select species/chromosome → load gene effects (cached) → render interactive color-coded grid
4. **Pet comparison:** Select two pets → load genomes in parallel (`Promise.all`) → compute attribute diffs + gene stats → side-by-side render
5. **Export/import:** Select options → ZIP archive (JSZip) → file save dialog; imports support `replace` or `merge` mode with dedup by content_hash

## Database Access Pattern

- **Adapter interface:** `DatabaseAdapter` with `TauriDatabaseAdapter` (production) and `InMemoryDatabase` (tests)
- **Named parameters:** All queries use `$name` syntax — adapter converts to positional `?` for SQLite
- **Singleton:** `getDb()` returns the initialized adapter; `initDatabase()` called once in AuthWrapper
- **Auto-detection:** `isTauri()` check selects the adapter — no config needed

## State Management

- **Svelte stores:** Writable stores for `pets`, `selectedPet`, `loading`, `error`, `activeTab`
- **Derived stores:** `allTags` computed from pets array
- **Centralized actions:** `appState` object (loadPets, deletePet, uploadPet, etc.)
- **Component-level:** Svelte 5 runes (`$props()`, `$state()`, `$derived()`, `$effect()`)

## Master-Detail Layout

- **MasterPanel** (left, 260px): PetList or GeneEditor based on active tab
- **DetailPane** (right, flex): PetVisualization or GeneEditingView based on selection
- Navigation driven by store state: `selectedPet`, `geneEditingView`, `activeTab`
