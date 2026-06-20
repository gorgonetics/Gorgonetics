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
- **GeneGrid swap goes first.** Lowest structural risk and self-contained — it isolates retiring the global `.gene-cell` circle CSS from the structural work.
- **E2E green every PR via testid aliases.** New components carry the old `data-testid`s forward so the existing suite keeps passing; the big e2e rewrite happens in the cutover PR.

Adoption PRs into the epic, in order:

1. **GeneGrid swap** — adopt `GeneGrid` in the pet view, Compare, and trio; retire the global `.gene-cell` circle rules in `GeneCell.svelte`; update `filterCSS.ts` selectors (`.gene-cell[data-attr]` → the new cell hook) and affected e2e.
2. **Library shell** — new `Library.svelte` (FilterBar + PetRow list + card/table density + multi-select) and `Workspace.svelte` (selection-aware lens host), wired as the flagged **My Pets** destination. Pets + Stable collapse into it.
3. **Workspace lenses** — fold Compare (2-pet) and Breed (rank → trio) into selection-driven lenses; preserve bulk-share and the trio breed/attribute filters.
4. **Relocate** — gene-template editing → **Reference** destination; Community → the shared Library+detail shell with a source switch.
5. **Cutover + cleanup** — flip top nav 6 → 3, delete dead components/panels (old MasterPanel/tab routing), rewrite e2e, regenerate screenshots, remove the flag.
