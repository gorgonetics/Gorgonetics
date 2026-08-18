# Gene Value Filter — v1 Design

**Status:** Accepted — revised after review (PR #470). Implementation in progress.
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

**What "excluded — not revealed" means per criterion kind.** For a locus criterion the classification is crisp: the pet reads `?` (or has no row) at the filtered locus. For an attribute criterion it needs a definition, because a threshold can fail with or without unknowns involved: a pet is **excluded as not-revealed** when `matched < min` but `matched + unrevealed ≥ min` — re-studying could still make it pass. Otherwise it is a definite non-match. That makes the classification total and disjoint: matches + not-revealed exclusions + definite non-matches + not-imported (§8) = candidates, which is the invariant §10 tests.

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

The slider's default sits at the **median of the per-pet matched counts over the pets passing the other active filters** rather than at a fixed number: a threshold of 52 means nothing until you know whether that is exceptional or typical for this collection, and the median guarantees the filter opens showing roughly half the roster instead of zero or all of it. With one or two pets the median is arbitrary — at that roster size the sortable column, not the threshold, is the useful interface, and that is fine.

The expansion uses the **parsed effect columns**, not the grids' display heuristics. The `genes` table already carries `dominant_attribute` / `dominant_sign` / `recessive_attribute` / `recessive_sign`, produced by the strict `^[A-Za-z]+[+-]$` parse (`parsedEffectColumns` in `geneAnalysis.ts`), kept in sync on every GeneEditor save, self-healed by `backfillParsedGeneEffectsIfNeeded`, cached per species by `getParsedGenesCached`, and already the basis of `getPetGeneStats` — the app's canonical per-pet attribute stats. Measured on the horse data, the strict parse reproduces the "clean positive allele" column above **exactly**, so the expansion and the table share a definition for free.

For each gene whose parsed record marks an allele `+` for the chosen attribute, that allele is the good one, and the want translates to an allowed state set (`carries` → `{allele, x}`, `expresses` → `{allele}` plus `x` when the allele is `D`, `pure` → `{allele}`). No shipped locus is positive on **both** alleles for the same attribute (measured: 0 of 1576); if a template edit ever produces one, the good allele is ambiguous and the locus is skipped, visible in the expansion inspector, rather than silently included. The three wants are genuinely distinct at the expansion level because the arms mix — Toughness is 37 D-arm + 49 R-arm loci — even though for any single locus two of the three coincide (§11, settled).

**Why not `analyzeGene` / `attributesForGene` (`geneGridCells.ts`)?** Those are display heuristics: valence by `includes('+')` / `includes('-')` over free text, and `analyzeGene` reports only the first matching attribute (it `break`s). Building the filter on them imports two failure modes the parsed columns do not have: a malformed effect string fails the strict parse and **drops out** of the expansion — visible, the locus count shrinks — instead of being misread, and per-allele columns cannot conflate attributes. The grids keep their heuristics; the filter does not inherit them. A parity test pins the expansion against the measured counts (§10).

**Effect strings the strict parse rejects** — including "potential"-style strings (containing `?` or "potential") — are simply not in any expansion. Measured across both shipped species (1814 loci), **zero** effect strings are potential-style or name more than one attribute, so today this excludes nothing; a player who cares about a locus with an unparseable user-edited effect adds it through the map path (§5b). The earlier draft's "include potential effects" checkbox is dropped — it toggled an empty set.

### 5b. By clicking the genome map (refinement)

The Reference destination's genome map already renders every locus for a species, at the same cell pitch as the pet grid. Clicking a cell adds a criterion for that locus; the criterion chip then exposes the `{D, R, x}` toggles directly.

This is the escape hatch for everything the attribute path cannot express — a specific locus a player has learned matters, an appearance gene, or a locus whose effect string the strict parse rejects (§5a). It is also the only path that works for loci with no attribute effect at all (appearance genes).

The two paths compose by ANDing: a Toughness threshold *and* a specific locus the player insists on. Map-added loci are always their own criteria — they are never folded into an attribute's locus list, so removing the attribute never silently removes a locus the player picked deliberately.

### 5c. Species scoping is mandatory

Gene ids are only comparable **within a species** — `01A1` names a different locus for a horse than for a beewasp (`gene-rarity-lens-v1.md` §2 makes the same point for rarity baselines). The roster shows mixed species by default.

So the criteria set carries a species (one field on the filter, not one per criterion — §7), and **activating gene criteria sets the roster's species filter to that species and locks it** while criteria are active. The alternative — silently excluding every pet of another species — produces a roster that has quietly become single-species with no visible reason.

### 5d. Breed-locked genes (horse): they do not gate

Not an edge case: **1320 of 1576** horse loci are breed-locked (10 breeds × 132 each), including **71 of the 86** Toughness clean-positive loci. The pet detail's stats exclude a breed-locked gene from a purebred pet when the breeds mismatch (`isHorseBreedFiltered` in `getPetGeneStats`) — the gene's *effect* does not act on that pet.

**The filter deliberately does not apply that rule.** Breed-locked genes still inherit: a parent passes them to its offspring regardless of the parent's own breed, so a player hunting Calico alleles to breed toward a Calico foal needs them counted on a Kurbone. This is a breeding tool, and the question it answers is *"which alleles does this pet carry, and can pass on?"* — not *"which effects act on this pet?"*. So every expansion locus counts for every pet, the denominator is uniform (`Toughness 61/86` means the same thing on every row), and thresholds compare like for like across breeds.

The cost is an intentional divergence: the filter's `61/86` will not match the pet detail's Toughness stats, which answer the effects question and exclude breed-mismatched genes. The Genes section states this where the counts are shown (*"counts include breed-locked genes — alleles inherit regardless of breed"*), because the mismatch will otherwise be read as a bug.

The roster's existing breed filter composes as before for players who only care about pets of one breed; the gene counts do not change meaning when it is set.

### 5e. By chromosome (gene set)

A breeder optimises in *rows*, not only in attributes: horse **chromosome 01** is 24 loci, every one dual-effect (dominant negative, recessive positive — measured across all 24) and none breed-locked, which makes "get the recessive at every chr01 locus" a natural first campaign; once that row is done, move to the next set. The attribute path cannot express it — chr01's recessives are scattered across seven attributes — and 24 hand-clicked ANDed locus chips are the §4 conjunction problem all over again.

So the threshold criterion is a **group**, and an attribute is just one way to resolve a group's loci. A `GroupSource` is either an attribute (§5a) or a **chromosome**: the loci on that chromosome carrying a clean positive allele, want-translated per locus arm exactly as in §5a, snapshotted, thresholded, and contributing the same sortable roster column (`Chr 01 18/24`). For chr01 the clean-positive row is the whole row; chromosomes carrying only appearance genes offer nothing and are not listed, like Ferocity in §8. The adder is one control — attributes and chromosomes in two option groups.

The workflow this serves: add `Chr 01 · pure`, sort by the column, breed toward `24/24`, remove the chip, add the next set.

## 6. Where it lives

A collapsible **Genes** section in the My Pets `FilterBar`, below the existing controls. Collapsed by default and showing a count when active (`Genes (3)`), because it is a power feature and must not crowd the common path.

The result is the roster itself: fewer rows. No new destination, no new view mode.

One chip per criterion — **not** one per locus. An attribute criterion is a single chip carrying its threshold; only hand-picked loci get their own.

```
Toughness · carries ≥52 of 86        [edit] [×]
12B3 · D only                               [×]
```

Rendering an 86-locus expansion as 86 chips would bury the two hand-picked loci that the player actually reasoned about, and there is nothing useful to do with an individual chip inside an expansion — the threshold is the control. `[edit]` opens the expansion (want + threshold, and the locus list read-only for inspection).

An expansion is snapshotted at creation (settled — §11), so the chip is a stable object rather than a live query; its editor offers *re-expand* to pick up template changes.

**Persistence.** A filter is a hand-tuned artefact — a chromosome campaign plus map-picked loci and thresholds — that a breeder reuses across days, so it must not die with the session. The **active filter** is written through to the settings table on every mutation (writes chained, last wins) and restored at startup before first render, re-forcing the species lock; a corrupt or legacy payload degrades to "no filter", never a crash. **Named saves** (`Save filter as…` / load / delete in the Genes section) let a player park one campaign and load another — loading replaces the active filter and becomes the new persisted state. The earlier draft deferred this; the multi-day breeding-line workflow made it v1.

**Keep valence and rarity visually separate** — #465's constraint from §6 of the rarity design. This feature ships no rarity colour at all, so the constraint is trivially satisfied in v1, but the chip design must not adopt the purple/orange rarity hues for "good/bad allele", or #465 will inherit a collision it cannot undo.

## 7. Data flow

The problem: `petFilter.ts` is pure and synchronous over `Pet[]`, and `Pet` carries no gene data. Gene values live in `pet_genes`, behind an async read.

The resolution — the predicate stays sync; the data is loaded once and injected:

```
MyPets
  $effect: geneFilter active?
      → loadAllPetLoci(petIds)        ← one query for N pets, already exists
      → cache in a store, keyed on sorted pet ids
  $derived: filterPets(pets, filters, loci)
      → petMatchesFilters stays pure and unit-testable
```

`loadAllPetLoci` (in `petLoci.ts`) already does exactly what is needed: a single `WHERE pet_id IN (…)` read returning `Map<petId, Map<geneId, GeneType>>`, with inline populate-and-retry for legacy pets whose projection was never written. Nothing new is required at the data layer.

**While the load is in flight, gene criteria are not applied.** The Genes section shows a loading state and the roster keeps its previous (gene-unfiltered) result until the map resolves. Filtering to zero and popping back in is §3's empty-roster trap in temporal form; "Matches 0" must never render because data hasn't arrived yet.

Caching follows `frequencyService`'s precedent — key on the **sorted pet id set**, not array identity, so a background reload of the pet list does not re-read `pet_genes`. A small bounded cache (`MAX_CACHED = 4` there) is the model.

Signature change, additive so every existing caller is untouched:

```ts
export interface PetListFilters {
  …existing…
  /** Gene filtering. Absent means none. Criteria are ANDed; species scopes them (§5c). */
  geneFilter?: { species: string; criteria: GeneCriterion[] };
}

/** A state a criterion can require — '?' is excluded at the type level (§3). */
export type KnownGeneType = Exclude<GeneType, '?'>;
/** Allowed states. A non-empty proper subset of {D, R, x}. */
export type AllowedStates = KnownGeneType[];

/** How a group's loci were resolved — re-derivable on want change / re-expand (§5a/§5e). */
export type GroupSource =
  | { type: 'attribute'; attribute: string }
  | { type: 'chromosome'; chromosome: string };

export type GeneCriterion =
  /** One locus must match. */
  | { kind: 'locus'; geneId: string; allow: AllowedStates }
  /** At least `min` of `loci` must match — see §4/§5a/§5e. Breed-lock does not gate (§5d). */
  | {
      kind: 'group';
      /** Chip/column label and count-map key, e.g. `Toughness` or `Chr 01`. */
      label: string;
      source: GroupSource;
      /** Resolved from the parsed effect columns at expansion time and snapshotted (§11). */
      loci: { geneId: string; allow: AllowedStates }[];
      /** Matched-count threshold; clamped to ≥ 1 at creation (§8). */
      min: number;
    };

/** Per-group counts for the roster column, keyed by label. */
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

`loci` is optional: when `geneFilter` is absent the argument is unused, so no caller has to supply it and no surface pays for a feature it does not use.

At most one group criterion per label — selecting a group that already has a chip is not offered again (§8) — so keying the count map by label is unambiguous.

**Scale.** ~1576 loci × ~30 pets ≈ 47k map entries, one query, held in memory. Rebuilt only when the pet set changes. The per-pet predicate is `criteria.length` map lookups — negligible next to the existing string search.

## 8. Edge cases

- **Pet with no projection at all.** `loadAllPetLoci` omits pets with no rows (its doc is explicit that `map.has(id)` is the check, not `map.get(id)`). Such a pet fails every criterion — well-defined because v1 criteria always demand at least one matching locus (`allow` is non-empty, `min ≥ 1`) — and is reported **separately from `?`**: "not yet imported" is a different fix from "not yet studied".
- **Locus absent from a pet's map.** Same as `?` — a genome studied to a shallower depth simply has no row. Fails, counted as not-revealed.
- **Criterion on a locus that does not exist for the species.** Possible via a stale saved filter after a species switch. Treat as not-revealed for every pet, and surface it as an invalid criterion rather than an empty roster.
- **All three states allowed.** Not a filter; normalise to "any" and drop the criterion rather than evaluating it.
- **No states allowed.** Empty `allow` matches nothing. Disallow at the UI level; the predicate must still handle it without pretending it means "any".
- **`min` below 1.** Not a filter — a vacuous threshold passes everything, including pets with no data, which contradicts the no-projection rule above. `min` is clamped to `[1, expansion size]` at creation; the predicate evaluates a (non-UI-reachable) `min ≤ 0` as satisfied rather than special-casing it, but no UI path produces one.
- **Duplicate attribute criteria.** Disallowed — selecting an already-active attribute edits its existing chip. Keeps §7's per-attribute count map unambiguous.
- **Attribute expansion yields zero loci.** Real, not hypothetical: Ferocity has 0 loci in the horse data (§4). Say so — do not present an empty criterion set as an active filter, and do not offer the attribute for a species where it scores nothing.
- **Breed-locked loci.** §5d: never gate — counted for every pet in both criterion kinds; the divergence from `getPetGeneStats` is intentional and surfaced in the UI.
- **Mixed-species roster.** Covered by §5c: species is forced while criteria are active.

## 9. Scope

**v1 (this design):**
- `GeneCriterion` model (both kinds) + `petMatchesFilters` extension (pure, unit-tested).
- Loci store with sorted-id caching, feeding MyPets.
- FilterBar "Genes" section: group expansion with threshold — attribute (§5a) and chromosome (§5e) sources — and locus chips (§6).
- Sortable per-attribute match-count roster column while an attribute criterion is active (§5a); uniform denominators — breed-lock does not gate (§5d).
- Genome-map click-to-add (§5b).
- Not-revealed / not-imported exclusion counts surfaced in the result (§3).
- Species forcing (§5c); breed-lock transparency note in the Genes section (§5d).
- Persistence: the active filter survives restarts; named saved filters for switching campaigns (§6).

**Explicitly out of scope:**
- **Rarity composition (#465)** — this design deliberately ships no rarity colour, so the two can be combined without undoing anything here.
- Configurable AND/OR (§4).
- Filtering the **community catalogue** by gene values — the catalogue's genomes are not local, and `listPets` never fetches them (`gene-rarity-lens-v1.md` §3).
- Fixing the grids' display valence heuristics (`analyzeGene` string matching) — the filter no longer builds on them (§5a); tightening the grids is its own issue.
- The genome-grid **display** filters (`GeneFilterPills`, tri-state focus/hide, CSS-injection dimming) — those dim loci inside one genome view; this feature filters pets. Different machinery by design, not an oversight.
- A potential-effects opt-in — dropped (§5a): zero potential-style effect strings exist in the shipped data of either species.
- Numeric **attribute** filtering (0–100 pet attributes). Different data, different UI; not what #369 asks for.

## 10. Testing

- **Pure unit** (`petMatchesFilters` + criteria): each of the four state-set shapes from §2 against a pet reading `D`, `R`, `x` and `?` — a 4×4 truth table, since this is the entire semantic core. Explicitly: `{R, x}` matches an `x` pet and `{R}` does not — the express/carry distinction, and the case every other view in the app cannot make.
- **`?` never matches**, for every state set including `{D, R, x}` before normalisation. A pet reading `?` must fail even a criterion that allows all three real states.
- **Absent locus behaves as `?`**, and a pet missing from the loci map entirely fails without throwing — the two different "no data" paths from §8, which must not be conflated in the counts.
- **AND across criteria**: a pet satisfying 2 of 3 fails; order of criteria is irrelevant.
- **Attribute threshold arithmetic**: a pet matching exactly `min` passes and `min - 1` fails (boundary); the predicate evaluates a (non-UI-reachable) `min ≤ 0` as vacuously satisfied while the UI clamps to ≥ 1 (§8); `min = total` is the conjunction the §4 table shows is unusable, and must still evaluate correctly rather than being special-cased away.
- **Unrevealed loci do not inflate the count.** A pet reading `?` at 30 of 86 Toughness loci scores out of 86, not out of 56 — the count and the threshold must share a denominator, or a poorly-studied pet ranks above a well-studied one by having fewer chances to fail. This is the §3 rule applied to the count, and it is the most likely subtle bug in the feature.
- **Breed-lock does not gate (§5d)**: a breed-locked locus counts toward `matched` / `total` / `unrevealed` for pets of any breed, in both criterion kinds; the denominator is uniform across the roster regardless of pet breed.
- **A 124-locus expansion evaluates without pathological cost** — the realistic size from the §4 table, not a 3-locus toy.
- **Exclusion counts are correct and distinguish their causes** — not-revealed vs not-imported reported separately, using §3's could-pass-if-studied definition for attribute criteria, and matches + not-revealed + definite non-matches + not-imported equals the candidate count. This is the assertion that stops §3's empty-roster trap from regressing into a silent zero.
- **Expansion parity with the parsed columns**: an attribute's expansion equals what `dominant_attribute` / `recessive_attribute` + sign yield directly, and the horse counts are pinned (86 Toughness, 112 Intelligence, …, 0 Ferocity — §4 table); a regression that halves an expansion is invisible without them. An unparseable effect string (e.g. `Toughness+?`) contributes no expansion locus; a both-alleles-positive locus is skipped, not misassigned.
- **Chromosome expansion (§5e)**: Chr 01 expands to exactly 24 loci, all recessive-arm (the measured dominant-negative/recessive-positive invariant); a chromosome with no clean-positive locus (Chr 04 in the shipped data) is not offered and expands to null.
- **Criteria are not applied while loci load** — the roster holds its previous result until the map resolves; "Matches 0" never renders from missing data (§7).
- **Persistence (§6)**: the active filter round-trips a simulated restart (including thresholds — the tuned value is the artefact); clearing clears the stored copy; a corrupt payload degrades to no filter; concurrent write-throughs cannot leave a stale row (writes are chained); named save/load/delete cycle, same-name saves replace, loading re-forces the species lock and becomes the persisted active filter.
- **Species scoping**: a horse criterion never evaluates against a beewasp; activating criteria forces the species filter; a criterion for a locus absent from the species surfaces as invalid rather than as zero matches.
- **Loci cache** keyed on the sorted id set: reordering the pet array does not trigger a re-read; adding a pet does.
- **Component/e2e:** expanding an attribute populates chips; removing a chip re-widens the roster; the roster row count matches the reported match count (the #405 rule — one filter result, shared, so table and bulk-selection cannot disagree); the not-revealed empty state renders its own copy rather than the generic one.

## 11. Decisions from review

**Settled** (recorded so the reasoning is not relitigated):

- A criterion is a **subset of `{D, R, x}`**, not a value plus a match mode — §2. Express vs carry is the real axis; range/threshold is meaningless over four unordered states.
- **`?` never matches**, and the exclusion count is part of the result — §3. Skill-gating is uniform across a collection, so a filter on an unrevealed locus returns zero pets for a reason that has nothing to do with the pets.
- **AND**, not configurable — §4.
- The filter narrows the **roster**, not a genome view — §1, §6.
- **Both** selection paths ship: group expansion (attribute §5a, chromosome §5e) is primary, map clicking is the escape hatch for appearance genes, arbitrary loci, and effect strings the strict parse rejects — §5.
- The threshold criterion is a **group** with a pluggable source, not an attribute-only construct — §5e. A chromosome is a gene *set* a breeder optimises as a campaign (chr01: 24 dual-effect, breed-generic loci), and the attribute machinery (want translation, snapshot, threshold, count column) applies unchanged.
- Expansions build on the **parsed effect columns** (`getParsedGenesCached`), not the grids' display heuristics — §5a. Same definition as `getPetGeneStats`, both string-matching failure modes structurally absent.
- Horse **breed-locking never gates the filter** — breed-locked alleles inherit regardless of the parent's breed, so the filter counts what a pet carries; the stats view (which excludes breed-mismatched *effects* per pet) answers a different question, and the divergence is stated in the UI — §5d.
- An expansion **snapshots** at creation. A template edit in Reference never mutates an active filter under the player; the chip's editor offers *re-expand* to pick up changes. (The parsed columns update on template save either way, so tracking would have been cheap but unpredictable.)
- The **three-way want control stays uniform**. For any single locus two of the three wants coincide (dominant arm: carries = expresses; recessive arm: expresses = pure), but expansions mix arms — Toughness is 37 D-arm + 49 R-arm — where all three produce different results. Locus chips expose raw `{D, R, x}` toggles and need no want control.
- ~~How many loci is an attribute expansion allowed to add?~~ **Answered by measurement** — an expansion is 112–155 loci (§4), which is why the attribute kind is a threshold rather than a conjunction. No cap is needed; the chip renders as one attribute chip, not N locus chips.

**Open:**

1. **Does the roster need a "why did this pet match" affordance?** With many ANDed criteria, a matching pet is interesting but opaque. The per-attribute count column answers most of it for attribute criteria; locus criteria are their own explanation. Out of scope as designed, but it is the obvious next request.
