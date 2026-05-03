# Breeding Assistant — v1 Implementation Plan

**Status:** Design — not yet implemented
**Scope source:** `Project: Gorgonetics` Logseq page, section `2026-05-03: Breeding Assistant v1 — Scope`
**Target:** A new **Breeding** tab that ranks all eligible parent pairs (M × F, same species, both stabled) by expected offspring quality, with two complementary objectives: maximise positive-effect attribute genes; minimise mixed (`x`) genes.

---

## 1. Genetics model (reference)

| P1 × P2 | P(D) | P(x) | P(R) |
|---|---|---|---|
| D × D | 1 | 0 | 0 |
| D × R | 0 | 1 | 0 |
| D × x | ½ | ½ | 0 |
| R × R | 0 | 0 | 1 |
| R × x | 0 | ½ | ½ |
| x × x | ¼ | ½ | ¼ |

If either parent's allele at a locus is `?`, the offspring's allele at that locus is `?` (contributes 0 to EV[positive] and EV[mixed]; counted in EV[unknown]).

Expression follows the existing `getPetGeneStats` rule: `R` expresses recessive effect; `D` and `x` express dominant effect.

## 2. Per-pair output

```ts
interface BreedingPairResult {
  male: Pet;
  female: Pet;
  // Pure predictability — counted across every locus the parents share
  // (attribute + appearance + selector). Range [0, totalLoci].
  evMixed: number;
  // Expected positive-effect attribute genes broken down per attribute
  // (intelligence, toughness, ruggedness, enthusiasm, friendliness,
  // virility, plus species-specific temperament/ferocity).
  evPositiveByAttribute: Record<string, number>;
  // Convenience sum over attributes (sortable single column).
  evPositiveTotal: number;
  // Loci where either parent's gene type is `?`.
  evUnknown: number;
  // Loci compared (excludes breed-locked-to-other-breed for horse).
  totalLoci: number;
}
```

## 3. Data sources reused

- `pet_genes` projection (one row per gene) — already populated for every pet via the existing backfill. No genome JSON parsing on the hot path.
- `getParsedGenesCached(species)` — `gene_id → { dominantAttribute, dominantSign, recessiveAttribute, recessiveSign, breed }`.
- `isHorseBreedFiltered(species, offspringBreed, geneBreed)` — already in `geneService.ts`. Re-used to skip breed-locked horse genes when scoring against the player-selected offspring breed.
- `getAllAttributeNames(species)` — for per-attribute EV table columns.

## 4. New module surface

### `src/lib/utils/breedingGenetics.ts` (pure math, no I/O)
```ts
export interface AlleleDistribution { D: number; x: number; R: number; unknown: number; }

/** Combine parent gene types into the offspring allele distribution. */
export function offspringDistribution(p1: GeneType, p2: GeneType): AlleleDistribution;

/** P(offspring expresses a positive effect at this locus), given the gene record. */
export function positiveExpressionProbability(
  dist: AlleleDistribution,
  gene: ParsedGeneRecord,
): number;
```

### `src/lib/services/breedingService.ts` (DB-aware)
```ts
export async function rankBreedingPairs(opts: {
  species: string;
  offspringBreed?: string;
  pets: Pet[];          // pre-filtered: same species, stabled
}): Promise<BreedingPairResult[]>;
```
- Loads `pet_genes` for the union of input pets in one query.
- Loads `getParsedGenesCached(species)` once.
- For each (M, F) pair, walks the union of gene_ids, applies `offspringDistribution`, and accumulates the three EVs.

### `src/lib/stores/breeding.svelte.ts`
- `offspringBreed` (state)
- `eligiblePets` (derived from `pets` store: same species, stabled, filter by gender)
- `pairResults` (async derived)
- `sortColumn`, `sortDir`

### Components (`src/lib/components/breeding/`)
- `BreedingTab.svelte` — top-level layout with breed selector + results table.
- `BreedingBreedSelector.svelte` — global offspring-breed dropdown (horse only; hidden for beewasp).
- `BreedingPairTable.svelte` — sortable rows: male, female, EV[mixed], EV[positive] per attribute, EV[unknown].
- `BreedingPairRow.svelte` — one row, links into `selectPet` for either parent.

### TopBar / routing
- Add `'breeding'` to the `Tab` union in `src/lib/stores/pets.ts`.
- Add tab button in `TopBar.svelte` (between Stable and Compare, e.g. `🧬 Breed`).
- Mount `BreedingTab` in `MasterPanel.svelte` / `+page.svelte` when `activeTab === 'breeding'`.

## 5. Refactor opportunity (shared with Pet Comparison)

Both features need: "iterate the union of two pets' loci, with their gene types side-by-side". Today `comparisonService.diffGenomes` parses genome JSON; breeding will read `pet_genes`. Plan:

- Extract `loadPetLoci(petId): Promise<Map<gene_id, GeneType>>` from `pet_genes` (cheap, indexed read).
- Extract `walkPairLoci(a, b, fn)` helper that yields `(geneId, typeA, typeB)` for the union.

The comparison service can migrate onto this projection in a follow-up — not blocking for v1.

## 6. Tests

### Unit
- `tests/unit/breedingGenetics.test.js` — exhaustive coverage of the 6 (×2 symmetry) Mendelian combinations; unknown handling on either side; positive-expression probability for each attribute-sign combination.
- `tests/unit/breedingService.test.js` — seed in-memory DB with known gene effects + 2 male + 2 female pets; verify EVs against hand-computed expected values; verify breed-locked filtering.

