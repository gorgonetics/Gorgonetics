# Gene Value Filter — v1 Design

**Status:** Proposed — not yet implemented. For review.
**Issue:** #369 (advanced pet filtering by values on a subset of genes).
**Related:** #465 (compose with rarity — "rare AND desirable", blocked on this), #368 (gene rarity lens — shipped for the local tiers; supplies the population machinery reused here), #367 (wild-horse analysis — future consumer).

---

## 1. Goal

Answer **"which of my pets carry the alleles I care about?"** across the whole collection, instead of opening pets one at a time and reading their genome grids.

The question is a property of a *pet*, so the answer belongs on the **roster** — it narrows the pet list, the same way species/breed/tag filters already do. It is not a new view of a genome.

This is the half #465 needs. The rarity lens (#368) tells you an allele is *scarce*; this tells you it is *the one you want*. Neither alone answers "keep or release" — §9 of `gene-rarity-lens-v1.md` deferred the combination to #369 precisely because "desirable" had no definition anywhere in the app. This design gives it one.

## 2. Core concept: a criterion is a set of allowed states

A gene's value is not a number. `GeneType` has exactly four members:

```
D  dominant     R  recessive     x  mixed     ?  unknown
```

So #369's open question — "exact value match, range/threshold, or has-this-gene-at-all?" — is the wrong axis. Range and threshold have no meaning over four unordered states. The question that *does* matter is **express vs carry**, and it exists because of `x`.

`x` is **one copy of each allele**, and `getPetGeneStats` / `breedingGenetics.ts` treat it as dominant for effect purposes (`GeneTooltip` labels it "Mixed (treated as dominant)"). A pure-`D` pet and an `x` pet are therefore phenotypically identical, and the recessive allele hiding in the `x` pet is invisible in every view except the rarity lens.

That gives two genuinely different questions a player asks:

| question | which pets |
|---|---|
| "which pets **show** the recessive trait?" | pure `R` only |
| "which pets can I **breed** the recessive out of?" | `R` **and** `x` — both carry the allele |

A criterion is therefore **a subset of `{D, R, x}`** — the states that satisfy it. Both questions fall out without a mode switch:

```
criterion(L) = { R }      → pure recessive        (expresses R)
criterion(L) = { R, x }   → carries R             (the breeding-relevant one)
criterion(L) = { D, x }   → expresses D
criterion(L) = { D }      → pure dominant         (breeds true for D)
```

`{D, R, x}` (all three) is not a filter — it is the absence of one, and the UI should render it as "any" rather than as a criterion with three ticks.

**Why this framing and not a `carry`/`express` toggle.** A mode flag would need to be per-criterion (you may want carriers at one locus and pure at another), so it is the same information with an extra concept bolted on. The state set is also directly what the predicate tests, so there is no translation layer between what the UI shows and what the filter does.

## 3. `?` is missing data, and it is the trap in this feature

A locus reads `?` because the owner's Genetics level had not revealed it when that pet was studied. It is **not** a value, and it is **not** "this pet lacks the gene" — see `project-genetics-skill-unknown-genes` and §2 of `gene-rarity-lens-v1.md`, which excludes `?` from both sides of every ratio for the same reason.

So: **`?` never satisfies a criterion.** `allow` is a subset of `{D, R, x}`; a pet reading `?` at a filtered locus fails, because we cannot assert it matches.

That rule is correct and, on its own, produces a feature that looks broken:

> Gene visibility is skill-gated, and the gate is **uniform across a collection**. If the player's Genetics level has not revealed locus `12B3`, then *every* pet reads `?` there. A filter on `12B3` returns **zero pets** — not because they lack the allele, but because nobody has looked.

An empty roster with no explanation reads as "you have no pets like this", which is the opposite of the truth. So the count of pets excluded for unknown-ness is **part of the result, not a detail**:

```
Matches 7 of 31 pets
4 excluded — locus not revealed on those pets
```

And when *every* candidate is excluded that way, the empty state must say so explicitly rather than rendering the generic "no pets match" — the actionable advice is "re-study these pets", which no generic empty state can give. This mirrors §3's rule for the rarity baseline: misses must not shrink the denominator silently.

