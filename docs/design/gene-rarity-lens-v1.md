# Gene Rarity Lens — v1 Design

**Status:** Proposed — not yet implemented. For review.
**Issue:** #368 (Gene frequency analysis + rare/high-value gene identification).
**Related:** #369 (advanced gene-value filtering — future "what's beneficial to me" lens), #367 (wild-horse analysis — future consumer), #433/#434 (in-memory `IN` adapter fix — prerequisite for the per-species query to work in dev/tests; already separate).

---

## 1. Goal

Help a player decide **which pets to keep and which to release** by making gene *rarity* visible on a pet's genome. The core question is not "what is the rarest gene?" (a list nobody asks for) but "**does _this_ pet carry rare genes worth keeping?**" — which is a property of the pet's genome, so the answer belongs *on the genome grid*, not in a separate table.

A gene value is worth keeping when it is **both rare and desirable**. v1 delivers the *rare* signal directly (shading by rarity) and leaves "desirable" to the player's judgement; a later phase lets the player define "desirable" via the advanced filter (#369) and combine the two.

## 2. Core concept: what "rarity" measures

Rarity is a property of an **allele**, not of a gene and not of a displayed zygosity state.

The grid displays three known states per locus — `D` dominant, `R` recessive, `x` mixed (plus `?`). But `x` is not a third value: it is **one copy of each allele**, produced by breeding a `D` with an `R`. Nobody targets `x` — a player clarifies it toward whichever pure state yields the desired effect. Counting `D`/`R`/`x` as three peer values makes `x` a confound that misreads the population in both directions. Across 22 horses at one locus:

| population | genotype counting says | reality |
|---|---|---|
| 20 `x`, 2 `D` | `x` = 91% *common*; `R` = 0%, **doesn't exist** | the R allele is in 20 pets; a pure recessive is one breeding step away |
| 1 `x`, 21 `D` | `x` = 4.5% *rare* | true but buries the point: that pet is the **sole carrier** of R in the whole stock |

So v1 counts **alleles**. Every pet with a known reading at `L` contributes two: `D`→(D,D), `R`→(R,R), `x`→(D,R).

```
frequency(L, a) = count_P(allele a at L) / (2 × count_P(value at L is known))     a ∈ {D, R}
```

The two cases above now read 45% (common) and 2.3% (very rare) — both correct, and in the second case the mixed pet is the cell that lights up.

Key rules:

