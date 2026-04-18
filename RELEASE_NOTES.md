# v0.4.0

A release focused on pet-to-pet comparison: pick any two same-species pets and see exactly where they differ.

## Pet Comparison

A new **Compare** tab lets you put two pets of the same species head-to-head across three views:

- **Attributes** — side-by-side attribute totals with the winner highlighted per row
- **Gene Stats** — positive/negative gene counts per attribute for both pets
- **Genome Diff** — the full gene grid for both pets aligned by position, with differences highlighted

Pick pets from the sidebar picker or enter **compare mode** from the pet list and tick two checkboxes. The Genome Diff view has a **Differences only** filter that collapses the grid to just the rows where the pets disagree — useful for spotting which chromosomes drive the gap between a breeding pair. Click a chromosome label to focus, Ctrl-click to multi-select, Alt-click to hide.

## Appearance View in Comparison

The Genome Diff grid has its own **Attributes / Appearance** toggle that mirrors the single-pet viewer:

- **Attributes** colours genes by effect direction (positive/negative/neutral/potential)
- **Appearance** colours each gene by the trait category it controls — body hue, wing scale, coat, aura, markings, etc.

Each view has its own filter bar, shown only when that view is active, so filters from an inactive view can't silently affect the grid.

## Breed Filter Fix

Manual breed filter buttons were stuck disabled when neither pet had a breed recognised in the known-breeds list (e.g., "Mixed" horses). The Auto toggle hides in that case, which left nothing clickable. Manual breed buttons are now only locked out when auto-breed is actually in effect.

## Under the Hood

- Shared gene analysis helpers — `effectFor`, `breedFor`, `isNoEffect`, `parseGenesByBlock` — extracted into `geneAnalysis.ts` and consumed by both the single-pet viewer and the comparison grid, eliminating duplicated parsing logic (closes #129)
- Downloads section on the project page is now populated from the GitHub releases API at runtime, so download links automatically track the latest release
- Dynamic-stylesheet filter implementation extended to the appearance-category filter, keeping the grid fast even with many genes
- CI pinned to pnpm v10 with esbuild build scripts approved; switched pnpm/action-setup to a version that honours the pinned major
- Dependency refresh: Svelte, SvelteKit, Biome, Lucide, jsdom, and GitHub Actions runners
