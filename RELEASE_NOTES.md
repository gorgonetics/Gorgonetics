# v0.6.0

The headline feature is the **Breeding Assistant** — a new tab that ranks every stabled male × female pair by expected offspring quality. Plus an **auto-import** path that scans (and watches) your Project Gorgon game folder for new genome files, and a chunky perf refactor under the Compare tab.

## New: Breeding Assistant

A fifth top-bar tab — **💞 Breed** — opens the assistant. Pick a species, optionally restrict to an offspring breed (horses), and the table ranks every stabled M × F pair by expected offspring quality, computed from the parents' Mendelian gene contributions.

Columns:

- **Mixed** / **Unknown** / **Total +** — expected counts of mixed-allele, unknown-effect, and confirmed-positive offspring genes.
- **Per-attribute totals** — expected positive-gene count broken down by attribute (Toughness, Intelligence, Ferocity for beewasps, Temperament for horses, etc.).
- Every column header sorts; click again to reverse direction. Default is **Total +** descending.
- Click a parent name to jump straight to that pet's gene grid.

Documented in the [quickstart guide](https://gorgonetics.github.io/Gorgonetics/quickstart.html#step-9). (#191, #192, #193, #194, #195)

## New: Auto-import from your game folder

Open **Settings → Auto-import** and point Gorgonetics at your Project Gorgon game folder. Then:

- The **🔄** button next to *+ Upload Genome* in the pet list scans the folder and imports every genome file you don't already have. Running totals update as it works.
- Once configured, the app also **watches the folder in the background** and auto-imports new files while it's running — no need to drag-and-drop after each in-game gene scan.

Files already in the database are de-duplicated by content hash, so re-running the scan is a safe no-op. (#183)

## Faster Compare tab

The genome diff used to re-parse `genome_data` JSON on every render. The diff and the grid now both read from the existing `pet_genes` projection, with a one-shot legacy-pet fallback for un-backfilled rows. Result: opening the Genome Diff view on two large pets is now a flat database read instead of a re-parse storm. (#198, #199)

## Cleaner internals

- **`buildInClauseParams` helper** centralises variable-arity `IN (...)` clauses with named placeholders, replacing hand-rolled `IN ($1, $2, ...)` strings across the database layer. (#200)
- **`setTagsForPet` is now atomic** — the previous implementation wrapped manual `BEGIN/COMMIT` calls that the Tauri adapter no-ops, so a failure mid-loop could leave `pet_tags` half-updated. Migrated to `db.transaction([...])` for true cross-statement atomicity and a single IPC round-trip. (#201)
- **`uploadPet` accepts an options object** instead of a positional argument grab-bag, making the call site readable. (#188)
- **Import path narrows the filesystem scope** to `BaseDirectory.Home`, so the Tauri capability isn't broader than it needs to be. (#189)
- **Text-input styles consolidated** into a single set of utility classes — `.text-input`, `.text-input--mono` — so future tweaks land in one place. (#187)
- **Auto-scan game folder for pet uploads** — the foundation for the auto-import feature above. (#183)
- **Svelte 5 compiler warnings cleared** across `MasterPanel`, `PetEditor`, and `GenomeGridDiff`; biome schema URL bumped to match the pinned CLI; six copies of error-message formatting collapsed into a single helper. (#201)

## Dependency bumps

- `@biomejs/biome` 2.4.12 → 2.4.13 (#179)
- `svelte` 5.55.4 → 5.55.5 (#178)
- `@lucide/svelte` 1.8.0 → 1.14.0 (#180)
- `jsdom` 29.0.2 → 29.1.0 (#181)
- `tokio` 1.50.0 → 1.52.1 (#182)
- `vite` 8.0.9 → 8.0.10 (#177)
- `actions/deploy-pages` 4 → 5 (#190)