## 4. Two kinds of criterion, ANDed

There are **two** criterion kinds, because measurement of the horse data showed a single kind cannot serve both intents:

| kind | source | satisfied when |
|---|---|---|
| **Locus** | hand-picked / map click (§5b) | the pet's state at that locus is in `allow` |
| **Attribute** | attribute expansion (§5a) | the pet matches **at least `min`** of the attribute's loci |

Criteria are combined with **AND** — a pet must satisfy every one.

- It is what the question means. "Find me a mate with the recessive at these three loci" is a conjunction; a pet matching one of three is not a useful answer.
- It matches the existing filter vocabulary: `petFilter.ts` already ANDs tags (`filters.tags.every(...)`), and every other roster control narrows.
- OR is recoverable by running the filter twice; AND is not recoverable from an OR filter.

**Why an attribute is not just N locus criteria.** Measured on the bundled horse data (`assets/horse/*.json`, 1576 loci):

| attribute | loci affecting it | with a clean positive allele |
|---|---|---|
| Intelligence | 155 | 112 |
| Toughness | 124 | 86 |
| Ruggedness | 122 | 88 |
| Virility | 122 | 91 |
| Enthusiasm | 121 | 87 |
| Friendliness | 120 | 86 |
| Temperament | 112 | 77 |
| Ferocity | 0 | 0 |

Expanding "Toughness" into 86 ANDed locus criteria demands a pet carrying the good allele at *every one* — which no pet will satisfy, so the filter would reliably return an empty roster. The conjunction is not merely strict, it is unusable, and no cap on expansion size fixes it: capping to 10 arbitrary loci out of 86 answers a question nobody asked.

An attribute is therefore a **count with a threshold**, and the count is the useful artefact in its own right — see §5a.

(Ferocity reads 0 for horses because it is a beewasp attribute. The zero-loci case in §8 is real, not hypothetical.)

No configurable AND/OR toggle in v1. It doubles the UI and the test matrix to serve a question nobody has asked yet.

## 5. Choosing the loci

The hard part. A horse genome carries ~1576 known loci, so any UI that starts from "pick genes" is unusable. Two paths, serving different intents:

### 5a. By attribute (primary)

The way players actually think: *"I want tougher horses"*, not *"I want `R` at `04C2`"*.

Pick an attribute, and the app resolves it to the loci carrying a beneficial allele, then **counts** how many of them each pet satisfies. The threshold is what filters:

```
Attribute: [Toughness ▾]        86 scoring loci
Want:  ( ) expresses the good allele
       (•) carries the good allele
       ( ) pure for the good allele

Carries at least [ 52 ] ────●────  of 86

Matches 7 of 31 pets · 4 excluded (not revealed)
```

**The count is the deliverable, not just the gate.** "How many good Toughness alleles does this pet carry" is the ranking a breeder actually wants, so an active attribute criterion also contributes a **sortable roster column** (`Toughness 61/86`). The threshold then becomes a convenience over a column the player can already read and sort by — and a player who does not know what threshold to ask for can sort instead, which is the more common case.

The slider's default sits at the population median rather than at a fixed number: a threshold of 52 means nothing until you know whether that is exceptional or typical for this collection, and the median guarantees the filter opens showing roughly half the roster instead of zero or all of it.

The expansion uses machinery that already exists in `geneGridCells.ts`:

- `attributesForGene(geneId)` — the attributes a locus can affect via *either* allele.
- `analyzeGene(geneId, type)` — the effect valence for a given allele: `positive`, `negative`, `neutral`, `potential-positive`, `potential-negative`.

For each locus affecting the chosen attribute, evaluate `analyzeGene(geneId, 'D')` and `analyzeGene(geneId, 'R')`, take whichever allele is positive, and translate the want into an allowed state set (`carries` → `{allele, x}`, `expresses` → `{allele}` plus `x` when the allele is `D`, `pure` → `{allele}`).

**Two known weaknesses in that data, both inherited:**

