# UI Redesign — Library + Workspace (v1 Scope)

**Status:** Scoping — not yet implemented
**Branch:** `redesign/scoping`
**Goal:** Replace the tool-oriented six-tab layout with a task-oriented **Library + Workspace** model, and collapse the redundant, inconsistent surfaces into a single shared component vocabulary.

This document is the agreed scope before any code changes. It is evidence-based: every "current state" claim was verified by driving the running app (screenshots archived for this session).

---

## 1. Current-state audit

Top-level tabs today: **Pets · Genes · Stable · Breed · Compare · Community**, a collapsible left "master panel," and a top bar (back-arrow, Data, Settings).

### 1.1 The left "master panel" is overloaded and half-empty
| Tab | Left panel contents |
|---|---|
| Pets | Pet list (cards) ✓ |
| Genes | Animal-type + chromosome dropdowns ✓ (unrelated to pets) |
| Compare | Pet A / Pet B picker + list ✓ |
| Stable | **empty** (~260px dead space) |
| Breed | **empty** |
| Community | **empty** — and it rebuilds its own master-detail *inside* the content area |

Meaningful on 3/6 tabs, empty on 3/6, and Community duplicates the master-detail pattern the panel was meant to provide.

### 1.2 "List of pets" is re-implemented five ways
Pets sidebar cards · Compare A/B picker · Stable table · Breed pair-table · Community table — each with its own search/filter affordances and row layout. No shared pet-row.

### 1.3 No single filter language
- **Species:** per-card text (Pets) vs segmented "Beewasp/Horse" (Stable) vs a differently-styled toggle (Breed); Pets has no species filter at all.
- **Breed:** a `<select>` dropdown (Stable filter, Breed-tab "offspring breed") *and* a button row (pet gene grid, Compare diff controls, Trio view) — 3–4 controls for one concept.
- **Flags:** Starred / Stabled / Pet-quality are pills in some places; Gender/Breed are dropdowns in others.

### 1.4 Gene grid renders differently by context
Circles + dual legend (Effect colour + Value zygosity) on Pets; squares on Compare/Trio. Same data, different visual language.

### 1.5 Inconsistent page headers
Pets/Genes: none. Stable: plain "Stable". Breed: "💞 Breeding Assistant" + subtitle. Community: "Community catalogue" + subtitle.

### 1.6 Confirmed bug
The **Genes** tab shows the **Pets** empty-state copy ("Select a pet to view details, or upload a new genome file"), which is meaningless for gene-template editing.

### Root cause
Navigation is organised by *tool* (Stable / Breed / Compare are all "view pets through a lens"), and the left panel's meaning changes per tab. Pets and Stable are two views of one dataset; Breed and Stable tables are near-identical; "Genes" is per-species **template editing** — config, not a pet view.

---

## 2. Target model — Library + Workspace

```
┌─ Library (persistent left) ─┐┌─ Workspace (main, lens for selection) ──────┐
│ one search + filter bar     ││  selection-aware lens tabs:                  │
│ ┌ density: [cards | table]┐ ││  0 sel → overview / prompt                   │
│ │ ▸ Sample Fae Bee   ★    │ ││  1 sel → Genes · Appearance · Stats ·        │
│ │ ▸ Sample Horse          │ ││          Gallery · Share                     │
│ │ ▸ Roach            ☑     │ ││  2 sel → Compare                             │
│ └─────────────────────────┘ ││  N stabled → Breed-rank → (inspect) Trio     │
│ multi-select → bulk actions ││                                              │
└─────────────────────────────┘└──────────────────────────────────────────────┘
```

### 2.1 The Library (left, persistent)
- **One** pet list with **one** filter bar: species, gender, breed, starred, stabled, pet-quality, tags, name search.
- **Density toggle: cards ↔ table.** "Stable" stops being a separate tab — it is the table density of the Library (with attribute columns). Card density replaces the current Pets sidebar.
- **Multi-select** (checkboxes), reusing the selection model already built for bulk-share. Selection count drives the Workspace.
- Persists across lenses (selecting pets is how you drive every lens).

