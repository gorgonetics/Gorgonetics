# v0.5.0

A release aimed at making large pet collections tractable: mark and filter pets individually, resize the sidebar to taste, and get a dedicated table view that lines every stabled pet up side by side.

## Pet Markers

Three new per-pet flags live as inline icon toggles on every pet card:

- **Starred (⭐)** — favourites. Hollow star off, filled amber on.
- **Stabled (🏠)** — currently in your stables. New uploads default to stabled; the pet list defaults to **Stabled only** so users upgrading a populated database don't see an empty view.
- **Pet quality (🐾)** — not usable for breeding. Shows as a badge on the card; reserved for future breeding sims to automatically exclude.

Markers are togglable from the card directly or from the pet editor (which now uses the same icon language instead of checkboxes). The pet list gets two new filter pills — **Starred** and **Stabled** — that match the existing tag-filter style.

## Collapsible, Resizable Sidebar

The master panel can now flex to the work at hand:

- A collapse chevron hides the sidebar to a thin rail; click to expand again.
- A drag handle on the right edge resizes it between 200 and 560 px.
- Keyboard: arrow keys on the handle resize in 8/32 px steps.
- Width and collapsed state persist to localStorage (per-device; not part of backups or settings sync).

## Stable Table

A new **Stable** tab renders every stabled pet of the selected species as a compact table. Columns cover every attribute plus a running **Total** and a new **+Genes** score — the count of confirmed positive-effect genes, computed once at upload and persisted on the pet row.

Filters along the top of the table:

- Name search
- Gender (All / Male / Female) — useful for breeding-pair selection
- Breed (per-species — Horse breeds or Bee/Wasp)
- Starred, Pet-quality, and Tag pills

Each row has view / edit / compare actions; a **Compare now** button appears in the header once two pets are selected and switches straight to the Compare tab. The entire view state (selected species, sort column and direction, every filter) persists across tab switches for the session.

## Under the Hood

- New `positive_genes` column on pets (migration v9) with a one-shot JS-side backfill at startup guarded by a settings flag. Upload and update paths compute the count via the shared `computeGeneStats` helper, keeping it in sync with the Stats panel total.
- Extracted `genomeToGeneStrings` into `genomeParser.ts`; `getPetGenome` and the new stable-table upload path both reuse it, killing a duplicated loop.
- `computePositiveGenesForGenome` is defensive — malformed `genome_data` returns 0 rather than throwing, so uploads and startup backfill stay resilient.
- Sidebar resize batches mousemove through rAF and short-circuits no-op width writes; marker toggles also skip redundant persists when the value is unchanged.
- Dependency refresh: Biome 2.4.12, Vite 8.0.9.