### Performance
- `tests/unit/breedingService.perf.test.js` (PR 2) — synthesise the worst-case input (15 male + 15 female horses, ~1500 loci each = 225 pairs × ~1500 loci ≈ 340 k locus-comparisons) and assert `rankBreedingPairs` completes under a generous budget (e.g. 500 ms in CI). Goal is a **regression alarm**, not a tight bound — if a future change blows past it, we know to investigate. If the v1 implementation already fails this budget, that's the signal to apply gene pruning, bit-array encoding of the genome, or pre-aggregation; do **not** pre-optimise before measuring.

### E2E
- `tests/e2e/breeding.spec.js` — open Breeding tab, change offspring breed, sort by Toughness column, click into a parent.

## 7. Out of scope (v1 → v2)

- "Find best partner for selected pet" (one-sided ranking).
- Bottleneck hint per pair (chromosome/gene that drags score down).
- Multi-generation planning.
- Persisting suggested pairs / favourites.
- Pareto-front display / weighted composite score.
- Breed-feasibility warnings (depends on selector-gene mechanics).
- Selector-gene modelling (folded into future "genetic studies" feature).

---

## 8. PR breakdown

Five PRs, each independently reviewable and mergeable. Earlier PRs are pure or hidden behind a feature path that does not yet appear in the UI, so they cannot break user flows on their own.

### PR 1 — Pure genetics utility + types
**Files**
- `src/lib/types/index.ts` — add `AlleleDistribution`, `BreedingPairResult`.
- `src/lib/utils/breedingGenetics.ts` — `offspringDistribution`, `positiveExpressionProbability`.
- `tests/unit/breedingGenetics.test.js`.

**Reviewer focus:** correctness of the Mendelian table; symmetry; unknown handling; sign/expression rules match `getPetGeneStats`.

**Size:** ~200 LOC + tests. No UI.

---

### PR 2 — Breeding service layer
**Files**
- `src/lib/services/breedingService.ts` — `rankBreedingPairs`.
- `tests/unit/breedingService.test.js` — seed gene effects + pets in in-memory DB, hand-verify EVs.

**Depends on:** PR 1.

**Reviewer focus:** correct use of `pet_genes` projection (no genome JSON parse); breed-locked filtering via `isHorseBreedFiltered`; n×m loop is O(pairs × loci) and stays well under the 225-pair worst case.

**Size:** ~250 LOC + tests. Still no UI.

---

### PR 3 — Tab scaffold + store (no scoring UI yet)
**Files**
- `src/lib/stores/pets.ts` — extend `Tab` union with `'breeding'`.
- `src/lib/stores/breeding.svelte.ts` — new store.
- `src/lib/components/layout/TopBar.svelte` — new tab button.
- `src/lib/components/breeding/BreedingTab.svelte` — minimal placeholder ("Breeding assistant — N eligible pets").
- Routing wiring in `MasterPanel.svelte` / `+page.svelte`.
- Test: `tests/e2e/breeding.spec.js` — clicking the tab activates the placeholder.

**Depends on:** none functionally (PR 2 not strictly required for the placeholder), but ordering after PR 2 keeps the tab from landing empty in `main`.

**Reviewer focus:** tab plumbing matches existing tabs (Stable/Compare); store does not load anything heavy on mount; layout doesn't regress other tabs.

**Size:** ~150 LOC. Tiny.

---

### PR 4 — Breeding ranking UI
**Files**
- `src/lib/components/breeding/BreedingBreedSelector.svelte`.
- `src/lib/components/breeding/BreedingPairTable.svelte`.
- `src/lib/components/breeding/BreedingPairRow.svelte`.
- `BreedingTab.svelte` — wire selector + table to the store and `rankBreedingPairs`.
- E2E: extend `tests/e2e/breeding.spec.js` to cover sorting by a column and changing the offspring breed.

**Depends on:** PR 1, 2, 3.

**Reviewer focus:** sort interaction; breed selector hidden for non-horse species; empty/single-gender states; performance on the 15×15 worst case (should be instant).

**Size:** ~400 LOC + tests. The biggest PR — most of the user-visible surface.

---

### PR 5 — (Optional) Shared two-pet locus walker
**Files**
- `src/lib/utils/petLoci.ts` — `loadPetLoci`, `walkPairLoci`.
- Migrate `breedingService.ts` and `comparisonService.diffGenomes` onto it.
- Update existing comparison tests + add tests for the new utility.

**Depends on:** PR 1–4 merged. Pure refactor, no behavioural change.

**Reviewer focus:** the comparison test suite still passes unchanged; no perf regression on the comparison hot path.

**Size:** ~200 LOC net (mostly code movement).

**Decision point:** can be skipped if the duplication is judged trivial after PR 4 lands. Listed last so v1 ships without it.

---

## 9. Open questions deferred to implementation time

- Whether PR 5 is worth doing standalone, or rolled into PR 2 ("build it shared from the start"). Lean toward standalone — keeps PR 2 focused on breeding semantics; comparison-side migration can land separately.
- Whether the offspring-breed selector should default to "Mixed" or to the most common breed in the eligible pet set. (Lean: "Mixed", as it has no breed-locked filtering and surfaces the most pairs.)
- Whether pairs with `evUnknown == totalLoci` should be hidden by default. (Lean: no — surface them with the count visible; let the player filter.)