1. **Valence is string matching.** `analyzeGene` decides positive/negative by `effectStr.includes('+')` / `includes('-')` on free-text effect strings. A malformed or unusual effect string silently reads as neutral.
2. **`analyzeGene` reports only the first matching attribute** — it `break`s out of the attribute loop. A locus affecting two attributes reports one. **This design must use `attributesForGene` (which returns the full set) for expansion, never `analyzeGene(...).attribute`** — reusing the latter would silently drop loci from an attribute's expansion.

Both are pre-existing and out of scope to fix here, but they cap how much trust the attribute path can carry, and they are the main reason the map path below is not optional.

**Potential effects** (`potential-positive` / `potential-negative`, i.e. effect strings containing `?` or "potential") are **excluded from the expansion by default**, with a checkbox to include them. Treating a maybe-beneficial allele as beneficial is exactly the kind of quiet overclaim that makes a filter untrustworthy.

### 5b. By clicking the genome map (refinement)

The Reference destination's genome map already renders every locus for a species, at the same cell pitch as the pet grid. Clicking a cell adds a criterion for that locus; the criterion chip then exposes the `{D, R, x}` toggles directly.

This is the escape hatch for everything the attribute path cannot express — a specific locus a player has learned matters, an appearance gene, or a locus whose effect string the valence heuristic reads wrong. It is also the only path that works for loci with no attribute effect at all (appearance genes).

The two paths compose by ANDing: a Toughness threshold *and* a specific locus the player insists on. Map-added loci are always their own criteria — they are never folded into an attribute's locus list, so removing the attribute never silently removes a locus the player picked deliberately.

### 5c. Species scoping is mandatory

Gene ids are only comparable **within a species** — `01A1` names a different locus for a horse than for a beewasp (`gene-rarity-lens-v1.md` §2 makes the same point for rarity baselines). The roster shows mixed species by default.

So a gene criterion carries a species, and **activating gene criteria sets the roster's species filter to that species and locks it** while criteria are active. The alternative — silently excluding every pet of another species — produces a roster that has quietly become single-species with no visible reason.

## 6. Where it lives

A collapsible **Genes** section in the My Pets `FilterBar`, below the existing controls. Collapsed by default and showing a count when active (`Genes (3)`), because it is a power feature and must not crowd the common path.

The result is the roster itself: fewer rows. No new destination, no new view mode.

One chip per criterion — **not** one per locus. An attribute criterion is a single chip carrying its threshold; only hand-picked loci get their own.

```
Toughness · carries ≥52 of 86        [edit] [×]
12B3 · D only                               [×]
```

Rendering an 86-locus expansion as 86 chips would bury the two hand-picked loci that the player actually reasoned about, and there is nothing useful to do with an individual chip inside an expansion — the threshold is the control. `[edit]` opens the expansion (want + threshold, and the locus list read-only for inspection).

An expansion is snapshotted at creation (§11.1), so the chip is a stable object rather than a live query.

**Keep valence and rarity visually separate** — #465's constraint from §6 of the rarity design. This feature ships no rarity colour at all, so the constraint is trivially satisfied in v1, but the chip design must not adopt the purple/orange rarity hues for "good/bad allele", or #465 will inherit a collision it cannot undo.

## 7. Data flow

The problem: `petFilter.ts` is pure and synchronous over `Pet[]`, and `Pet` carries no gene data. Gene values live in `pet_genes`, behind an async read.

The resolution — the predicate stays sync; the data is loaded once and injected:

```
MyPets
  $effect: geneCriteria active?
      → loadAllPetLoci(petIds)        ← one query for N pets, already exists
      → cache in a store, keyed on sorted pet ids
  $derived: filterPets(pets, filters, loci)
      → petMatchesFilters stays pure and unit-testable
```

`loadAllPetLoci` (in `petLoci.ts`) already does exactly what is needed: a single `WHERE pet_id IN (…)` read returning `Map<petId, Map<geneId, GeneType>>`, with inline populate-and-retry for legacy pets whose projection was never written. Nothing new is required at the data layer.

Caching follows `frequencyService`'s precedent — key on the **sorted pet id set**, not array identity, so a background reload of the pet list does not re-read `pet_genes`. A small bounded cache (`MAX_CACHED = 4` there) is the model.