- **`Unknown` (`?`) is missing data, never a value.** In Project Gorgon a locus reads `?` only because the player's Genetics skill hasn't revealed it yet — uniformly across the whole collection, and biased toward loci that unlock at the highest skill levels. Counting `?` would make late-unlock loci look artificially rare. So `?` contributes **no alleles and no denominator**, and a pet's own `?` cell has no rarity signal. See the `project-genetics-skill-unknown-genes` note.
- **Complementarity.** At any locus `p_D + p_R = 1`. This is not a detail — it means the whole lens is driven by **one scalar per locus**, and it bounds what a cell can show: at most one allele at a locus can sit below 50%, so a mixed cell can never have both halves rare. §5 exploits this to store a single count per locus.
- **Minimum sample.** A locus with fewer than `minKnown` **alleles** has no meaningful rare/common distinction. Default **4** (= 2 pets with a known reading); such loci render as "missing data", same as `?`. `minKnown` only suppresses the *degenerate* case; it is **not** where the ramp becomes informative. With self-inclusion, a pure pet contributes 2 of its locus's alleles, so at 2 pets its own allele is ≥50% → always "common". The ramp gets meaningful around ~5+ pets of a species (see §7) — sooner than genotype counting allowed, because the allele denominator is twice as large and a singleton allele reads at half the frequency.
- **Species-scoped.** Gene ids are only comparable within a species, so a baseline is always computed for one species (the pet's).
- **Self-inclusion.** The pet being viewed is part of its own population (if it qualifies for the tier). Decision: **include it.** The figure then reads naturally as "N of M alleles in my pets, this one's included". Excluding self is marginally more precise for tiny collections but confusing to explain and negligible at realistic sizes. Documented so a future change is a conscious one.

### Why mixed matters more than it looks: `x` expresses dominant

`getPetGeneStats` / `breedingGenetics.ts` treat `x` as dominant for effect purposes (`GeneTooltip` labels it "Mixed (treated as dominant)"). So a pure-`D` pet and an `x` pet are **phenotypically identical** — every other view in the app renders them the same way, and a recessive allele hiding in an `x` pet is invisible everywhere else.

That makes the recessive arm of this lens the only surface in the app that answers "which of these identical-looking horses is worth keeping?", and it is the direct argument for the two-tone mixed cell below: without it, the sole carrier of a scarce recessive allele looks exactly like the 21 pets that carry none.

### Rarity → shading (diverging, not sequential)

Each arm is bucketed into 5 ordinal levels and rendered on a **diverging ramp with a shared neutral centre**: common is the *same* recessive shade on both arms, and colour diverges by hue as the allele gets scarcer. Warm = a scarce **dominant** allele, cool = a scarce **recessive** allele.

```
  very rare R   rare R   notable R   uncommon R  ←  COMMON  →  uncommon D  notable D  rare D  very rare D
     cool  ◄─────────────────────────────────────  neutral  ─────────────────────────────────────►  warm
```

| bucket | allele frequency | label |
|---|---|---|
| 0 | ≥ 0.35 | common (shared neutral centre) |
| 1 | 0.18–0.35 | uncommon |
| 2 | 0.07–0.18 | notable |
| 3 | 0.02–0.07 | rare |
| 4 | < 0.02 | very rare |

Boundaries are roughly the old genotype thresholds halved (a singleton allele reads at half its genotype frequency). They are a **starting point to calibrate against a histogram of a real collection**, not a derived result.

Consequences of the shared centre, all intended:

- **Common recedes to nothing.** A locus where the pet carries the abundant allele renders as flat neutral — the grid only lights up where something is scarce.
- **A mixed cell with two common halves renders flat**, losing the visual split. Accepted: an all-common `x` locus is precisely the "nothing to see here" case. The mixed **border** treatment is retained so zygosity is still readable at rest.
- **Near-balanced loci (0.35 < p < 0.65) show a gentle two-tone**, warm against cool — which reads correctly as "this locus is a coin-flip in my stock".
- **The mixed cell's two halves are complements**, so the second tone is strictly redundant given the first. It is kept anyway because it is what makes the cell read as *"you are carrying a scarce allele in unresolved form, and here is which way to clarify"* rather than *"you are a rare pet"*.

**Hue choice.** The §4 base-class change means the rarity view **replaces** the attribute/appearance palette rather than sitting alongside it, so there is no simultaneous collision to avoid — which is fortunate, since the appearance view already spans nearly the entire hue wheel (`geneCell.css`) and "a hue nothing else uses" does not exist. The real constraints are: (a) **not green↔red**, which would import the attribute view's good/bad reading onto a scale that has no valence; (b) **colour-vision-safe**, since hue is what separates the two arms; (c) **theme-adaptive**. **Orange ↔ blue** satisfies all three (it is the standard CVD-safe diverging pair; purple↔green is the other, and loses on constraint (a)). The centre and both arms are built by `color-mix` from a surface-relative neutral token so light/dark adapt without two hardcoded palettes; the missing-data style stays **dashed**, which is what keeps it distinct from the solid neutral of bucket 0.

Zygosity shape is preserved throughout (see §4): dominant fills, recessive keeps its thick border, mixed its diagonal split. Hue redundantly encodes which allele a pure cell carries — reinforcing, and non-redundant on mixed cells, where it is the only thing distinguishing the two halves.

## 3. Population tiers

One feature, a widening denominator. Same computation at each tier; only `P` grows.

| Tier | Population | Cost | v1? |
|---|---|---|---|
| **Stabled** (default) | Pets with the `stabled` marker set | Local SQLite, instant | ✅ |
| **All my pets** | Every pet in the local DB (`getAllPets()`) | Local SQLite, instant | ✅ |
| **Community** | The shared catalogue | See below | ❌ deferred |

The two local tiers map to existing state: **Stabled** = the `stabled` boolean marker (`MarkerKey` in `stores/pets.ts`); **All my pets** = the full `getAllPets()` set. The app has **no "released" pet state** — a pet is either in the local DB or it isn't — so "All my pets" is simply "not filtered to the stabled subset", not a superset that adds released animals.

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
Cells already carry `data-gene-id`. Within one pet's grid each locus renders exactly one cell, so `data-gene-id` is unique per cell; and because the pet carries exactly one *state* at each locus, the gene id alone identifies both the locus **and** which allele(s) are being scored — the value never needs to appear in the selector. Activating the lens:

1. Toggle a `view-rarity` class on the grid container (`.gene-grid-container`), and render the cell with a **neutral base class** in this view (see "base-class" note below).
2. Emit **two independent partitions** over the current pet's `data-gene-id`s, one per allele arm:
   - `--rarity-dom` — over cells whose state is `D` **or** `x`, bucketed on `p_D`, warm arm.
   - `--rarity-rec` — over cells whose state is `R` **or** `x`, bucketed on `p_R`, cool arm.

   Five buckets each, so **10 rules**, not 25 — the arms are independent so they never need to be crossed. Bucket 0 resolves to the same neutral token on both arms (the shared centre).
   ```css
   .view-rarity.gene-grid-container .gene-cell[data-gene-id="01A4"],
   .view-rarity.gene-grid-container .gene-cell[data-gene-id="02B1"] { --rarity-rec: <coolArm[b]>; }
   ```
   Mixed cells appear in one rule of each partition and so receive both properties; pure cells receive only their own arm's.
3. Plus a **missing-data** rule (gene ids whose state is `?`, or whose locus is below `minKnown`), setting the dashed/neutral look directly. This set is listed **explicitly** — it is the complement of the union of the buckets. It cannot be selected with `:not([style*="--rarity-dom"])`, because the property is applied by this injected stylesheet, **not** by an inline `style` attribute, so an attribute-substring match on `style` would never fire. (`?` cells already carry `gene-unknown`, whose dashed style coincidentally matches; below-`minKnown` cells do not, which is exactly why the explicit list is required.)
4. Static CSS (in `geneCell.css`, gated by `.view-rarity`) applies the properties with the correct **zygosity shape**:
   ```css
   .view-rarity .gene-cell[data-zygosity="dominant"]  { background: var(--rarity-dom); border-color: var(--rarity-dom); }
   .view-rarity .gene-cell[data-zygosity="recessive"] { /* tinted fill + 4px border, from --rarity-rec */ }
   .view-rarity .gene-cell[data-zygosity="mixed"] {
     background: linear-gradient(135deg, var(--rarity-rec) 50%, var(--rarity-dom) 50%);
     /* border retained so the split stays legible when both halves are the neutral centre */
   }
   .view-rarity .gene-cell.gene-rarity-missing        { /* dashed neutral */ }
   ```
   The mixed gradient keeps the existing `135deg` orientation from `geneCell.css`, with **dominant in the lower-right half** — the half that is filled in the attribute/appearance views, so the established visual habit ("the filled half is the expressed one") carries over, which is exactly right given `x` expresses dominant.

**Base-class note (required, not optional).** The grid's cell binding is `class={currentView === "appearance" ? cell.appearanceCls : cell.attributeCls}` — so in **any** non-appearance view, including rarity, a cell would otherwise carry `attributeCls` and paint itself with the attribute-view effect colours. Worse, wrong-breed cells carry `gene-inactive-breed`, whose grey fill/border use `!important` (`geneCell.css`) and would defeat a plain `.view-rarity` rule. So the binding must become a **three-way** choice: in rarity view the cell renders a neutral base (`gene-cell` + the zygosity class only, no effect/appearance/inactive-breed colour class), and `.view-rarity` supplies the rarity colour on top. This is the one render-template change Approach B needs; it touches the class expression only, not `VisCell`, `buildGrid`, or any sizing/layout code.

**Why B is right:** it is **rebuild-free and layout-free by construction.** No `VisCell` changes, no `buildGrid` call, and — critically — **no change to cell sizing, the `ResizeObserver`, pane flex, or any existing layout CSS.** Verified against the code: the table is wrapped in `{#key headerStructure}`, which only re-keys on a pet load/rebuild, never on a view toggle; and `cellSize` derives solely from `gridContainerWidth` and `totalGeneColumns`, neither of which changes when `currentView` flips. So the grid is byte-for-byte the same size and position across all three views. Population changes and the async baseline load just regenerate the rarity stylesheet — never the grid.

> **Explicit non-goal (hard-won):** v1 must not touch grid cell sizing, responsive behavior, the pane's flex layout, or any existing grid CSS. The only new CSS is scoped behind `.view-rarity`. If the lens appears to require a layout change, that is a signal the approach is wrong, not that the layout needs fixing.

## 5. Data flow

```
PetVisualization
  ├─ owns: currentView button state, rarityPopulation ('stabled' | 'all')
  ├─ derives populationPets from the pets store by the toggle
  └─ passes populationPets + rarityPopulation into GeneVisualizer

GeneVisualizer (rarity view active)
  ├─ owns the render-driving currentView (widened to include 'rarity')
  ├─ lazy-loads a RarityLookup for (pet.species, populationPets), seq-guarded
  ├─ regenerates its own injected rarity stylesheet from the lookup + rendered cells
  └─ toggles `.view-rarity` on the grid container

frequencyService.computeRarityLookup(pets, species, {minKnown})
  ├─ filter pets to species → petIds
  ├─ loadAllPetLoci(petIds)              // bulk read of pet_genes, one query
  ├─ computeLocusFrequencies(loci)       // pure; excludes '?'
  └─ → get(geneId) / bucketOf(geneId, allele)

geneFrequency (pure, no DB)
  ├─ computeLocusFrequencies(Map<petId, Map<geneId, GeneType>>)
  │     → per-locus { knownPets, dominantAlleles, pureD, pureR, mixed }
  │       // D → +2 dominantAlleles, x → +1, R → +0; '?' contributes nothing
  ├─ p_D = dominantAlleles / (2 × knownPets);  p_R = 1 − p_D
  └─ rarityBucket(frequency) → 0..RARITY_LEVELS-1
```

**One number per locus.** Because `p_D + p_R = 1` (§2), the store is a single count — `dominantAlleles` over `2 × knownPets` — and the recessive arm derives. The extra tallies (`pureD`/`pureR`/`mixed`) exist only to render the tooltip's carrier breakdown, not the colour.

- **`loadAllPetLoci`** (existing, `utils/petLoci.ts`) already does the bulk `pet_genes` read for a set of ids in one query — reused as-is. This is the query that needs the in-memory `IN` fix (#433) to be correct in dev/tests.
- **Lazy + cached:** the baseline is computed only when the lens is first opened, keyed by `(species, population-id-set)`; re-used until that key changes. A background reload of the pet list that returns the same ids must not recompute (key on the id set, not array identity).
- **Loading state:** while the baseline loads, cells show the "missing data" style and the legend shows "Analysing…"; then the stylesheet fills in. This uses a **dedicated** loading flag, **not** the component's `loading` state — `loading` swaps the entire grid for a full-pane `StatusPane`, so reusing it would blank the grid on every population-toggle change.
- **`currentView` widens in two places.** `GeneVisualizer` holds the render-driving `currentView` (`'attribute' | 'appearance'` today) and its exported `handleViewChange` **coerces any non-`'appearance'` value to `'attribute'`** — that coercion must learn `'rarity'` or the button silently no-ops. `PetVisualization` / `CommunityPetVisualization` keep a parallel `currentView` string for button state only. Enumerate this sync as a concrete edit; it is a likely stumbling point.
- **Separate `<style>` element.** The filter sheet is one `<style id="gene-visualizer-filters">` on the component's `onMount`/`onDestroy` lifecycle. Rarity gets its **own** `<style id="gene-visualizer-rarity">` on the same lifecycle — do not overload the filter sheet.

## 6. UI

- **View control:** add a `Rarity` button to the existing Attributes/Appearance group in `PetVisualization`.
- **Population toggle:** a segmented `Stabled | All my pets` control, shown only in the rarity view, plus a disabled `Community · soon`.
- **Legend:** replaces the attribute/appearance legend in the rarity view — a **diverging bar** (`rare recessive ← common → rare dominant`) + the "missing data" swatch + "across N pets" (baseline size). The diverging bar is doing real teaching work here: it communicates the whole model — two arms, a shared common centre, hue = which allele — in one glance, which a one-way ramp could not. Non-interactive in v1.
- **Stats drawer:** attribute/appearance-specific; hidden in the rarity view. (Optionally a per-bucket count summary later.)
- **Tooltip (proposed for v1):** on hover in the rarity view, show the allele figure **plus** the human-legible carrier breakdown, e.g. *"Recessive — 3 of 44 alleles (7%) across 22 stabled Horses: 1 pure, 1 mixed carrier."* Allele frequency drives the colour; carrier counts are what a player actually reasons with when planning a pairing. For a mixed cell, show **both** arms, since the point of the cell is the contrast. Optionally a third line for the locus's unresolved share (*"9 of 22 still mixed here"*) — that is a fact about the stock, not about the allele's rarity, so it must not influence the colour.

  The data is cheap (the lookup holds it), but the *code* is not free: `showTooltipForCell` is hardwired to the attribute/appearance content (it reads `data-effect` / `data-appearance-effect`, computes potential-effect lines, and sizes the tooltip from effect-specific heights). Rarity needs a **third content branch** there. `GeneTooltip` already exposes `subtitle` and `effectsLabel` props, so it can render the rarity lines without new markup — but the branch in `showTooltipForCell` is real scope, not a freebie. Falls back to "not enough data" for missing-data cells.

## 7. Edge cases

- **Community pet preview** (`CommunityPetVisualization`) renders via `gridOverride` and has no `pet_genes` rows or a local population — the Rarity button is **not** exposed there. Local pets only.
- **Breed-inactive genes** (horse, wrong-breed loci): rarity coloring applies to any known-value cell; the existing breed row-hide is orthogonal and unchanged. But note the whole-chromosome row-hide is *not* the same as the per-cell `gene-inactive-breed` styling — individual wrong-breed cells survive on visible rows and carry `!important` grey. The §4 base-class change (neutral base in rarity view, no `gene-inactive-breed`) is what lets the rarity colour show on those cells; without it they stay grey.
- **Existing filters in the rarity view:** the attribute/effect legend filters don't map to rarity; v1 simply shows the rarity legend instead and leaves those filters inactive in this view. (Composing rarity with #369's gene-value filter is a later phase.)
- **Tiny populations:** with only a handful of pets, most alleles sit near the neutral centre (a pure pet's own allele is ≥50% at a 2-pet baseline), so the grid is nearly colourless. This is correct, not a bug — you cannot have a rare allele in a 2-pet baseline. The "across N pets" label sets the expectation; the scale becomes meaningful around ~5+ pets of a species.
- **Monomorphic loci:** if every pet in the baseline carries the same pure state, one arm is at 1.0 and the other at 0.0 — but the 0.0 arm is only reachable by a cell that carries that allele, and no such cell exists in the population. So an absent allele never renders; there is no "0%" bucket to design for. The only cell that can *hold* a bucket-4 allele is, by construction, a carrier of it — which is the whole point of the lens.

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

- **Pure unit** (`geneFrequency`): allele tallies (`D`→2, `x`→1, `R`→0); `?` excluded from numerator **and** denominator; `2 × knownPets` denominator; **`p_D + p_R === 1` as a property test over random populations**; the two §2 worked examples (20`x`+2`D` → p_R ≈ 0.45; 1`x`+21`D` → p_R ≈ 0.023) as explicit regression cases against genotype counting; all-unknown locus; missing locus (no synthetic fill); `rarityBucket` boundaries + monotonicity.
- **Service** (`computeRarityLookup`): species isolation (a mixed-species population yields only the requested species; the demo's beewasp must not leak into a horse baseline — the bug that motivated #433), `minKnown` gating in **alleles**.
- **Component/e2e:** the Rarity view button toggles the lens; a `D` cell gets only `--rarity-dom`, an `R` cell only `--rarity-rec`, an `x` cell **both**; missing-data cells get the dashed style; the population toggle recomputes; **the grid dimensions are identical across Attributes/Appearance/Rarity** (regression guard for the reverted layout churn); Rarity is absent on the community preview.
- **The scenario the feature exists for:** a baseline where one `x` pet is the sole carrier of a scarce recessive among otherwise-`D` pets — assert that pet's cell lands in the rarest recessive bucket while the phenotypically identical pure-`D` pets stay at the neutral centre. This is the case no other view in the app can distinguish (§2).

## 10. Open questions for review

**Settled** (recorded here so the reasoning isn't relitigated): rarity is measured per **allele**, not per displayed genotype — `x` is one of each, not a third value (§2). Mixed cells render **two-tone** on a **diverging** scale with a shared common centre (§2, §4). The viewed pet **is** included in its own denominator.

Still open:

1. **Bucket count & thresholds** — 5 levels per arm with the table in §2, or coarser (3: common/uncommon/rare)? The listed boundaries are a halving of the old genotype numbers and want calibrating against a real collection's histogram before they are treated as settled.
2. **Arm hues** — orange ↔ blue is the recommendation (CVD-safe, avoids the attribute view's green/red valence). Confirm, or state a theme preference. Which arm gets which hue is arbitrary; the proposal is warm = dominant.
3. **Tooltip in v1** — include the allele figure + carrier breakdown on hover (recommended), or ship shading-only first?
4. **Default population** — Stabled (recommended) or All my pets?
5. **Mixed-share line** — worth surfacing "9 of 22 still unresolved at this locus" in the tooltip, or noise?