### 2.2 The Workspace (main, selection-aware lenses)
- **1 pet selected** → the lenses that are *already* the pet-detail view-controls today: **Genes** (gene grid), **Appearance**, **Stats**, **Gallery**, **Share**.
- **2 pets selected** → **Compare** lens (head-to-head genome diff). Replaces the Compare tab + its bespoke A/B picker.
- **Many / all stabled** → **Breed-rank** lens (the ranking table), and inspecting a pair opens the **Trio** lens. Replaces the Breed tab.
- **0 selected** → an overview/prompt (proper empty-state copy per context).

### 2.3 Separate destinations (not pet lenses)
- **Community** — browsing *other players'* pets is a different mental mode (a remote source, import flow). Keep it a distinct destination, but render it through the **same** Library+detail shell (source = community) so it stops reinventing master-detail.
- **Gene templates** (today's "Genes" tab) — per-species/chromosome config. Move under a **Reference / Settings** area; it is not a peer of pet views.

---

## 3. Component unification inventory

The redesign's real work is collapsing N variants into 1 each. Build these shared primitives first (behind the current tabs, no IA change) so each is independently testable:

| New primitive | Replaces | Notes |
|---|---|---|
| `PetRow` | 5 list/row/card renderings | density variants (card / table-row); optional columns + action slots |
| `FilterBar` | Stable filters, Pets pills, per-view filters | one control vocabulary (see §4) |
| `BreedSelector` | dropdown ×2 + button-row ×3 | **popover trigger**; used in filters AND lenses (trio offspring breed, compare breed filter) |
| `GeneGrid` | circles (Pets) vs squares (Compare/Trio) | **squares + dual encoding (effect colour / zygosity fill), one compact legend** |
| `PageHeader` | 4 ad-hoc header styles | title / subtitle / actions slot |
| `EmptyState` | reused-wrongly Pets copy | context-appropriate copy; fixes §1.6 |
| `MasterDetailShell` | Community's in-content master-detail | Library + detail used everywhere |

---

## 4. Resolved decisions

Settled 2026-06-20:

1. **Breed control** → a single **popover trigger** ("Breed: All ▾" opening a name+abbreviation list). One `BreedSelector` used in the filter bar and in lenses (Trio offspring breed, Compare breed filter). Retires the dropdown and the 11-wide button row.
2. **Gene grid** → **squares** (denser; already proven on the 48-chromosome horse genome in Compare/Trio), keeping the **dual encoding** (colour = effect, fill/zygosity = value) under **one consistent compact legend**. Retires the circle rendering on Pets.
3. **Community** → the **same Library + detail shell with a local↔community source switch**. `PetRow` carries source-specific columns/actions (uploader/date/import for community; star/edit/stable for local).
4. **Gene-template editing** → a top-level **Reference destination** (per-species/chromosome editor), not buried in Settings.
5. **Narrow window** → Library becomes a **collapsible overlay drawer** (extending the existing collapse chevron); Workspace goes full-width. No separate mobile/stacked flow for v1.
6. **Selection → Breed lens** → Breed-rank defaults to **all stabled of the species**, and **scopes to the selection when 2+ are selected**. Compare requires exactly 2. 0–1 selected → all-stabled ranking.

---

## 5. Migration order (each step shippable, tests green)

1. **Primitives** — `PetRow`, `FilterBar`, `BreedSelector`, `GeneGrid` consolidation, `PageHeader`, `EmptyState`. Land behind current tabs; no IA change. Unit/visual tests per primitive.
2. **Library shell** — introduce Library; make Pets + Stable two densities of it. Migrate filters to `FilterBar`.
3. **Workspace lenses** — fold Compare and Breed into selection-driven lenses; preserve the just-shipped **bulk-share** and **Trio breed/attribute filter** features as lenses.
4. **Relocate** — gene templates → Reference; Community → shared shell.
5. **Cleanup** — remove dead tabs/panels; fix empty-states; update e2e selectors + docs screenshots.

---

## 6. Risks
- **Large surface** — touches every screen. Mitigate via §5's incremental, independently-shippable steps.
- **E2E churn** — many `data-testid` selectors will move; keep/alias testids per step so suites stay green.
- **Feature regressions** — the recent Trio view and bulk-share must survive as first-class lenses, not be lost in the restructure.
- **Don't fabricate game facts** — any new copy about Project Gorgon mechanics stays verified or omitted (per CLAUDE.md).

---

## 7. Adoption plan

The six primitives (§5 step 1) are built and merged into the `redesign/library-workspace` epic. Adoption (§5 steps 2–5) changes the live app, so it follows three settled rules (2026-06-20):

- **Parallel build, single flip.** The new shell is built as a hidden/flagged **My Pets** destination *alongside* the existing tabs. Every lens is migrated against it while the old app stays fully working; a final PR flips the nav 6 → 3 destinations and deletes the old paths. The epic stays shippable throughout.
- **E2E green every PR via testid aliases.** New components carry the old `data-testid`s forward so the existing suite keeps passing; the big e2e rewrite happens in the cutover PR.
- **GeneGrid swap is deferred to a parity pass.** Originally planned first, but on starting it we found the live grids need feature parity GeneGrid doesn't have yet (appearance view, hover/focus tooltips, breed-inactive styling, `filterCSS` dimming, and the trio's multi-segment *distribution bars*). Retiring the global `.gene-cell` circle CSS requires that parity, so the swap moved after the structural work. Until then the new Workspace embeds the existing `PetVisualization` unchanged.

