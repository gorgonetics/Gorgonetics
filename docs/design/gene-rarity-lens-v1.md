# Gene Rarity Lens — v1 Design

**Status:** Proposed — not yet implemented. For review.
**Issue:** #368 (Gene frequency analysis + rare/high-value gene identification).
**Related:** #369 (advanced gene-value filtering — future "what's beneficial to me" lens), #367 (wild-horse analysis — future consumer), #433/#434 (in-memory `IN` adapter fix — prerequisite for the per-species query to work in dev/tests; already separate).

---

## 1. Goal

Help a player decide **which pets to keep and which to release** by making gene *rarity* visible on a pet's genome. The core question is not "what is the rarest gene?" (a list nobody asks for) but "**does _this_ pet carry rare genes worth keeping?**" — which is a property of the pet's genome, so the answer belongs *on the genome grid*, not in a separate table.

An allele is worth keeping when it is **both rare and desirable**. v1 delivers the *rare* signal directly (shading by rarity) and leaves "desirable" to the player's judgement; a later phase lets the player define "desirable" via the advanced filter (#369) and combine the two.

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

The two cases above now read 45% (common) and 2.3% (rare, and a sole carrier) — both correct, and in the second case the mixed pet is the cell that lights up.

Key rules:

- **`Unknown` (`?`) is missing data, never a value.** A locus reads `?` because the owner's Genetics level had not revealed it **at the time that pet was studied**; higher-level breeds' genes reveal later. That is all `?` means. Counting it would make late-reveal loci look artificially rare, so `?` contributes **no alleles and no denominator**, and a pet's own `?` cell has no rarity signal. Measured on the community catalogue, 51 of 52 shared Horse genomes are complete — enough players are at max level that full genomes are the norm, so this is an edge case to handle correctly, not a driver of the design. See the `project-genetics-skill-unknown-genes` note.
- **The denominator varies per locus — in every tier, including local ones.** A genome records what was visible when that pet was studied, so a collection accumulated while levelling holds pets revealed to different depths, and two pets in the same stable can disagree about which loci are known. (A fully-revealed collection means the owner re-studied everything after maxing the skill — an action, not a default.) So `minKnown` is live from day one, and per-locus known counts must reach the UI rather than the population size (§6). Re-studying pets is the player's lever for improving their own baseline.
- **Complementarity.** At any locus `p_D + p_R = 1`, so the frequency side of the lens is driven by **one scalar per locus**: at most one allele can sit below 50%, and a mixed cell can never have both halves in a rare *frequency* bucket. (Bucket 4 is a carrier count, not a frequency, and is bounded separately — with `minKnown` ≥ 2 pets, both alleles at a locus cannot each have exactly one carrier.)
- **Minimum sample.** A locus with fewer than `minKnown` **alleles** has no meaningful rare/common distinction. Default **4** (= 2 pets with a known reading); such loci render as "missing data", same as `?`. `minKnown` only suppresses the *degenerate* case; it is **not** where the scale becomes informative. With self-inclusion, a pure pet contributes 2 of its locus's alleles, so at 2 pets its own allele is ≥50% → always "common". The scale gets meaningful around ~5+ pets of a species (§7) — sooner than genotype counting allowed, because the allele denominator is twice as large and a singleton allele reads at half the frequency.
- **Species-scoped.** Gene ids are only comparable within a species, so a baseline is always computed for one species (the pet's).
- **Self-inclusion.** The pet being viewed is part of its own population (if it qualifies for the tier). Decision: **include it.** The figure then reads naturally as "N of M alleles in my pets, this one's included". Excluding self is marginally more precise for tiny collections but confusing to explain and negligible at realistic sizes. Documented so a future change is a conscious one.

### Why mixed matters more than it looks: `x` expresses dominant

`getPetGeneStats` / `breedingGenetics.ts` treat `x` as dominant for effect purposes (`GeneTooltip` labels it "Mixed (treated as dominant)"). So a pure-`D` pet and an `x` pet are **phenotypically identical** — every other view in the app renders them the same way, and a recessive allele hiding in an `x` pet is invisible everywhere else.

That makes the recessive arm of this lens the only surface in the app that answers "which of these identical-looking horses is worth keeping?", and it is the direct argument for the two-tone mixed cell below: without it, the sole carrier of a scarce recessive allele looks exactly like the 21 pets that carry none.

### Rarity → shading (diverging, not sequential)

Each arm is bucketed into 5 ordinal levels and rendered on a **diverging ramp with a shared neutral centre**: common is the *same* recessive shade on both arms, and colour diverges by hue as the allele gets scarcer. **Purple = a scarce dominant allele, orange = a scarce recessive allele.**

```
  sole R   rare R   notable R   uncommon R  ←  COMMON  →  uncommon D  notable D  rare D  sole D
  orange ◄─────────────────────────────────── neutral ───────────────────────────────────► purple
```

Bucket 4 is tested **first** and overrides the frequency bands; buckets 0–3 are then a straight partition of the frequency range.

| bucket | rule | label |
|---|---|---|
| 4 | **exactly one carrier in the baseline** (checked first) | sole carrier |
| 3 | freq < 0.07 | rare |
| 2 | 0.07 ≤ freq < 0.18 | notable |
| 1 | 0.18 ≤ freq < 0.35 | uncommon |
| 0 | freq ≥ 0.35 | common (shared neutral centre) |

**Bucket 4 is a carrier count, not a frequency — deliberately.** A fixed frequency floor is unreachable on small baselines: a single mixed carrier sits at `1/(2N)`, so a `< 0.02` bucket only ever fires when `N > 25`. Measured on a 20-pet baseline it fired on **0.00%** of cells — the loudest step on the scale silently does not exist for most players. A carrier count is N-stable, always reachable, and is the fact the player actually acts on. It also fixes an ordering wart: under pure allele frequency a *pure* sole carrier (2 copies) reads as **less** rare than a *mixed* sole carrier (1 copy), despite being the better breeding source. Counting carriers ranks them together, and the zygosity shape still distinguishes them.

### Calibration against a real collection

Thresholds are measured, not guessed — taken from the author's live database (37 Horses, 30 stabled, 1576 loci, 58,312 genotypes; `~/Library/Application Support/com.gorgonetics.app/gorgonetics.db`).

| | b0 common | b1 uncommon | b2 notable | b3 rare | b4 sole |
|---|---|---|---|---|---|
| share of rendered halves — Stabled (30 pets) | 87.08% | 8.38% | 2.94% | 1.24% | 0.36% |
| share of rendered halves — All (37 pets) | 87.23% | 8.04% | 3.29% | 1.17% | 0.26% |
| cells per pet — Stabled | 1689 | 163 | 57 | 24 | 7 |

About **13% of the grid takes any tint at all**, and roughly 7 halves per pet reach the rarest step — dense enough to show structure, sparse enough that rare genuinely pops.

**The bucket-4 override is mild at realistic baseline sizes.** Every sole-carrier cell in the 30-pet baseline fires at a frequency of 0.0167–0.0333, i.e. all 208 of them would have landed in bucket 3 on frequency alone. So bucket 4 promotes cells by exactly one step here and the scale stays effectively monotonic in frequency; it is not silently painting a 20%-frequency cell as the loudest thing on the grid. That guarantee weakens as the baseline shrinks — see §7.

Two structural facts from the same data:

- **12.9% of loci are monomorphic** (one allele fixed, nobody carries the other). These render neutral, which is correct — see §7.
- **The signal concentrates, which is the whole point.** "Notable or rarer" cells per pet: median **52**, max **451**, with a clear break after ~24 pets sit below 100 and a handful run into the hundreds. A lens that painted every pet alike would not support a keep/release decision; this one separates them by an order of magnitude.
- **84% of the payoff is in mixed cells.** Of the loci where exactly one pet carries the recessive allele, **100 are mixed carriers against 19 pure recessives**. Those 100 are invisible in every other view in the app (`x` expresses dominant), so the two-tone mixed cell is not a nicety — it is where most of the feature's value lives.

Consequences of the shared centre, all intended:

- **Common recedes to nothing.** A locus where the pet carries the abundant allele renders as flat neutral — the grid only lights up where something is scarce.
- **A mixed cell with two common halves renders flat**, losing the visual split. Accepted: an all-common `x` locus is precisely the "nothing to see here" case. The mixed **border** treatment is retained so zygosity is still readable at rest.
- **Near-balanced loci (0.35 < p < 0.65) show a gentle two-tone**, purple against orange — which reads correctly as "this locus is a coin-flip in my stock".
- **The mixed cell's two halves are complements**, so the second tone is strictly redundant given the first. It is kept anyway because it is what makes the cell read as *"you are carrying a scarce allele in unresolved form, and here is which way to clarify"* rather than *"you are a rare pet"*.

**Hue choice: purple (dominant) ↔ orange (recessive).** The §4 base-class change means the rarity view **replaces** the attribute/appearance palette rather than sitting alongside it, so there is no simultaneous collision to avoid — which is fortunate, since the appearance view already spans nearly the entire hue wheel (`geneCell.css`) and "a hue nothing else uses" does not exist. The real constraints are: (a) **not green↔red**, which would import the attribute view's good/bad reading onto a scale that has no valence; (b) **colour-vision-safe**, since hue is what separates the two arms; (c) **theme-adaptive**. Purple↔orange satisfies all three — it is ColorBrewer's `PuOr`, a diverging scheme published as colourblind-safe, so this is a validated pair rather than a taste call. The centre and both arms are built by `color-mix` from a surface-relative neutral token so light/dark adapt without two hardcoded palettes; the missing-data style stays **dashed**, which is what keeps it distinct from the solid neutral of bucket 0.

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

Two facts measured off the live catalogue that the eventual design must handle:

- **Not every listed pet has a genome.** 84 pet docs, 52 genome docs, **32 pets whose `/genomes/{hash}` does not exist** (and no orphan genomes). A baseline builder that fetches per listed pet must tolerate misses rather than treating them as errors — and must not let them shrink the denominator silently. Tracked separately as #454.
- **Denominator spread widens.** Per-locus denominators already vary within a single collection (§2); a community population stacks many owners' study histories on top of that, so the spread is larger and `minKnown` will exclude more loci. Measured on the current catalogue the effect is still small — including the one partial genome shifts `p_D` by a median of 0.0028 over 1576 loci and drops that locus range's denominator from 52 to 51.

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
   - `--rarity-dom` — over cells whose state is `D` **or** `x`, bucketed on `p_D`, purple arm.
   - `--rarity-rec` — over cells whose state is `R` **or** `x`, bucketed on `p_R`, orange arm.

   Five buckets each, so **10 rules**, not 25 — the arms are independent so they never need to be crossed. Bucket 0 resolves to the same neutral token on both arms (the shared centre); bucket 4 is assigned by carrier count rather than by the frequency cutoffs (§2).
   ```css
   .view-rarity.gene-grid-container .gene-cell[data-gene-id="01A4"],
   .view-rarity.gene-grid-container .gene-cell[data-gene-id="02B1"] { --rarity-rec: <orangeArm[b]>; }
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
  │     → per-locus { knownPets, pureD, pureR, mixed }   // '?' contributes nothing
  ├─ p_D = (2·pureD + mixed) / (2 × knownPets);  p_R = 1 − p_D
  ├─ carriers(D) = pureD + mixed;  carriers(R) = pureR + mixed
  └─ rarityBucket(frequency, carriers) → 0..RARITY_LEVELS-1   // sole-carrier checked first
```

**What the per-locus record must hold.** The *frequency* side needs one number — `dominantAlleles` over `2 × knownPets`, with the recessive arm deriving from `p_D + p_R = 1` (§2). But bucket 4 is a carrier count, so the colour also needs `carriers(D) = pureD + mixed` and `carriers(R) = pureR + mixed`. Storing `{knownPets, pureD, pureR, mixed}` yields all of it (`dominantAlleles = 2·pureD + mixed`), and the same four numbers render the tooltip's breakdown. `knownPets` is per locus, never the population size (§2).

- **`loadAllPetLoci`** (existing, `utils/petLoci.ts`) already does the bulk `pet_genes` read for a set of ids in one query — reused as-is. This is the query that needs the in-memory `IN` fix (#433) to be correct in dev/tests.
- **Lazy + cached:** the baseline is computed only when the lens is first opened, keyed by `(species, population-id-set)`; re-used until that key changes. A background reload of the pet list that returns the same ids must not recompute (key on the id set, not array identity).
- **Loading state:** while the baseline loads, cells show the "missing data" style and the legend shows "Analysing…"; then the stylesheet fills in. This uses a **dedicated** loading flag, **not** the component's `loading` state — `loading` swaps the entire grid for a full-pane `StatusPane`, so reusing it would blank the grid on every population-toggle change.
- **`currentView` widens in two places.** `GeneVisualizer` holds the render-driving `currentView` (`'attribute' | 'appearance'` today) and its exported `handleViewChange` **coerces any non-`'appearance'` value to `'attribute'`** — that coercion must learn `'rarity'` or the button silently no-ops. `PetVisualization` / `CommunityPetVisualization` keep a parallel `currentView` string for button state only. Enumerate this sync as a concrete edit; it is a likely stumbling point.
- **Separate `<style>` element.** The filter sheet is one `<style id="gene-visualizer-filters">` on the component's `onMount`/`onDestroy` lifecycle. Rarity gets its **own** `<style id="gene-visualizer-rarity">` on the same lifecycle — do not overload the filter sheet.

## 6. UI

- **View control:** add a `Rarity` button to the existing Attributes/Appearance group in `PetVisualization`.
- **Population toggle:** a segmented `Stabled | All my pets` control, shown only in the rarity view, plus a disabled `Community · soon`.
- **Legend:** replaces the attribute/appearance legend in the rarity view — a **diverging bar** (`rare recessive ← common → rare dominant`) + the "missing data" swatch + the baseline size. The diverging bar is doing real teaching work here: it communicates the whole model — two arms, a shared common centre, hue = which allele — in one glance, which a one-way ramp could not. Non-interactive in v1.

  **The baseline size is a range, not a number.** Because denominators vary per locus (§2), "across 30 Horses" is wrong for any locus some of those pets have unstudied. The legend should state the population size and, when the two differ, flag that coverage is uneven — e.g. *"30 stabled Horses · 4 pets not fully studied"*. The exact per-locus figure belongs in the tooltip, where it can be correct per cell.
- **Stats drawer:** attribute/appearance-specific; hidden in the rarity view. (Optionally a per-bucket count summary later.)
- **Tooltip (proposed for v1):** on hover in the rarity view, show the allele figure **plus** the human-legible carrier breakdown, e.g. *"Recessive — 3 of 44 alleles (7%) across 22 Horses studied at this locus: 1 pure, 1 mixed carrier."* The pet count is the **per-locus** `knownPets`, not the population size — those differ whenever some pets were studied at a lower Genetics level (§2), and quoting the population size would misstate the evidence behind the colour. Allele frequency drives the colour; carrier counts are what a player actually reasons with when planning a pairing. For a mixed cell, show **both** arms, since the point of the cell is the contrast. Optionally a third line for the locus's unresolved share (*"9 of 22 still mixed here"*) — that is a fact about the stock, not about the allele's rarity, so it must not influence the colour.

  The data is cheap (the lookup holds it), but the *code* is not free: `showTooltipForCell` is hardwired to the attribute/appearance content (it reads `data-effect` / `data-appearance-effect`, computes potential-effect lines, and sizes the tooltip from effect-specific heights). Rarity needs a **third content branch** there. `GeneTooltip` already exposes `subtitle` and `effectsLabel` props, so it can render the rarity lines without new markup — but the branch in `showTooltipForCell` is real scope, not a freebie. Falls back to "not enough data" for missing-data cells.

## 7. Edge cases

- **Community pet preview** (`CommunityPetVisualization`) renders via `gridOverride` and has no `pet_genes` rows or a local population — the Rarity button is **not** exposed there. Local pets only.
- **Breed-inactive genes** (horse, wrong-breed loci): rarity coloring applies to any known-value cell; the existing breed row-hide is orthogonal and unchanged. But note the whole-chromosome row-hide is *not* the same as the per-cell `gene-inactive-breed` styling — individual wrong-breed cells survive on visible rows and carry `!important` grey. The §4 base-class change (neutral base in rarity view, no `gene-inactive-breed`) is what lets the rarity colour show on those cells; without it they stay grey.

  This is **load-bearing, not cosmetic.** Since breed-tagged loci are 1320 of 1576 (84% of the genome) and every horse carries all of them, leaving wrong-breed cells grey would suppress the large majority of the grid — including the cross-breed signal described below. A rare Calico allele sitting unexpressed in a Kurbone is exactly the kind of thing this view exists to surface.
- **Existing filters in the rarity view:** the attribute/effect legend filters don't map to rarity; v1 simply shows the rarity legend instead and leaves those filters inactive in this view. (Composing rarity with #369's gene-value filter is a later phase.)
- **Tiny populations:** with only a handful of pets, most alleles sit near the neutral centre (a pure pet's own allele is ≥50% at a 2-pet baseline), so the frequency bands go nearly colourless. This is correct, not a bug — you cannot have a rare allele in a 2-pet baseline. The legend's baseline-size line sets the expectation; the scale becomes meaningful around ~5+ pets of a species.

  **Bucket 4 goes the other way, and gets loud.** "Sole carrier" is trivially satisfied when there are few pets to carry anything, so as the baseline shrinks the loudest colour fires *more*, not less. Measured by resampling the calibration collection: **N=30 → 0.36% of halves (~7 cells per pet); N=20 → 0.49%; N=12 → 0.96%; N=8 → 1.73%; N=5 → 2.71% (~43 cells); N=3 → 7.08% (~112 cells)**. At N=5 a pet shows six times as many "rarest" cells as at N=30, and they mean far less. This is the exact mirror of the unreachability problem that made bucket 4 count-based in the first place — see §10 for the open question on whether to gate it.
- **Monomorphic loci:** if every pet in the baseline carries the same pure state, one arm is at 1.0 and the other at 0.0 — but the 0.0 arm is only reachable by a cell that carries that allele, and no such cell exists in the population. So an absent allele never renders; there is no "0%" bucket to design for. The only cell that can *hold* a bucket-4 allele is, by construction, a carrier of it — which is the whole point of the lens. Measured at **12.9% of loci** in a real 30-pet collection, so it is a substantial slice of the grid rather than a rare corner, and it renders neutral by design.
- **Breed is not a confound, and the baseline must stay species-scoped.** Every horse carries every breed's genes — the horse gene set is 256 untagged loci plus **132 loci for each of 10 breeds** (Satincoat, Statehelm, Calico, Standardbred, Paint, Kurbone, Ilmarian, Blanketed, Leopard, Plateau Pony) = the full 1576. Breed does not determine which loci a horse *has*, only which ones are *expressed*. So a breed's allele frequencies are measured across the whole collection, and **the lens reports how rare Calico genes are even for a player who has never owned a Calico** — which is a genuine capability, not a workaround: it tells you whether you are already sitting on scarce material for a breed you might acquire later.

  This also settles the population question: **breed-scoping the baseline would be wrong, not merely degenerate.** It discards every reading from pets of other breeds for loci they all carry — in the calibration collection that is anywhere from a third to 29 of 30 pets, depending on which breed the viewed pet belongs to. Rejected.

  The one caveat is coverage: a breed's loci are only measurable from pets that were studied at a high enough Genetics level, so for a low-level player — or a collection of pets studied long ago — a high-reveal breed's baseline may fall below `minKnown` and render as missing data. Correct behaviour, and re-studying the pets fixes it.

- **Genetically distant pets light up broadly — correct behaviour, and about lineage, not breed.** One pet in the calibration collection (Sardinilla) is the sole carrier at **169 loci** with 451 notable-or-rarer cells against a median of 52. Two checks show breed does not cause this:

  1. Only **12 of its 169** sole-carrier loci fall in its own breed's genes — *below* the 8.4% you would expect if they were scattered at random over the genome. 139 fall in **other** breeds' genes.
  2. The control: the collection's other singleton-breed pet (the lone Statehelm) has **2** sole-carrier loci, and two of the three Paints have **0**. If "lone breed" were the mechanism, they would look alike. They do not.

  The actual cause is ordinary genetic distance: mean pairwise genotype difference 0.555 against a population mean of 0.340 (σ = 0.056) — roughly 3.8σ out. The second-most-distinctive pet is a Kurbone, from the *largest* breed (n=20), at 0.482. So the lens is measuring lineage distinctiveness, which is exactly what it should measure; an unrelated import genuinely is the sole source of a lot of alleles. No mitigation needed — the legend's baseline size and the tooltip's carrier counts already give the reader what they need.

## 8. Scope

**v1 (this design):**
- Per-pet Rarity lens on the genome grid (Stabled + All my pets tiers).
- `geneFrequency` pure util, `frequencyService.computeRarityLookup`, injected rarity stylesheet in `GeneVisualizer`, view + population controls and legend in `PetVisualization`, and the third `showTooltipForCell` branch in `GeneVisualizer` (§6).

**Explicitly out of scope for v1:**
- Community tier (needs a cached/aggregated baseline — §3).
- A generic "all genes for a species, shaded by rarity" heatmap (exploratory map, no specific pet) — a plausible later companion surface, deferred.
- Integration with #369 (let the player define "beneficial" and combine rare×desirable).
- #367 wild-horse capture analysis (a downstream consumer of this baseline).
- Any change to grid sizing/layout (§4 non-goal).

## 9. Testing

- **Pure unit** (`geneFrequency`): allele tallies (`D`→2, `x`→1, `R`→0); `?` excluded from numerator **and** denominator; `2 × knownPets` denominator; **`p_D + p_R === 1` as a property test over random populations**; the two §2 worked examples (20`x`+2`D` → p_R ≈ 0.45; 1`x`+21`D` → p_R ≈ 0.023) as explicit regression cases against genotype counting; all-unknown locus; missing locus (no synthetic fill); `rarityBucket` boundaries. **Monotonicity holds only for buckets 0–3 with carriers held above 1** — the sole-carrier override deliberately breaks monotonicity in frequency, so the property test must fix `carriers` before asserting it, or it will fail on exactly the behaviour §2 specifies.
- **Bucket 4 is reachable at every baseline size** — the regression guard for the flaw that made it count-based. Assert a sole carrier lands in bucket 4 at N=5, 20 and 40; a frequency-based `< 0.02` rule fires at none of the first two. Also assert a *pure* sole carrier and a *mixed* sole carrier land in the same bucket.
- **Missing data must be synthesised.** The calibration collection has zero `?` genotypes, so fixtures have to construct partially-revealed pets deliberately: `?` cells excluded from both sides of the ratio, and the below-`minKnown` locus, which is the one that does *not* get `gene-unknown` for free (§4).
- **Uneven study depth within one local population.** A stable where some pets were studied at a lower Genetics level must yield **different `knownPets` at different loci**; assert the tooltip quotes the per-locus count rather than the population size, and that a locus dropping below `minKnown` renders as missing data while its neighbours still shade normally.
- **Service** (`computeRarityLookup`): species isolation (a mixed-species population yields only the requested species; the demo's beewasp must not leak into a horse baseline — the bug that motivated #433), `minKnown` gating in **alleles**.
- **Component/e2e:** the Rarity view button toggles the lens; a `D` cell gets only `--rarity-dom`, an `R` cell only `--rarity-rec`, an `x` cell **both**; missing-data cells get the dashed style; the population toggle recomputes; **the grid dimensions are identical across Attributes/Appearance/Rarity** (regression guard for the reverted layout churn); Rarity is absent on the community preview.
- **The scenario the feature exists for:** a baseline where one `x` pet is the sole carrier of a scarce recessive among otherwise-`D` pets — assert that pet's cell lands in the rarest recessive bucket while the phenotypically identical pure-`D` pets stay at the neutral centre. This is the case no other view in the app can distinguish (§2).

## 10. Open questions for review

**Settled** (recorded here so the reasoning isn't relitigated):

- Rarity is measured per **allele**, not per displayed genotype — `x` is one of each, not a third value (§2).
- Mixed cells render **two-tone** on a **diverging** scale with a shared common centre (§2, §4).
- Arms are **purple = dominant, orange = recessive** (ColorBrewer `PuOr`, published colourblind-safe).
- Thresholds are **0.35 / 0.18 / 0.07**, with bucket 4 defined by **carrier count**, calibrated against a 37-Horse collection (§2).
- **Breed-scoped baselines: rejected** — every horse carries all 10 breeds' loci, so scoping to one breed discards most of the evidence for genes the whole collection holds (§7).
- The viewed pet **is** included in its own denominator.

Still open:

1. **Tooltip in v1** — include the allele figure + carrier breakdown on hover (recommended), or ship shading-only first?
2. **Default population** — Stabled (recommended) or All my pets?
3. **Mixed-share line** — worth surfacing "9 of 22 still unresolved at this locus" in the tooltip, or noise?
4. **Surfacing the cross-breed signal** — the lens can tell you that you hold scarce alleles for a breed you do not own (§7). Is that worth a dedicated affordance later (e.g. "rare Calico material in your stock"), or does the plain grid cover it? Out of scope for v1 either way, but it is a stronger companion surface than the generic species heatmap currently listed in §8.
5. **Recalibration** — the thresholds hold for a ~30-pet single-species collection. Whether they still hold at 200+ pets, or across a species with different locus structure, is unknown; worth re-running the §2 measurement once the community tier exists.
6. **Bucket 4 on small baselines** — it fires on 2.7% of halves at N=5 and 7.1% at N=3, against 0.36% at N=30 (§7). Gate it behind a minimum baseline size so the loudest colour stays meaningful, or accept that small baselines are noisy everywhere and let it ride?