Signature change, additive so every existing caller is untouched:

```ts
export interface PetListFilters {
  …existing…
  /** Gene criteria, ANDed. Empty means no gene filtering. */
  geneCriteria?: GeneCriterion[];
}

/** Allowed states. A subset of {D, R, x}; '?' is never allowed (§3). */
export type AllowedStates = GeneType[];

export type GeneCriterion =
  /** One locus must match. */
  | { kind: 'locus'; geneId: string; allow: AllowedStates }
  /** At least `min` of `loci` must match — see §4/§5a. */
  | {
      kind: 'attribute';
      attribute: string;
      /** Resolved at expansion time and snapshotted (§11.1). */
      loci: { geneId: string; allow: AllowedStates }[];
      min: number;
    };

/** Per-attribute match count for the roster column, alongside the verdict. */
export function petGeneMatchCounts(
  pet: Pet,
  criteria: GeneCriterion[],
  loci: ReadonlyMap<number, PetLoci>,
): Map<string, { matched: number; total: number; unrevealed: number }>;

export function petMatchesFilters(
  pet: Pet,
  filters: PetListFilters,
  loci?: ReadonlyMap<number, PetLoci>,
): boolean;
```

`loci` is optional: when `geneCriteria` is empty the argument is unused, so no caller has to supply it and no surface pays for a feature it does not use.

**Scale.** ~1576 loci × ~30 pets ≈ 47k map entries, one query, held in memory. Rebuilt only when the pet set changes. The per-pet predicate is `criteria.length` map lookups — negligible next to the existing string search.

## 8. Edge cases

- **Pet with no projection at all.** `loadAllPetLoci` omits pets with no rows (its doc is explicit that `map.has(id)` is the check, not `map.get(id)`). Such a pet fails every criterion, and is reported **separately from `?`** — "not yet imported" is a different fix from "not yet studied".
- **Locus absent from a pet's map.** Same as `?` — a genome studied to a shallower depth simply has no row. Fails, counted as not-revealed.
- **Criterion on a locus that does not exist for the species.** Possible via a stale saved filter after a species switch. Treat as not-revealed for every pet, and surface it as an invalid criterion rather than an empty roster.
- **All three states allowed.** Not a filter; normalise to "any" and drop the criterion rather than evaluating it.
- **No states allowed.** Empty `allow` matches nothing. Disallow at the UI level; the predicate must still handle it without pretending it means "any".
- **Attribute expansion yields zero loci.** Real, not hypothetical: Ferocity has 0 loci in the horse data (§4). Say so — do not present an empty criterion set as an active filter, and do not offer the attribute for a species where it scores nothing.
- **Mixed-species roster.** Covered by §5c: species is forced while criteria are active.

## 9. Scope

**v1 (this design):**
- `GeneCriterion` model (both kinds) + `petMatchesFilters` extension (pure, unit-tested).
- Loci store with sorted-id caching, feeding MyPets.
- FilterBar "Genes" section: attribute expansion with threshold (§5a) and locus chips (§6).
- Sortable per-attribute match-count roster column while an attribute criterion is active (§5a).
- Genome-map click-to-add (§5b).
- Not-revealed / not-imported exclusion counts surfaced in the result (§3).
- Species forcing (§5c).