Adoption PRs into the epic, in the **actual order** (reordered 2026-06-20 per the parity finding):

1. **Library shell** *(done — PR #327)* — `Library.svelte` (FilterBar + PetRow list + card/table density + multi-select) in the left panel + selection-aware `Workspace.svelte` in the main area, wired as the flagged **My Pets** destination. 1-pet → existing `PetVisualization`. Extended shared `petFilter` with species/breed/pet-quality.
2. **Workspace lenses** *(next)* — fold Compare (2-pet) and Breed (rank → trio) into selection-driven lenses in the Workspace; preserve bulk-share and the trio breed/attribute filters. Absorb the Stable table as the Library's table density.
3. **Relocate** — gene-template editing → **Reference** destination; Community → the shared Library+detail shell with a source switch.
4. **GeneGrid parity + swap** — bring `GeneGrid` to parity (appearance, tooltips, breed-inactive, filter dimming, distribution bars), adopt it in the pet/Compare/trio views, retire the global `.gene-cell` circle rules + update `filterCSS.ts` selectors.
5. **Cutover + cleanup** — flip top nav 6 → 3, delete dead components/panels (old MasterPanel/tab routing), rewrite e2e, regenerate screenshots, remove the flag.

---

## 8. Progress & resume (updated 2026-06-21)

**Branch topology.** Integration branch: **`redesign/library-workspace`** (the epic), based on `main` + this doc. Every redesign PR targets the epic; CI runs on epic PRs because `redesign/**` was added to the `ci.yml`/`integration.yml` triggers (drop that before the epic→main cutover if undesired). Final step is one `redesign/library-workspace → main` PR.

**Try the new shell.** Run the app and append `?redesign=1` (persists via `localStorage['gorgonetics:redesign']`; `?redesign=0` clears it). The **✨ My Pets** and **📚 Reference** destinations appear in the top nav. Normal users never see them until cutover.

**Done & merged into the epic:**
- Primitives (all 6): `BreedSelector` (#322), `EmptyState`+`PageHeader` (#323), `PetRow` (#324), `FilterBar` (#325), `GeneGrid` (#326) — in `src/lib/components/shared/`, each unit-tested.
- CI triggers for `redesign/**`.
- **Slice 1** — Library + Workspace shell (#327): left `Library.svelte` (FilterBar + PetRow list + density + multi-select on `libraryView`), selection-aware `Workspace.svelte`, `Roster.svelte` (absorbs Stable), `BreedLens.svelte`. Stores `library.svelte.ts`, `flags.ts`; extended `petFilter.ts`. MasterPanel/+page/TopBar route the flagged `library`/`reference` tabs.
- **Slice 2** — Workspace lenses: 0 selected → Roster; 1 → PetVisualization; 2+ same-species → Compare/Breed lens tabs (lens resets on empty selection, #329); mixed-species → guidance. Copilot fixes #328/#329.
- **Slice 3** — Community shell (#3xx): `CommunityTab` uses shared `PageHeader`+`EmptyState`.
- **Slice 4** — squares unification: Compare (#333 → 4a), Pets (#334 → 4b), then **trio + retire the circle default** (#335 → 4c). The base `.gene-cell` is now square (`border-radius: 3px`); the `gene-cell--square` modifier is gone. e2e polls computed `border-radius` to guard the shape (Copilot #335).

**Parity slices (done) — feature gaps that blocked the cutover:**
A full old→new capability audit (PetList/PetCard/Stable/Compare/Breeding/editor/Community) found the new shell was missing several capabilities. Closed before flipping:
- **CRUD** (#336): shared `PetActions.svelte` (icon variant on library rows, button variant in the workspace header) reusing the existing `PetEditor` modal + delete-confirm.
- **Upload/auto-scan** (#337): `createGenomeUploadController` (`genomeUploadController.svelte.ts`) wired into the Library — manual upload, drag-drop overlay, manual auto-scan + pending badge. (Automatic startup scan already survived via `AuthWrapper`.)
- **Bulk-share** (#338): Library selection footer hosts 🌐 Share via `BulkSharePetDialog`, driven off `libraryView.selectedIds`. Select-all lives in the Roster.
- Dropped per decision: pet drag-reorder, keyboard arrow-nav between pets.
- Not lost: per-pet star/stabled/tags are editable via the `PetActions` editor modal (one extra click vs the old inline toggle).

**Slice 5b (flip) — done:** nav is now the **3 destinations** (My Pets / Community / Reference), un-gated; default `activeTab='library'`. e2e migrated: deleted the superseded `stable-table`/`comparison`/`breeding`/`drop-upload` specs; ported their unique coverage into new `redesign-roster`/`redesign-breed-lens` specs and the Compare-lens diff-summary regression into `redesign-library`; repointed `pet-crud`/`app`/`keyboard`/`gallery`/`community`/`layout-debug` onto the new nav (helpers `gotoDestination`/`waitForPets`/`openEditor` updated). Full suite green (106 passed).

**Resume here — slice 5c (cleanup), the last slice:**
1. Delete the now-dead components + routing: `PetList`/`PetCard`/`StableTable`/`ComparisonView`/`ComparisonPetPicker`/`BreedingTab` and their `+page.svelte`/`MasterPanel.svelte` branches; the `redesignEnabled` flag + `flags.ts` (+ `?redesign` handling); the still-`.skip`ped `perf-comparison.spec`.
2. Regenerate screenshots; update website/docs; drop `redesign/**` from CI triggers if undesired.
3. Final `redesign/library-workspace → main` PR.

**Watch-outs:** the old `Tab` union still carries `pets`/`editor`/`compare`/`stable`/`breeding` values + `TAB_STATE_RESETS` entries — prune them with the components in 5c. Community still mounts its purpose-built `CommunityPetTable` (role=grid, remote columnar data); the source-switch shell stays deferred — decide in 5c whether it's worth unifying.
