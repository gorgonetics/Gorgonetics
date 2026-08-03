# Gene Rarity Lens — v1 Design

**Status:** Proposed — not yet implemented. For review.
**Issue:** #368 (Gene frequency analysis + rare/high-value gene identification).
**Related:** #369 (advanced gene-value filtering — future "what's beneficial to me" lens), #367 (wild-horse analysis — future consumer), #433/#434 (in-memory `IN` adapter fix — prerequisite for the per-species query to work in dev/tests; already separate).

---

## 1. Goal

Help a player decide **which pets to keep and which to release** by making gene *rarity* visible on a pet's genome. The core question is not "what is the rarest gene?" (a list nobody asks for) but "**does _this_ pet carry rare genes worth keeping?**" — which is a property of the pet's genome, so the answer belongs *on the genome grid*, not in a separate table.

Two surfaces share one measurement:

| surface | question | where |
|---|---|---|
| **Per-pet lens** | does *this pet* carry anything scarce? | third view on the genome grid (§4) |
| **Genome map** | where is there scarce material in my stock at all? | default view of the Reference destination (§7) |

Neither is a ranked list. The map is spatial — it shows *where* scarcity sits in genome layout — and it shares the per-pet scale, thresholds and lookup exactly.

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
- **Minimum sample.** A locus with fewer than `minKnown` **alleles** has no meaningful rare/common distinction. Default **4** (= 2 pets with a known reading); such loci render as "missing data", same as `?`. `minKnown` only suppresses the *degenerate* case; it is **not** where the scale becomes informative. With self-inclusion, a pure pet contributes 2 of its locus's alleles, so at 2 pets its own allele is ≥50% → always "common". The scale gets meaningful around ~5+ pets of a species (§8) — sooner than genotype counting allowed, because the allele denominator is twice as large and a singleton allele reads at half the frequency.
- **Species-scoped.** Gene ids are only comparable within a species, so a baseline is always computed for one species (the pet's).
- **Self-inclusion.** A *local* pet is part of its own population (if it qualifies for the tier). Decision: **include it.** The figure then reads naturally as "N of M alleles in my pets, this one's included". Excluding self is marginally more precise for tiny collections but confusing to explain and negligible at realistic sizes. Documented so a future change is a conscious one.

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
| 4 | **exactly one carrier**, and the locus has **≥ `soleCarrierMinPets` (10) known pets** | sole carrier |
| 3 | freq < 0.07 | rare |
| 2 | 0.07 ≤ freq < 0.18 | notable |
| 1 | 0.18 ≤ freq < 0.35 | uncommon |
| 0 | freq ≥ 0.35 | common (shared neutral centre) |

A sole carrier below the gate falls back to its frequency bucket rather than rendering as missing data — the cell is still measured, it just does not get the top step.

**Bucket 4 is a carrier count, not a frequency — deliberately.** A fixed frequency floor is unreachable on small baselines: a single mixed carrier sits at `1/(2N)`, so a `< 0.02` bucket only ever fires when `N > 25`. Measured on a 20-pet baseline it fired on **0.00%** of cells — the loudest step on the scale silently does not exist for most players. A carrier count is the fact the player actually acts on. It also fixes an ordering wart: under pure allele frequency a *pure* sole carrier (2 copies) reads as **less** rare than a *mixed* sole carrier (1 copy), despite being the better breeding source. Counting carriers ranks them together, and the zygosity shape still distinguishes them.

**And it is gated, because unrestrained it fails the opposite way.** "Only one carrier" is trivially true when there is almost nobody to carry anything, so an ungated bucket 4 gets *louder* as the baseline shrinks — 0.36% of halves at 30 pets, 2.7% at 5, 7.1% at 3 (§8). The `soleCarrierMinPets` gate keeps the top step meaning "scarce across a population big enough to say so". The cost is that a player below 10 pets of a species never sees the top step, which is the right trade: with 5 horses, "only one of them has it" is not yet information.

**Both arms get it.** A scarce dominant allele is as scarce as a scarce recessive one, so bucket 4 fires symmetrically. The asymmetry is in what the app can *otherwise* show you — a sole dominant carrier already stands out phenotypically, a sole recessive carrier hidden in an `x` cell does not — but that is an argument about where the lens adds value, not about what rarity means. Keeping the scale a clean mirror is simpler to explain and to render.

### Calibration against a real collection

Thresholds are measured, not guessed — taken from the author's live database (37 Horses, 30 stabled, 1576 loci, 58,312 genotypes; `~/Library/Application Support/com.gorgonetics.app/gorgonetics.db`).

| | b0 common | b1 uncommon | b2 notable | b3 rare | b4 sole |
|---|---|---|---|---|---|
| share of rendered halves — Stabled (30 pets) | 87.08% | 8.38% | 2.94% | 1.24% | 0.36% |
| share of rendered halves — All (37 pets) | 87.23% | 8.04% | 3.29% | 1.17% | 0.26% |
| cells per pet — Stabled | 1689 | 163 | 57 | 24 | 7 |

About **13% of the grid takes any tint at all**, and roughly 7 halves per pet reach the rarest step — dense enough to show structure, sparse enough that rare genuinely pops.

**The bucket-4 override is mild at realistic baseline sizes.** Every sole-carrier cell in the 30-pet baseline fires at a frequency of 0.0167–0.0333, i.e. all 208 of them would have landed in bucket 3 on frequency alone. So bucket 4 promotes cells by exactly one step here and the scale stays effectively monotonic in frequency; it is not silently painting a 20%-frequency cell as the loudest thing on the grid. That guarantee weakens as the baseline shrinks — see §8.

Two structural facts from the same data:

- **12.9% of loci are monomorphic** (one allele fixed, nobody carries the other). These render neutral, which is correct — see §8.
- **The signal concentrates, which is the whole point.** "Notable or rarer" cells per pet: median **52**, max **451**, with a clear break after ~24 pets sit below 100 and a handful run into the hundreds. A lens that painted every pet alike would not support a keep/release decision; this one separates them by an order of magnitude.
- **84% of the payoff is in mixed cells.** Of the loci where exactly one pet carries the recessive allele, **100 are mixed carriers against 19 pure recessives**. Those 100 are invisible in every other view in the app (`x` expresses dominant), so the two-tone mixed cell is not a nicety — it is where most of the feature's value lives.

Consequences of the shared centre, all intended:

- **Common recedes to nothing.** A locus where the pet carries the abundant allele renders as flat neutral — the grid only lights up where something is scarce.
- **A mixed cell with two common halves renders flat**, losing the visual split. Accepted: an all-common `x` locus is precisely the "nothing to see here" case. The uniform hairline every cell carries (§4) keeps it delineated, so a flat cell still reads as a cell.
- **Near-balanced loci (0.35 < p < 0.65) show a gentle two-tone**, purple against orange — which reads correctly as "this locus is a coin-flip in my stock".
- **The mixed cell's two halves are complements**, so the second tone is strictly redundant given the first. It is kept anyway because it is what makes the cell read as *"you are carrying a scarce allele in unresolved form, and here is which way to clarify"* rather than *"you are a rare pet"*.

**Ramp strength is a calibration, not a formality.** The arms are `color-mix` toward `transparent` at **32 / 55 / 78 / 100%**, over a bucket-0 neutral at 22%. A first attempt at 12 / 18 / 38 / 66% was measured on screen and failed: bucket 0 carries ~87% of cells, so at 12% the common tint vanished and took the grid's structure with it. "Common recedes" cannot mean "common disappears".

**Hue choice: purple (dominant) ↔ orange (recessive).** The §4 base-class change means the rarity view **replaces** the attribute/appearance palette rather than sitting alongside it, so there is no simultaneous collision to avoid — which is fortunate, since the appearance view already spans nearly the entire hue wheel (`geneCell.css`) and "a hue nothing else uses" does not exist. The real constraints are: (a) **not green↔red**, which would import the attribute view's good/bad reading onto a scale that has no valence; (b) **colour-vision-safe**, since hue is what separates the two arms; (c) **theme-adaptive**. Purple↔orange satisfies all three — it is ColorBrewer's `PuOr`, a diverging scheme published as colourblind-safe, so this is a validated pair rather than a taste call. The centre and both arms are built by `color-mix` from a surface-relative neutral token so light/dark adapt without two hardcoded palettes; the missing-data style stays **dashed**, which is what keeps it distinct from the solid neutral of bucket 0.

Zygosity is still readable, but through **fill shape** rather than border thickness (see §4): solid = pure, diagonal split = mixed. For pure cells the hue itself says which allele — purple arm for `D`, orange arm for `R` — so the attribute view's thick recessive border is redundant in this view and is dropped, which is what lets every cell paint edge to edge at identical size.

## 3. Population tiers

One feature, a widening denominator. Same computation at each tier; only `P` grows.

| Tier | Population | Cost | v1? |
|---|---|---|---|
| **Stabled** | Pets with the `stabled` marker set | Local SQLite, instant | ✅ |
| **All my pets** (default) | Every pet in the local DB (`getAllPets()`) | Local SQLite, instant | ✅ |
| **Community** | The shared catalogue | See below | ❌ deferred |

The two local tiers map to existing state: **Stabled** = the `stabled` boolean marker (`MarkerKey` in `stores/pets.ts`); **All my pets** = the full `getAllPets()` set. The app has **no "released" pet state** — a pet is either in the local DB or it isn't — so "All my pets" is simply "not filtered to the stabled subset", not a superset that adds released animals.

**What the community tier is actually for: sample size.** Not browsing other people's animals — pooling their genomes so the percentages stabilise. A 30-pet baseline can only express frequencies in steps of `1/(2N)` = 1.7%, so the entire "rare" band (below 7%) is four distinct values wide and the difference between 3% and 5% is not measurable. Pooling a few hundred genomes makes the low end continuous, which is exactly where the scale does its work. It is a precision instrument for the buckets, not a feature about other players.

**The caveat that comes with it: pooling improves precision, not necessarily accuracy.** A crowd-sourced baseline estimates "how rare is this among *uploaded* pets", which is only the game world if uploaders are representative — and they are not, in two measurable ways:

- **The catalogue is currently one person.** Of 52 shared Horse genomes, **46 are from a single character**, 5 from a second and 1 from a third. A "community" baseline today would be the maintainer's own collection with six extra animals, i.e. the local baseline wearing a hat.
- **A breeder's stock is highly related.** Mean pairwise genotype difference within the calibration collection is 0.340 — any two of those horses agree at roughly two thirds of their loci. Pooling related animals inflates the apparent commonness of whatever a prolific line happens to carry, and no amount of extra genomes from that line corrects it.

So the tier is worth building for granularity, and worth labelling honestly: it answers "rare among shared pets", and that phrasing should reach the UI rather than an unqualified "rare".

**Why it is deferred.** The catalogue is split so the list path is cheap: `/pets/{hash}` holds metadata only, `/genomes/{hash}` holds the genome blob (see `public-pet-sharing-v1.md`). `listPets()` never fetches genomes. A community baseline would require fetching *every* genome doc to tally per-locus values — hundreds of reads against the Firestore Spark free quota (50k reads/day), repeated as the catalogue grows. It needs either a precomputed server-side aggregate or an aggressively cached client tally, which is its own design. Out of scope for v1; the population selector will show a disabled "Community · soon" affordance so the tiering is legible.

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
   /* Every cell: the SAME hairline. Uniformity is the requirement. */
   .view-rarity .gene-cell { border-width: 1px; border-color: var(--rarity-cell-edge); }

   .view-rarity .gene-cell[data-zygosity="dominant"]  { background: var(--rarity-dom); }
   .view-rarity .gene-cell[data-zygosity="recessive"] { background: var(--rarity-rec); }
   .view-rarity .gene-cell[data-zygosity="mixed"] {
     background: linear-gradient(135deg, var(--rarity-rec) 50%, var(--rarity-dom) 50%);
   }
   .view-rarity .gene-cell.gene-rarity-missing        { /* dashed neutral */ }
   ```

   **Every cell takes the same neutral hairline — the requirement is uniformity, not absence.** `.gene-cell` carries `border: 2px solid` unconditionally, and recessive cells widen it to 4px (`geneCell.css`). Neither of the obvious options works: a single hue on a split cell would read as one allele owning the whole cell, and hueing only the *pure* cells makes split cells look **smaller**, because `box-sizing: border-box` is global (`app.css`) so a border that does not match the fill eats inward on all four sides.

   **Dropping the border entirely was tried and is wrong.** It removes the lattice: cells dissolve into their fills, and since `?` cells keep their dashed outline they become the only bordered things on screen, reading as disconnected boxes floating in empty space. One uniform edge on every cell satisfies the size constraint *and* keeps the grid legible. Width drops to 1px so more fill shows; with border-box that changes no geometry at all, only how much colour is visible.

   **Zygosity is then carried by fill shape, not by border thickness.** Solid = pure, split = mixed, and for pure cells the *hue* already says which allele (purple arm vs orange arm), so the recessive 4px ring is redundant here and is dropped in this view only. The one thing it stops distinguishing is a pure `D` from a pure `R` at a locus where both alleles are common — and both are then the neutral centre, i.e. the "nothing to see here" case by construction.
   The mixed gradient keeps the existing `135deg` orientation from `geneCell.css` but paints both halves, with **recessive top-left and dominant bottom-right** — dominant lands in the half that is the filled one in the attribute/appearance views, so the established visual habit carries over, which is apt given `x` expresses dominant. The genome map (§7) splits every cell on this same axis, so the same locus never appears mirrored across the two surfaces.

**Base-class note (required, not optional).** The grid's cell binding is `class={currentView === "appearance" ? cell.appearanceCls : cell.attributeCls}` — so in **any** non-appearance view, including rarity, a cell would otherwise carry `attributeCls` and paint itself with the attribute-view effect colours. Worse, wrong-breed cells carry `gene-inactive-breed`, whose grey fill/border use `!important` (`geneCell.css`) and would defeat a plain `.view-rarity` rule. So the binding must become a **three-way** choice: in rarity view the cell renders a neutral base (`gene-cell` + the zygosity class only, no effect/appearance/inactive-breed colour class), and `.view-rarity` supplies the rarity colour on top. This is the one render-template change Approach B needs; it touches the class expression only, not `VisCell`, `buildGrid`, or any sizing/layout code.

**Why B is right:** it is **rebuild-free and layout-free by construction.** No `VisCell` changes, no `buildGrid` call, and — critically — **no change to cell sizing, the `ResizeObserver`, pane flex, or any existing layout CSS.** Verified against the code: the table is wrapped in `{#key headerStructure}`, which only re-keys on a pet load/rebuild, never on a view toggle; and `cellSize` derives solely from `gridContainerWidth` and `totalGeneColumns`, neither of which changes when `currentView` flips. So the grid is byte-for-byte the same size and position across all three views. Population changes and the async baseline load just regenerate the rarity stylesheet — never the grid.

> **Explicit non-goal (hard-won):** v1 must not touch grid cell sizing, responsive behavior, the pane's flex layout, or any existing grid CSS. The only new CSS is scoped behind `.view-rarity`. If the lens appears to require a layout change, that is a signal the approach is wrong, not that the layout needs fixing.

### The coupling that keeps breaking this feature

`--cell-size` is computed from the grid container's measured **width**. Three separate paths let a change that has nothing to do with width reach it, and each has broken the lens at least once:

| path | mechanism | fix |
|---|---|---|
| **Header content** | `.do-body` is a flex **row** and `.pet-visualization` had no `flex`/`width`, so it was sized shrink-to-fit by its own contents. The *header's* intrinsic width therefore set the *grid's* width — adding the population toggle grew it ~327px. | `flex: 1; min-width: 0` (#436) |
| **Sibling width** | `.content-area` is a row shared with `.stats-drawer`. Unmounting the drawer on a view switch hands the grid its width. | keep the drawer mounted; swap its body (§6) |
| **Vertical → horizontal** | Cell size reads `contentRect.width`, which *excludes* a scrollbar occupying layout space. A taller legend shortens the box, flips the vertical scrollbar, and the width changes. | `scrollbar-gutter: stable` (#436) |

The first and third are pre-existing defects, not rarity-lens bugs — the lens only made them visible by being the first change to alter the header and the legend. **Any** future control added to this header or legend will hit them again if the fixes are reverted.

**This cannot be verified by reasoning, and twice was not.** jsdom has no layout, so unit tests cannot see it. `tests/e2e/rarity-lens.spec.ts` measures real boxes across the three views and, on failure, prints the ancestor width chain — which is what identified the header coupling after two wrong guesses. It measures only once layout has settled: `.gene-cell` has a `0.2s` transition and cell size is the fixed point of a ResizeObserver loop, so a naive measurement reports drift between a view and *itself*.

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

frequencyService.computeRarityLookup(pets, species, opts)
  ├─ filter pets to species → petIds        // gene ids differ across species
  ├─ ensureProjected(petIds)                // legacy pets with no pet_genes rows
  ├─ loadLocusTallies(petIds)               // GROUP BY in SQLite, 1 row per locus
  └─ → tally / bucketOf / frequency / carriers / measurable, by gene id

geneFrequency (pure, no DB)
  ├─ computeLocusFrequencies(Iterable<PetLoci>)   // reference impl; pins the SQL
  │     → per-locus { knownPets, pureD, pureR, mixed }   // '?' contributes nothing
  ├─ p_D = (2·pureD + mixed) / (2 × knownPets);  p_R = 1 − p_D
  ├─ carriers(D) = pureD + mixed;  carriers(R) = pureR + mixed
  └─ rarityBucket(frequency, carriers) → 0..RARITY_LEVELS-1   // sole-carrier checked first
```

**What the per-locus record must hold.** The *frequency* side needs one number — `dominantAlleles` over `2 × knownPets`, with the recessive arm deriving from `p_D + p_R = 1` (§2). But bucket 4 is a carrier count, so the colour also needs `carriers(D) = pureD + mixed` and `carriers(R) = pureR + mixed`. Storing `{knownPets, pureD, pureR, mixed}` yields all of it (`dominantAlleles = 2·pureD + mixed`), and the same four numbers render the tooltip's breakdown. `knownPets` is per locus, never the population size (§2).

- **The `IN (…)` clause still needs the in-memory adapter fix (#433)** to be correct in dev/tests — the aggregate below filters by `pet_id IN (…)` just as the row-based read did.

### Performance: measured, and where the real cost is

The arithmetic is not the bottleneck. Measured on synthetic populations at a full 1576-locus horse genome:

| population | tally | bucket pass (both arms, every locus) |
|---|---|---|
| 37 pets (a real collection) | 4.6 ms | 0.4 ms |
| 200 pets | 11.4 ms | 0.1 ms |
| 500 pets | 32.3 ms | 0.2 ms |

Under a 16 ms frame at any realistic local size, in jsdom — slower than the production webview — and it happens **once per population**, behind the cache. `tests/unit/geneFrequencyPerf.test.ts` pins this as a regression guard against accidental super-linear work; it is not a benchmark.

**The read is the real cost, so it is aggregated in SQLite.** `loadAllPetLoci` would ship one row per pet per locus — **58,312 rows for 37 pets** — across the Tauri IPC boundary to produce 1,576 tallies. That serialisation, not the tally loop, is what would show as lag. So the baseline does not use it:

```sql
SELECT gene_id,
       SUM(CASE WHEN gene_type = 'D' THEN 1 ELSE 0 END) AS pure_d,
       SUM(CASE WHEN gene_type = 'R' THEN 1 ELSE 0 END) AS pure_r,
       SUM(CASE WHEN gene_type = 'x' THEN 1 ELSE 0 END) AS mixed
FROM pet_genes WHERE pet_id IN (…) GROUP BY gene_id
```

1,576 rows instead of 58,312 — a ~37× cut in IPC payload, with the grouping done in C inside the database process. `LocusTally` is shaped as exactly this row.

**No `<> '?'` predicate, and that is not an oversight.** `resolveNamedParams` rewrites named params to positional `?`, so a literal `'?'` in the SQL would be miscounted as a placeholder. It is unnecessary anyway: `?` rows match none of the three `CASE WHEN` arms and contribute 0 to every sum, which *is* the rule that unknown readings count toward neither numerator nor denominator. `knownPets` therefore derives from the three sums rather than `COUNT(*)`, and a locus that is `?` for every pet aggregates to all-zero and is dropped — matching what `computeLocusFrequencies` produces.

**This required extending `InMemoryDatabase`,** the regex-matched SQL subset used in dev and unit tests. It had no `GROUP BY` branch, so the query would have fallen through to its generic `SELECT … FROM` case and silently returned **raw rows instead of aggregates** — dev and tests quietly disagreeing with production, the same class of bug as #433. The new branch parses the **original-case** SQL, because `select()` lowercases before matching and would otherwise turn `'D'` into `'d'` and match nothing (a hazard the adapter already documents for `'Horse'`).

**The guard that makes this safe:** a test asserts the aggregate path produces tallies identical to `computeLocusFrequencies` over the same pets. That pins the emulator to the reference implementation the pure unit tests already cover, so the two cannot drift apart unnoticed. `computeLocusFrequencies` is retained for exactly this purpose.

**Populate-and-retry is preserved.** `loadAllPetLoci` inline-populates `pet_genes` for legacy pets with no projected rows; an aggregate grouped by locus cannot see which *pets* are missing, so the service asks first with a `SELECT DISTINCT pet_id` (at most one row per pet) and populates the gaps before aggregating. Without it a legacy pet would contribute nothing and silently shrink the denominator.
- **Lazy + cached:** the baseline is computed only when the lens is first opened, keyed by `(species, population-id-set)`; re-used until that key changes. A background reload of the pet list that returns the same ids must not recompute (key on the id set, not array identity).
- **Loading state:** while the baseline loads, cells show the "missing data" style and the legend shows "Analysing…"; then the stylesheet fills in. This uses a **dedicated** loading flag, **not** the component's `loading` state — `loading` swaps the entire grid for a full-pane `StatusPane`, so reusing it would blank the grid on every population-toggle change.
- **`currentView` widens in two places.** `GeneVisualizer` holds the render-driving `currentView` (`'attribute' | 'appearance'` today) and its exported `handleViewChange` **coerces any non-`'appearance'` value to `'attribute'`** — that coercion must learn `'rarity'` or the button silently no-ops. `PetVisualization` / `CommunityPetVisualization` keep a parallel `currentView` string for button state only. Enumerate this sync as a concrete edit; it is a likely stumbling point.
- **Separate `<style>` element.** The filter sheet is one `<style id="gene-visualizer-filters">` on the component's `onMount`/`onDestroy` lifecycle. Rarity gets its **own** `<style id="gene-visualizer-rarity">` on the same lifecycle — do not overload the filter sheet.

## 6. UI

- **View control:** add a `Rarity` button to the existing Attributes/Appearance group in `PetVisualization`.
- **Population toggle:** a segmented `Stabled | All my pets` control, shown only in the rarity view, plus a disabled `Community · soon`. **Defaults to All my pets** — the widest local baseline gives the most evidence per locus, and the `stabled` subset is a housekeeping marker rather than a statement about which animals count as your genetic stock. It also keeps the default further from the small-baseline regime where the sole-carrier gate suppresses the top step (§2).
- **Legend:** replaces the attribute/appearance legend in the rarity view — a **diverging bar** (`rare recessive ← common → rare dominant`) + the "missing data" swatch + the baseline size. The diverging bar is doing real teaching work here: it communicates the whole model — two arms, a shared common centre, hue = which allele — in one glance, which a one-way ramp could not. Non-interactive in v1.

  **The baseline size is a range, not a number.** Because denominators vary per locus (§2), "across 30 Horses" is wrong for any locus some of those pets have unstudied. The legend should state the population size and, when the two differ, flag that coverage is uneven — e.g. *"30 stabled Horses · 4 pets not fully studied"*. The exact per-locus figure belongs in the tooltip, where it can be correct per cell.
- **Stats drawer: stays MOUNTED in the rarity view — its *body* swaps, not the drawer.** Stats are attribute/appearance-specific and have no rarity analogue, so the natural instinct is to hide the drawer. That breaks the grid: `.content-area` is a flex **row**, so the drawer and `.visualizer-container` (`flex: 1`) share the width, and unmounting it hands the grid an extra `drawerWidth` px — the ResizeObserver fires and every cell resizes. The §4 non-goal outranks the tidier UI, so the drawer keeps its box and shows a short note instead. (Optionally a per-bucket count summary later.)
- **Tooltip — always both alleles, exact percentages, with effect alongside.** The colour is bucketed, but the tooltip is not: it shows the **actual frequency** for *both* alleles, and the effect each one produces, so the player can weigh scarce-against-desirable themselves.

  ```
  01A4 · chr01 · Kurbone
                rarity          effect
  Dominant      62.5%           Virility−
  Recessive     37.5%           Temperament+   ✦ positive
  Across 22 Horses studied at this locus · 8 pure R, 3 mixed
  ```

  - **Both arms, always** — not just on mixed cells. The two frequencies are what the scale is built from, and showing both matches the genome map, where both halves are always drawn (§7). It also spares the reader inverting `1 − p` in their head.
  - **Exact, not bucketed.** Granularity is `1/(2N)` (1.7% at 30 pets), so one decimal place is enough; more would imply precision the sample does not have.
  - **Effect per allele** from `effectDominant` / `effectRecessive`. `parseEffect` already returns `{attribute, sign}`, so mark the arm(s) whose sign is `+`. Mark **both** if both are positive and **neither** if neither is — "which, if any" is the honest framing. Fall back to the raw effect string with no marker when `parseEffect` returns null (unparseable, or a "potential"/`?` effect), and to "No dominant effect" via `isNoEffect`.
  - **The pet count is the per-locus `knownPets`**, never the population size — those differ whenever some pets were studied at a lower Genetics level (§2), and quoting the population size would misstate the evidence behind the colour.
  - **Keep valence and rarity in separate columns.** This tooltip is the one place where the attribute view's green/red effect semantics and the rarity view's purple/orange scale coexist. They must stay visually distinct — never blend them into a single swatch, or "rare" and "good" become one colour again, which §2's hue choice exists to prevent.

  This is also where v1 quietly delivers the "rare **and** desirable" pairing that §1 defers: not as a score or a filter, but by putting both facts on one card and leaving the judgement to the player. #369 remains the systematic version.

  The data is cheap (the lookup holds it), but the *code* is not free: `showTooltipForCell` is hardwired to the attribute/appearance content (it reads `data-effect` / `data-appearance-effect`, computes potential-effect lines, and sizes the tooltip from effect-specific heights). Rarity needs a **third content branch** there. `GeneTooltip` already exposes `subtitle` and `effectsLabel` props, so it can render the rarity lines without new markup — but the branch in `showTooltipForCell` is real scope, not a freebie. Falls back to "not enough data" for missing-data cells.

## 7. Reference: the genome map

The per-pet lens answers *"does this pet carry anything scarce?"*. The complementary question — *"where is there scarce material in my stock at all?"* — has no pet in it, and belongs on the **Reference** destination.

Reference today is a gene-*template* editor (animal type → chromosome → `Edit Genes` → `GeneEditingView`) and reads as a different application from the rest of the app: no view switcher, no breed control, no baseline. **The map becomes its default**, and the template editor becomes a secondary mode reached from the same toolbar. Same controls as the other destinations:

- **Animal type** — already there; it scopes the baseline (gene ids are only comparable within a species, §2).
- **Breed** — the same per-species breed toggle the other views use (`utils/species.ts`). For horses this slices the map to that breed's 132 loci; with each breed occupying four dedicated chromosomes (§8), the slice is a contiguous region rather than a scatter. **This filters which loci are *displayed*; it does not scope the baseline** — the frequencies behind every cell are still computed across all pets of the species, exactly as §8 requires. Breed-scoped *populations* are rejected; breed-scoped *views* are just a filter, and the two must not be conflated in implementation.
- **Baseline** — `Stabled | All my pets | Community · soon`, mirroring §3. Community stays deferred here for exactly the reason it is deferred there: the map needs the same per-locus tally, so it needs the same aggregate that does not exist yet.

**No ranked "rarest genes" list.** §1's framing stands — the value is seeing *where* scarcity sits in genome layout, not reading an ordered table.

**The template editor becomes an `Edit` toggle on the map.** With it on, clicking a single cell opens that gene's editor and clicking a row/chromosome header opens the chromosome editor — so the map doubles as the navigation the old animal-type/chromosome pickers provided, and editing is an explicit mode rather than the default. **Deliberately deferred:** the feature has a single user (the maintainer), so it is enough that the map does not strand it. Sequence the map first and fit the toggle afterwards; do not let editor plumbing shape the map's design.

### What a cell encodes when there is no pet

**Every map cell is split — there are no solid cells here at all.** With no pet there is no zygosity to encode, so the split is unconditional and the two halves are the entire encoding. The §4 border rule therefore applies uniformly here by construction: every cell is split, so every cell takes the same neutral hairline and none can look smaller than its neighbour.

The split uses the same shape and axis the pet grid uses for `x` (§4):

- **top-left half** — shaded by the **recessive** allele's rarity (orange arm)
- **bottom-right half** — shaded by the **dominant** allele's rarity (purple arm)

So the cell reads on two channels at once: *is anything rare here* (any visible tint) and *which value is the rare one* (which half is lit, and its hue). A balanced locus is quiet on both halves; a locus where the dominant allele is scarce shows a lit bottom-right against a neutral top-left.

The clean mental model: **a map cell is exactly what a hypothetical fully-mixed pet would render at that locus.** The map is the pet grid with the pet replaced by "one of each allele", which is why it needs no new scale, thresholds or lookup — and it makes the two surfaces directly comparable by eye.

Because `p_D + p_R = 1` (§2), the two halves are complements and the second is formally redundant — at most one can be lit. It is kept for the same reason as the pet grid's mixed cells: the redundancy is what makes "which way is it scarce" legible at a glance instead of requiring the reader to invert a number.

This also agrees cell-for-cell with the per-pet view: a locus whose bottom-right is purple on the map is the same locus where a pet *carrying* `D` renders purple. The map shows every locus's scarcity; the pet grid shows only the loci where that pet actually holds the scarce side.

`minKnown` and the missing-data style carry over unchanged, and matter more here: with denominators varying per locus (§2), a map is precisely where under-studied regions become visible as dashed cells.

**The map needs its own grid component — this is the main implementation risk.** `GeneVisualizer` cannot be reused as-is: `gridOverride` bypasses the DB read but the component still takes a `pet` and builds cells from genotypes (`const grid = gridOverride ?? await loadPetGridFromDb(p.id)`), baking zygosity classes the map must not have. Feeding it a synthetic genome with placeholder genotypes would be a hack that fights the component at every turn. The map instead wants a **thin grid that shares the layout maths** (chromosome/block structure, `computeGeneCellSize`, the `ResizeObserver`) and nothing else — every cell carries only `data-gene-id` and renders the fixed diagonal split, coloured by the same injected-stylesheet mechanism and the same `--rarity-dom` / `--rarity-rec` properties as §4. That is genuinely less machinery than the pet grid, not more: no genotype, no `data-zygosity` branching, and none of the effect, appearance or breed-inactive class logic applies — every cell is the mixed case. The §4 non-goal still binds: do not touch the existing grid's sizing to accommodate a new one.

### Absent alleles render neutral

A locus where **nobody** carries the minority allele (12.9% of loci, §8) has `carriers = 0`. It renders at the **neutral centre**, not at the loud end: a monomorphic locus is settled, there is no variation to exploit, and nothing to act on. That matches the per-pet view, where such loci are also neutral, and it keeps the scale honest — it measures how scarce a thing you can actually obtain is, and with no carrier anywhere there is nothing to obtain.

### Measured density — the map is much louder, and that is correct

Same thresholds, very different picture (30 stabled Horses, 1576 loci):

| | absent | b0 common | b1 uncommon | b2 notable | b3 rare | b4 sole |
|---|---|---|---|---|---|---|
| genome map (share of loci) | 12.9% | 19.0% | 23.1% | 15.9% | 15.9% | 13.2% |
| per-pet grid (share of halves) | — | 87.1% | 8.4% | 2.9% | 1.2% | 0.4% |

**45% of the map takes a notable-or-stronger tint, against 13% of the pet grid taking any tint at all.** That is not a miscalibration — the two surfaces select differently. A pet cell only lights up when *that pet* holds the scarce allele, and most pets hold the common one; a map cell is scored by whichever allele at that locus is scarcer, so any locus with scarcity anywhere lights up.

The two densities suit their jobs. The pet grid wants sparse highlighting — a needle in a haystack, a handful of cells worth acting on. The map wants dynamic range — a near-flat spread across buckets (19 / 23 / 16 / 16 / 13) uses the whole scale and shows terrain; a map that was 87% neutral would be a blank sheet. One threshold set, two appropriate results, for principled reasons rather than luck.

Breed slices sit in a narrow band — 38% to 54% of each breed's loci reach b2+, with untagged loci lowest at 37.5% — so the breed toggle is for focus, not for finding a breed that is dramatically scarcer than the others.

> **Worth checking in practice:** 45% coloured is a real amount of colour. If the map reads as noisy rather than informative, the fix is a *map-specific* threshold set, not a change to the shared scale — the per-pet calibration should not be disturbed to fix a map problem.

## 8. Edge cases

- **Community pet preview** (`CommunityPetVisualization`) renders via `gridOverride` and has no `pet_genes` rows — the Rarity button is **not** exposed there. Local pets only.

  The tempting reading is that a shared pet could be scored against your baseline to answer *"is this worth importing?"*. Rejected: **a community pet is not yours and cannot be bred with**, so a scarcity readout on it has no action attached. It would also make `carriers = 0` reachable — an allele no pet of yours carries — which would need its own step beyond bucket 4, its own label, and its own gate. That is a chain of machinery serving a decision players cannot act on. The shared catalogue's value is a bigger *sample*, not a shopping window (§3).
- **Breed-inactive genes must not stay grey — this is the whole cross-breed story.** Rarity colouring applies to any known-value cell. The existing breed row-hide is orthogonal and unchanged, but note it is *not* the same as the per-cell `gene-inactive-breed` styling: individual wrong-breed cells survive on visible rows and carry `!important` grey. The §4 base-class change (neutral base in the rarity view, no `gene-inactive-breed`) is what lets rarity colour show on them.

  **Load-bearing, not cosmetic.** Breed-tagged loci are 1320 of 1576 — **84% of the genome** — and every horse carries all of them. Grey them out and the lens suppresses the large majority of the grid.

  This is also all that "surfacing the cross-breed signal" requires. A pet's grid already shows every locus it has, including other breeds'; the breed control narrows that display when you want to focus. So a scarce Calico allele sitting unexpressed in a Kurbone shows up on that Kurbone's own grid as soon as the cell is allowed to take colour. No dedicated affordance, no separate surface — just don't grey the cell.
- **Existing filters in the rarity view:** the attribute/effect legend filters don't map to rarity; v1 simply shows the rarity legend instead and leaves those filters inactive in this view. (Composing rarity with #369's gene-value filter is a later phase.)
- **Tiny populations:** with only a handful of pets, most alleles sit near the neutral centre (a pure pet's own allele is ≥50% at a 2-pet baseline), so the frequency bands go nearly colourless. This is correct, not a bug — you cannot have a rare allele in a 2-pet baseline. The legend's baseline-size line sets the expectation; the scale becomes meaningful around ~5+ pets of a species.

  **Bucket 4 would go the other way, which is why it is gated.** "Sole carrier" is trivially satisfied when there are few pets to carry anything, so ungated the loudest colour fires *more* as the baseline shrinks. Measured by resampling the calibration collection: **N=30 → 0.36% of halves (~7 cells per pet); N=20 → 0.49%; N=12 → 0.96%; N=8 → 1.73%; N=5 → 2.71% (~43 cells); N=3 → 7.08% (~112 cells)**. At N=5 a pet would show six times as many "rarest" cells as at N=30, meaning far less. Hence `soleCarrierMinPets = 10` (§2): below that the step is suppressed and cells fall back to their frequency bucket. A player with fewer than 10 of a species sees a working frequency scale with no top step, which is honest — at that size there is nothing for the top step to mean.
- **Monomorphic loci:** if every pet in the baseline carries the same pure state, one arm is at 1.0 and the other at 0.0 — but the 0.0 arm is only reachable by a cell that carries that allele, and no such cell exists in the population. So an absent allele never renders; there is no "0%" bucket to design for. The only cell that can *hold* a bucket-4 allele is, by construction, a carrier of it — which is the whole point of the lens. Measured at **12.9% of loci** in a real 30-pet collection, so it is a substantial slice of the grid rather than a rare corner, and it renders neutral by design.
- **Breed is not a confound, and the baseline must stay species-scoped.** Every horse carries every breed's genes — the horse gene set is 256 untagged loci plus **132 loci for each of 10 breeds** (Satincoat, Statehelm, Calico, Standardbred, Paint, Kurbone, Ilmarian, Blanketed, Leopard, Plateau Pony) = the full 1576. Breed does not determine which loci a horse *has*, only which ones are *expressed*. So a breed's allele frequencies are measured across the whole collection, and **the lens reports how rare Calico genes are even for a player who has never owned a Calico** — which is a genuine capability, not a workaround: it tells you whether you are already sitting on scarce material for a breed you might acquire later.

  This also settles the population question: **breed-scoping the baseline would be wrong, not merely degenerate.** It discards every reading from pets of other breeds for loci they all carry — in the calibration collection that is anywhere from a third to 29 of 30 pets, depending on which breed the viewed pet belongs to. Rejected.

  The one caveat is coverage: a breed's loci are only measurable from pets that were studied at a high enough Genetics level, so for a low-level player — or a collection of pets studied long ago — a high-reveal breed's baseline may fall below `minKnown` and render as missing data. Correct behaviour, and re-studying the pets fixes it.

- **Genetically distant pets light up broadly — correct behaviour, and about lineage, not breed.** One pet in the calibration collection (Sardinilla) is the sole carrier at **169 loci** with 451 notable-or-rarer cells against a median of 52. Two checks show breed does not cause this:

  1. Only **12 of its 169** sole-carrier loci fall in its own breed's genes — *below* the 8.4% you would expect if they were scattered at random over the genome. 139 fall in **other** breeds' genes.
  2. The control: the collection's other singleton-breed pet (the lone Statehelm) has **2** sole-carrier loci, and two of the three Paints have **0**. If "lone breed" were the mechanism, they would look alike. They do not.

  The actual cause is ordinary genetic distance: mean pairwise genotype difference 0.555 against a population mean of 0.340 (σ = 0.056) — roughly 3.8σ out. The second-most-distinctive pet is a Kurbone, from the *largest* breed (n=20), at 0.482. So the lens is measuring lineage distinctiveness, which is exactly what it should measure; an unrelated import genuinely is the sole source of a lot of alleles. No mitigation needed — the legend's baseline size and the tooltip's carrier counts already give the reader what they need.

## 9. Scope

**v1 (this design):**
- Per-pet Rarity lens on the genome grid (Stabled + All my pets tiers).
- `geneFrequency` pure util, `frequencyService.computeRarityLookup`, injected rarity stylesheet in `GeneVisualizer`, view + population controls and legend in `PetVisualization`, and the third `showTooltipForCell` branch in `GeneVisualizer` (§6).
- **Reference becomes map-first** (§7): full-genome rarity map as the default view, with animal-type, breed and baseline controls matching the other destinations; the gene-template editor demoted to a secondary mode. Includes the thin pet-less grid component the map needs.

**Explicitly out of scope for v1:**
- Community **tier** — using the shared catalogue as the *population* (needs a cached/aggregated baseline — §3). Distinct from scoring a community *pet* against your own pets, which is in scope above.
- Any ranked "scarcest loci" table on either surface (§1).
- Integration with #369 (let the player define "beneficial" and combine rare×desirable).
- #367 wild-horse capture analysis (a downstream consumer of this baseline).
- Any change to grid sizing/layout (§4 non-goal).

## 10. Testing

- **Pure unit** (`geneFrequency`): allele tallies (`D`→2, `x`→1, `R`→0); `?` excluded from numerator **and** denominator; `2 × knownPets` denominator; **`p_D + p_R === 1` as a property test over random populations**; the two §2 worked examples (20`x`+2`D` → p_R ≈ 0.45; 1`x`+21`D` → p_R ≈ 0.023) as explicit regression cases against genotype counting; all-unknown locus; missing locus (no synthetic fill); `rarityBucket` boundaries. **Monotonicity holds only for buckets 0–3 with carriers held above 1** — the sole-carrier override deliberately breaks monotonicity in frequency, so the property test must fix `carriers` before asserting it, or it will fail on exactly the behaviour §2 specifies.
- **Bucket 4 is reachable at every baseline size at or above the gate** — the regression guard for the flaw that made it count-based. Assert a sole carrier lands in bucket 4 at N=10, 20 and 40, and does **not** at N=3, 5 or 9, where it falls back to its frequency bucket rather than to missing data. A frequency-based `< 0.02` rule would fire at none of 10 or 20 (`1/20` and `1/40` both clear it) — which is the flaw. Also assert a *pure* and a *mixed* sole carrier land in the same bucket, and that the step fires symmetrically on the dominant arm.
- **Missing data must be synthesised.** The calibration collection has zero `?` genotypes, so fixtures have to construct partially-revealed pets deliberately: `?` cells excluded from both sides of the ratio, and the below-`minKnown` locus, which is the one that does *not* get `gene-unknown` for free (§4).
- **Uneven study depth within one local population.** A stable where some pets were studied at a lower Genetics level must yield **different `knownPets` at different loci**; assert the tooltip quotes the per-locus count rather than the population size, and that a locus dropping below `minKnown` renders as missing data while its neighbours still shade normally.
- **Service** (`computeRarityLookup`): species isolation (a mixed-species population yields only the requested species; the demo's beewasp must not leak into a horse baseline — the bug that motivated #433), `minKnown` gating in **alleles**.
- **Component/e2e:** the Rarity view button toggles the lens; a `D` cell gets only `--rarity-dom`, an `R` cell only `--rarity-rec`, an `x` cell **both**; missing-data cells get the dashed style; the population toggle recomputes; **the grid dimensions are identical across Attributes/Appearance/Rarity** (regression guard for the reverted layout churn).
- **Rarity is absent on the community preview** (§8) — local pets only.
- **Sole-carrier gate:** a sole carrier at a locus with ≥10 known pets lands in bucket 4; the same carrier at a locus with 9 falls back to its frequency bucket rather than to missing data.
- **Genome map** (§7): a locus renders the same colour on the map as it does on the grid of a pet that carries its scarce allele, **on the same half** — the strongest guard that the two surfaces share one scale and one orientation. A monomorphic locus (`carriers = 0`) renders **neutral**, not loud. Breed and baseline toggles recompute; the map renders with no pet loaded at all.
- **No cell paints a border colour in the rarity view, and every cell renders the same painted area** — measure a pure `D`, a pure `R` and an `x` cell and assert their filled regions are identical in size. `.gene-cell`'s unconditional `border: 2px solid` (4px on recessive) plus global `box-sizing: border-box` makes shrunken split cells an easy regression (§4).
- **The scenario the feature exists for:** a baseline where one `x` pet is the sole carrier of a scarce recessive among otherwise-`D` pets — assert that pet's cell lands in the rarest recessive bucket while the phenotypically identical pure-`D` pets stay at the neutral centre. This is the case no other view in the app can distinguish (§2).

## 11. Open questions for review

**Settled** (recorded here so the reasoning isn't relitigated):

- Rarity is measured per **allele**, not per displayed genotype — `x` is one of each, not a third value (§2).
- Mixed cells render **two-tone** on a **diverging** scale with a shared common centre (§2, §4).
- Arms are **purple = dominant, orange = recessive** (ColorBrewer `PuOr`, published colourblind-safe).
- Thresholds are **0.35 / 0.18 / 0.07**, with bucket 4 defined by **carrier count**, calibrated against a 37-Horse collection (§2).
- **Breed-scoped baselines: rejected** — every horse carries all 10 breeds' loci, so scoping to one breed discards most of the evidence for genes the whole collection holds (§8). The map's breed control is a *display* filter over the same species-wide baseline, not a population scope (§7).
- Bucket 4 fires **symmetrically on both arms**, and is **gated to loci with ≥10 known pets** — ungated it gets louder as the baseline shrinks, which is the mirror of the problem it was introduced to fix (§2).
- The viewed pet **is** included in its own denominator. The lens stays **local-pet only**: a community pet cannot be bred with, so scoring one has no action attached (§8).
- **Every cell carries the same neutral hairline in the rarity view** (§4); zygosity is solid-vs-split and the recessive 4px ring is dropped. Dropping borders entirely was tried and lost the grid's lattice.
- **The stats drawer stays mounted in the rarity view** — unmounting it resizes the grid (§4, §6).
- **Reference is map-first** (§7): full-genome map by default; the template editor becomes an `Edit` toggle on the map (click a cell for one gene, a row for a chromosome), deferred as single-user functionality. Map cells are always split on the §4 axis — recessive top-left, dominant bottom-right.
- **No mixed-share line in the tooltip** for now — it is a fact about breeding state, not rarity, and the tooltip already carries two arms plus effects. Revisit if the card feels thin, not before.
- **The cross-breed signal needs no dedicated affordance** — a pet's grid already shows every locus it carries, so not greying breed-inactive cells is the entire fix (§8).
- **No cell paints a border colour in the rarity view** (§4). Borders go `transparent` so fills reach the cell edge at unchanged geometry; zygosity is carried by solid-vs-split, and the recessive 4px ring is dropped in this view since hue already names the allele.

Still open:

1. **Recalibration** — the thresholds hold for a ~30-pet single-species collection. Whether they still hold at 200+ pets, or across a species with different locus structure, is unknown; worth re-running the §2 measurement once the community tier exists.
2. **Map density** — 45% of the map takes a notable-or-stronger tint (§7). Principled, but it is a lot of colour. Ship and look at it, or pre-emptively give the map its own threshold set?
