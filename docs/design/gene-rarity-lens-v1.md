# Gene Rarity Lens — v1 Design

**Status:** Proposed — not yet implemented. For review.
**Issue:** #368 (Gene frequency analysis + rare/high-value gene identification).
**Related:** #369 (advanced gene-value filtering — future "what's beneficial to me" lens), #367 (wild-horse analysis — future consumer), #433/#434 (in-memory `IN` adapter fix — prerequisite for the per-species query to work in dev/tests; already separate).

---

## 1. Goal

Help a player decide **which pets to keep and which to release** by making gene *rarity* visible on a pet's genome. The core question is not "what is the rarest gene?" (a list nobody asks for) but "**does _this_ pet carry rare genes worth keeping?**" — which is a property of the pet's genome, so the answer belongs *on the genome grid*, not in a separate table.

A gene value is worth keeping when it is **both rare and desirable**. v1 delivers the *rare* signal directly (shading by rarity) and leaves "desirable" to the player's judgement; a later phase lets the player define "desirable" via the advanced filter (#369) and combine the two.

## 2. Core concept: what "rarity" measures

For a pet, at each locus `L`, the pet carries one revealed value `v ∈ {Dominant, Recessive, Mixed}` (or `Unknown`). The **rarity of that value** is how uncommon it is across a chosen population `P` of the same species:

```
frequency(L, v) = count_P(value at L == v) / count_P(value at L is known)
```

Key rules:

- **`Unknown` (`?`) is missing data, never a value.** In Project Gorgon a locus reads `?` only because the player's Genetics skill hasn't revealed it yet — uniformly across the whole collection, and biased toward loci that unlock at the highest skill levels. Counting `?` would make late-unlock loci look artificially rare. So `?` is excluded from **both** the numerator and the denominator (a *known-value* denominator), and a pet's own `?` cell has no rarity signal. See the `project-genetics-skill-unknown-genes` note.
- **Minimum sample.** A locus with fewer than `minKnown` revealed readings (default **2**) has no meaningful "rare vs common" distinction — with one reading every value is trivially 100%. Such loci render as "missing data", same as `?`.
- **Species-scoped.** Gene ids are only comparable within a species, so a baseline is always computed for one species (the pet's).
- **Self-inclusion.** The pet being viewed is part of its own population (if it qualifies for the tier). Decision: **include it.** The figure then reads naturally as "N of M of my pets carry this (this one included)". Excluding self ("how rare among my *other* pets") is marginally more precise for tiny collections but confusing to explain and negligible at realistic sizes. Documented so a future change is a conscious one.

### Rarity → shading

Frequency is bucketed into a small ordinal scale (proposed **5 levels**, common→rarest) and each cell is shaded on a sequential ramp: **common recedes, rare pops**. Proposed thresholds:

| bucket | frequency | label |
|---|---|---|
| 0 | ≥ 0.50 | common |
| 1 | 0.25–0.50 | uncommon |
| 2 | 0.10–0.25 | notable |
| 3 | 0.03–0.10 | rare |
| 4 | < 0.03 | very rare |

The ramp must be a **single hue distinct from the existing palettes** (attribute view uses green/red for +/- effect; appearance view uses category colors), so "rare" is never confused with "good/bad" or an appearance category. A violet/purple sequential ramp is the working proposal. Zygosity shape is preserved (see §4): recessive keeps its thick border, mixed its diagonal split — only the *color* encodes rarity.

## 3. Population tiers

One feature, a widening denominator. Same computation at each tier; only `P` grows.

| Tier | Population | Cost | v1? |
|---|---|---|---|
| **Stabled** (default) | Pets currently stabled | Local SQLite, instant | ✅ |
| **All my pets** | Every local pet on record (incl. released) | Local SQLite, instant | ✅ |
| **Community** | The shared catalogue | See below | ❌ deferred |

**Why community is deferred.** The catalogue is split so the list path is cheap: `/pets/{hash}` holds metadata only, `/genomes/{hash}` holds the genome blob (see `public-pet-sharing-v1.md`). `listPets()` never fetches genomes. A community baseline would require fetching *every* genome doc to tally per-locus values — hundreds of reads against the Firestore Spark free quota (50k reads/day), repeated as the catalogue grows. It needs either a precomputed server-side aggregate or an aggressively cached client tally, which is its own design. Out of scope for v1; the population selector will show a disabled "Community · soon" affordance so the tiering is legible.

## 4. Where it lives, and how it renders (the critical decision)

The lens is a **third view on the pet genome grid** (`GeneVisualizer`), alongside **Attributes** and **Appearance**, selected from the existing view control in `PetVisualization`.

### How the grid works today (constraints we must respect)

`GeneVisualizer` is performance-tuned:

- It builds each cell **once** per pet load (`buildGrid` → `VisCell[]`), baking the attribute-view and appearance-view color classes *and* a set of `data-*` attributes (`data-gene-id`, `data-gene-type`, `data-zygosity`, `data-attrs`, …) onto every cell div.
- Switching **Attributes ↔ Appearance is a pure CSS class swap** driven by `currentView` — no rebuild, no re-render of ~1500+ cells.
- **Filtering** (dim/hide by attribute/effect/value/chromosome/breed) is done entirely by an **injected stylesheet** (`buildVisualizerFilterCSS`), regenerated by a reactive `$effect` and written into a single `<style>` element. Cells never re-render on a filter change; only the stylesheet text changes, matching cells by their `data-*` attributes.
- Cell **size** is responsive: `computeGeneCellSize(containerWidth, …)` + a `ResizeObserver` scale cells to the container. The container width is content-driven through the layout, which makes the effective width a fixed point of a feedback loop.

### Two ways to add rarity coloring

**Approach A — bake a `rarityCls` per cell (like `attributeCls`/`appearanceCls`).**
Rejected. The rarity value depends on an **async, population-dependent** lookup (loaded from the DB, changes with the Stabled/All toggle), so the class can't be baked at initial build without either eagerly loading the whole-population baseline on *every* pet open (wasteful) or **rebuilding the grid** when the lookup arrives / the population changes. Rebuilding re-enters the cell-size feedback loop and can settle the grid at a *different* width than the other views — this is exactly the regression that derailed the first attempt (a rebuild on view-switch made the grid resize, and every attempted layout patch made it worse). Coupling rarity to the build cycle is the trap.

**Approach B — inject a rarity stylesheet (the same mechanism filters already use). ✅ Chosen.**
Cells already carry `data-gene-id` (unique per cell — one allele per locus per pet). Activating the lens:

1. Toggle a `view-rarity` class on the grid container.
2. Generate a small stylesheet from the rarity lookup: **one rule per bucket**, whose selector lists every `data-gene-id` in that bucket and sets a CSS custom property:
   ```css
   .view-rarity .gene-cell[data-gene-id="01A4"],
   .view-rarity .gene-cell[data-gene-id="02B1"] { --rarity-color: <ramp[b]>; }
   ```
3. Static CSS (in `geneCell.css`, gated by `.view-rarity`) applies that property with the correct **zygosity shape**, and a default "missing data" style (dashed, neutral) for cells that got no `--rarity-color` (unknown `?` or below `minKnown`):
   ```css
   .view-rarity .gene-cell[data-zygosity="dominant"]  { background: var(--rarity-color, transparent); border-color: var(--rarity-color, …); }
   .view-rarity .gene-cell[data-zygosity="recessive"] { /* tinted fill + thick border, using --rarity-color */ }
   .view-rarity .gene-cell[data-zygosity="mixed"]     { /* diagonal split, using --rarity-color */ }
   .view-rarity .gene-cell:not([style*="--rarity-color"]) { /* dashed neutral */ }
   ```

**Why B is right:** it is **rebuild-free and layout-free by construction.** No `VisCell` changes, no `buildGrid` call, and — critically — **no change to cell sizing, the `ResizeObserver`, pane flex, or any existing layout CSS.** Switching to the rarity view is a class toggle plus a stylesheet swap, identical in spirit to toggling a filter. The grid is therefore byte-for-byte the same size and position across all three views. Population changes and the async baseline load just regenerate the stylesheet — never the grid.

> **Explicit non-goal (hard-won):** v1 must not touch grid cell sizing, responsive behavior, the pane's flex layout, or any existing grid CSS. The only new CSS is scoped behind `.view-rarity`. If the lens appears to require a layout change, that is a signal the approach is wrong, not that the layout needs fixing.

## 5. Data flow

```
PetVisualization
  ├─ owns: currentView ('attribute' | 'appearance' | 'rarity'), rarityPopulation ('stabled' | 'all')
  ├─ derives populationPets from the pets store by the toggle
  └─ passes populationPets + rarityPopulation into GeneVisualizer

GeneVisualizer (rarity view active)
  ├─ lazy-loads a RarityLookup for (pet.species, populationPets), seq-guarded
  ├─ regenerates the injected rarity stylesheet from the lookup + the rendered cells
  └─ toggles `.view-rarity` on the grid container

frequencyService.computeRarityLookup(pets, species, {minKnown})
  ├─ filter pets to species → petIds
  ├─ loadAllPetLoci(petIds)              // bulk read of pet_genes, one query
  ├─ computeLocusFrequencies(loci)       // pure; excludes '?'
  └─ → get(geneId, value) / bucketOf(geneId, value)

geneFrequency (pure, no DB)
  ├─ computeLocusFrequencies(Map<petId, Map<geneId, GeneType>>) → per-locus {known, unknown, values[{value,count,frequency,carriers}]}
  └─ rarityBucket(frequency) → 0..RARITY_LEVELS-1
```

- **`loadAllPetLoci`** (existing, `utils/petLoci.ts`) already does the bulk `pet_genes` read for a set of ids in one query — reused as-is. This is the query that needs the in-memory `IN` fix (#433) to be correct in dev/tests.
- **Lazy + cached:** the baseline is computed only when the lens is first opened, keyed by `(species, population-id-set)`; re-used until that key changes. A background reload of the pet list that returns the same ids must not recompute (key on the id set, not array identity).
- **Loading state:** while the baseline loads, cells show the "missing data" style and the legend shows "Analysing…"; then the stylesheet fills in.

## 6. UI

- **View control:** add a `Rarity` button to the existing Attributes/Appearance group in `PetVisualization`.
- **Population toggle:** a segmented `Stabled | All my pets` control, shown only in the rarity view, plus a disabled `Community · soon`.
- **Legend:** replaces the attribute/appearance legend in the rarity view — the ramp (common → very rare) + the "missing data" swatch + "across N pets" (baseline size). Non-interactive in v1.
- **Stats drawer:** attribute/appearance-specific; hidden in the rarity view. (Optionally a per-bucket count summary later.)
- **Tooltip (proposed for v1):** on hover in the rarity view, show the concrete figure, e.g. *"Recessive — carried by 3 of 22 stabled Horses (14%)"*. Cheap (the lookup holds it) and it's what turns a color into a decision. Falls back to "not enough data" for missing-data cells.

## 7. Edge cases

- **Community pet preview** (`CommunityPetVisualization`) renders via `gridOverride` and has no `pet_genes` rows or a local population — the Rarity button is **not** exposed there. Local pets only.
- **Breed-inactive genes** (horse, wrong-breed loci): rarity coloring applies to any known-value cell; the existing breed row-hide is orthogonal and unchanged.
- **Existing filters in the rarity view:** the attribute/effect legend filters don't map to rarity; v1 simply shows the rarity legend instead and leaves those filters inactive in this view. (Composing rarity with #369's gene-value filter is a later phase.)
- **Tiny populations:** with only a handful of pets, most values fall in "common" (a present value is at least `1/known ≥ 50%` when `known=2`), so the ramp is nearly monochrome. This is correct, not a bug — you cannot have a rare value in a 2-pet baseline. The "across N pets" label sets the expectation; the ramp becomes meaningful around ~7+ pets of a species.

## 8. Scope

**v1 (this design):**
- Per-pet Rarity lens on the genome grid (Stabled + All my pets tiers).
- `geneFrequency` pure util, `frequencyService.computeRarityLookup`, injected rarity stylesheet in `GeneVisualizer`, controls + legend + tooltip in `PetVisualization`.

**Explicitly out of scope for v1:**
- Community tier (needs a cached/aggregated baseline — §3).
- A generic "all genes for a species, shaded by rarity" heatmap (exploratory map, no specific pet) — a plausible later companion surface, deferred.
- Integration with #369 (let the player define "beneficial" and combine rare×desirable).
- #367 wild-horse capture analysis (a downstream consumer of this baseline).
- Any change to grid sizing/layout (§4 non-goal).

## 9. Testing

- **Pure unit** (`geneFrequency`): value tallies, `?` excluded from numerator+denominator, `known` denominator, all-unknown locus, missing-locus (no synthetic fill), `rarityBucket` boundaries + monotonicity.
- **Service** (`computeRarityLookup`): species isolation (a mixed-species population yields only the requested species; the demo's beewasp must not leak into a horse baseline — the bug that motivated #433), `minKnown` gating.
- **Component/e2e:** the Rarity view button toggles the lens; cells receive a bucket color or the missing-data style; the population toggle recomputes; **the grid dimensions are identical across Attributes/Appearance/Rarity** (regression guard for the reverted layout churn); Rarity is absent on the community preview.

## 10. Open questions for review

1. **Bucket count & thresholds** — 5 levels with the table in §2? Or coarser (3: common/uncommon/rare)?
2. **Ramp hue** — a single sequential violet ramp (distinct from green/red effect + appearance colors)? Any brand/theme preference, and it must read in both light and dark themes.
3. **Tooltip in v1** — include the exact "N of M (x%)" figure on hover (recommended), or ship shading-only first?
4. **Self-inclusion** — include the viewed pet in its own denominator (recommended), or measure against *other* pets?
5. **Default population** — Stabled (recommended) or All my pets?