**Explicitly out of scope:**
- **Rarity composition (#465)** — this design deliberately ships no rarity colour, so the two can be combined without undoing anything here.
- Configurable AND/OR (§4).
- Saved/named filters. Criteria live in `myPetsView` and survive tab switches like every other filter; they do not persist across restarts in v1.
- Filtering the **community catalogue** by gene values — the catalogue's genomes are not local, and `listPets` never fetches them (`gene-rarity-lens-v1.md` §3).
- Fixing the valence heuristics (§5a) — inherited, capped, and worth its own issue.
- Numeric **attribute** filtering (0–100 pet attributes). Different data, different UI; not what #369 asks for.

## 10. Testing

- **Pure unit** (`petMatchesFilters` + criteria): each of the four state-set shapes from §2 against a pet reading `D`, `R`, `x` and `?` — a 4×4 truth table, since this is the entire semantic core. Explicitly: `{R, x}` matches an `x` pet and `{R}` does not — the express/carry distinction, and the case every other view in the app cannot make.
- **`?` never matches**, for every state set including `{D, R, x}` before normalisation. A pet reading `?` must fail even a criterion that allows all three real states.
- **Absent locus behaves as `?`**, and a pet missing from the loci map entirely fails without throwing — the two different "no data" paths from §8, which must not be conflated in the counts.
- **AND across criteria**: a pet satisfying 2 of 3 fails; order of criteria is irrelevant.
- **Attribute threshold arithmetic**: a pet matching exactly `min` passes and `min - 1` fails (boundary); `min = 0` matches every pet including one with no revealed loci; `min = total` is the conjunction the §4 table shows is unusable, and must still evaluate correctly rather than being special-cased away.
- **Unrevealed loci do not inflate the count.** A pet reading `?` at 30 of 86 Toughness loci scores out of 86, not out of 56 — the count and the threshold must share a denominator, or a poorly-studied pet ranks above a well-studied one by having fewer chances to fail. This is the §3 rule applied to the count, and it is the most likely subtle bug in the feature.
- **A 124-locus expansion evaluates without pathological cost** — the realistic size from the §4 table, not a 3-locus toy.
- **Exclusion counts are correct and distinguish their causes** — not-revealed vs not-imported reported separately, and their sum plus matches equals the candidate count. This is the assertion that stops §3's empty-roster trap from regressing into a silent zero.
- **Attribute expansion** uses `attributesForGene`, not `analyzeGene(...).attribute`: construct a locus whose effect string names two attributes and assert it appears in **both** expansions. This is the §5a weakness that would otherwise silently drop loci. Guard the real counts too — a regression that halves an expansion is invisible without them (§4 table).
- **Potential effects excluded by default**, included when opted in.
- **Species scoping**: a horse criterion never evaluates against a beewasp; activating criteria forces the species filter; a criterion for a locus absent from the species surfaces as invalid rather than as zero matches.
- **Loci cache** keyed on the sorted id set: reordering the pet array does not trigger a re-read; adding a pet does.
- **Component/e2e:** expanding an attribute populates chips; removing a chip re-widens the roster; the roster row count matches the reported match count (the #405 rule — one filter result, shared, so table and bulk-selection cannot disagree); the not-revealed empty state renders its own copy rather than the generic one.

## 11. Open questions for review

**Settled** (recorded so the reasoning is not relitigated):

- A criterion is a **subset of `{D, R, x}`**, not a value plus a match mode — §2. Express vs carry is the real axis; range/threshold is meaningless over four unordered states.
- **`?` never matches**, and the exclusion count is part of the result — §3. Skill-gating is uniform across a collection, so a filter on an unrevealed locus returns zero pets for a reason that has nothing to do with the pets.
- **AND**, not configurable — §4.
- The filter narrows the **roster**, not a genome view — §1, §6.
- **Both** selection paths ship: attribute expansion is primary, map clicking is the escape hatch the valence heuristics make necessary — §5.

**Open:**

1. **Should an attribute expansion track the effects DB, or snapshot it?** If a gene template is edited in Reference while a Toughness expansion is active, does the criterion set change under the player? Snapshotting is predictable; tracking is consistent. Leaning snapshot, with the chip showing it can be re-expanded.
2. **Does "carries" mean the same thing on the dominant arm?** `{D, x}` is "expresses D" and `{D}` is "pure D" — there is no state that means "carries D but does not express it", because carrying one D always expresses it. The three-way want control (§5a) is therefore asymmetric between the arms: on the dominant side, "carries" and "expresses" are the same set. Options: hide the redundant option per-arm, or accept the redundancy for a uniform control.
3. ~~How many loci is an attribute expansion allowed to add?~~ **Answered by measurement** — an expansion is 112–155 loci (§4), which is why the attribute kind is a threshold rather than a conjunction. No cap is needed; the chip renders as one attribute chip, not N locus chips.
4. **Does the roster need a "why did this pet match" affordance?** With 40 ANDed criteria, a matching pet is interesting but opaque. Out of scope as designed, but it is the obvious next request.
