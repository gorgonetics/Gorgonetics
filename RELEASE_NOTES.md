# v0.6.3

Hotfix release. v0.6.1 shipped corrected horse gene effects and v0.6.2 shipped the auto-refresh that should have propagated them — but neither actually reached the bundled application because Tauri bundles assets from `src-tauri/resources/assets/`, not from the top-level `assets/` directory where the corrections were applied. The two directories had been silently drifting since the project's Tauri migration.

This release re-syncs the bundled asset directory from the canonical source. After upgrading, v0.6.2's auto-refresh will pick up the corrected templates on first launch and the gene editor (and every downstream view) will finally show the right effects.

If you've been running v0.6.2 with the wrong effects, simply install v0.6.3 — no manual intervention needed. The hash-gated refresh in v0.6.2 will detect the new bundle and re-sync your local catalog automatically; your gene notes are preserved across the refresh, and pet `Total +` counts are recomputed in the background to reflect the corrected effects.

## What's actually fixed

The 58 horse + beewasp template JSONs in `src-tauri/resources/assets/` now match the corrected versions in `assets/`. Concretely, all the gene-effect corrections from #214 (chr15, chr16, chr20, chr22, chr24, chr42) and the field-order normalization from #215 are now in the bundle.

A follow-up issue (#222) tracks the structural fix to eliminate the duplication so future asset edits can't regress this way.
