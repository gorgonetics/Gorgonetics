# Genetic Quality Score — v1 Design

Issue: TBD. Branch: `feat/genetic-quality-score`.

Scores a pet on what it can **contribute to offspring**, not on what it
expresses itself. Complements `positive_genes` and the attribute totals,
which both measure the pet as a finished product.

## 1. Goal

The roster's existing quality signals — attribute totals and
`positive_genes` — rank a pet by what it *is*. Neither detects a pet that
is mediocre in itself but carries the alleles that fix everything else in
the stable.

Two horses in the reference collection (`Roach`, `Sardinilla`) were gifted
by the developers to an early pre-alpha player, explicitly selected as
"good genetic quality" breeding stock. They sit mid-pack on
`positive_genes` (109 and 102, in a stable spanning 85–120) and neither is
remarkable on attributes. Any score worth shipping must rank them at the
top. That is the acceptance test this design is calibrated against.

Why the existing metric cannot see them:

- **`positive_genes` counts expressed effects.** A heterozygous `x` at a
  recessive-positive locus expresses the *dominant* effect, so it scores
  zero — yet it is the allele you breed from.
- **`positive_genes` filters breed-locked loci** (`isHorseBreedFiltered`).
  Correct for "what does this pet express", wrong for a parent: offspring
  can be of a breed neither parent is, so an allele locked to a third
  breed is live material, not dead weight.

Of Sardinilla's 44 rare positive alleles, 43 are invisible to
`positive_genes` for one of those two reasons, and 40 sit at other breeds'
loci.

## 2. Core concept: benefit potential per allele

A pet transmits one allele per locus. Its value at that locus is **how
many distinct benefits the allele it can transmit could deliver**, scaled
by how reliably it transmits it.

For a locus with dominant sign `ds` and recessive sign `rs`:

```
benefit(D) = [ds === '+']   +  [rs === '-']
benefit(R) = [rs === '+']   +  [ds === '-']
```

Read those four terms as: a `D` allele can **add a positive** (dominant
effect is good) or **mask a negative** (recessive effect is bad and `D`
prevents the homozygous-recessive genotype that expresses it). An `R`
allele can **add a positive** (recessive effect is good) or **be the half
you need to escape a dominant negative** (only a `R/R` offspring avoids
it).

Transmission weight, from the pet's genotype:

```
p(D) = D → 1,  x → 0.5,  R → 0
p(R) = R → 1,  x → 0.5,  D → 0
w(p) = p === 1 ? 1 + LOCK_BONUS : p
```

`w` is superlinear at `p = 1`: a homozygote transmits with certainty and
breeds true, which is worth more than twice a heterozygote's coin flip.
`LOCK_BONUS` is small and calibrated — see §4.

Per-locus score is then `w(p(D)) · benefit(D) + w(p(R)) · benefit(R)`.

### Worked example: `01A1`

`01A1` is `Virility− / Temperament+` — `ds = '-'`, `rs = '+'`. So
`benefit(D) = 0` and `benefit(R) = 2`.

| genotype | p(R) | score | why |
|---|---|---|---|
| `D` | 0 | **0** | passes `D` always; every offspring expresses Virility−, and Temperament+ is unreachable |
| `x` | 0.5 | `0.5 × 2` | can pass `R`, so an offspring may both drop the negative *and* gain the positive |
| `R` | 1 | `(1 + LOCK_BONUS) × 2` | passes `R` always — the double benefit is locked |

Note that `D` scores zero rather than negative. The scale is a
contribution potential on `[0, ∞)`; it does not punish, it just declines
to credit.

### The locus classes, in full

Chromosome 01 is the only place in the horse gene set where an allele
carries two benefits at once — and it is *entirely* made of them:

| class | loci | notes |
|---|---|---|
| `ds=− rs=+` | 24 | all of chromosome 01, all breed-generic. The double-benefit case |
| `rs=+` only | 362 | |
| `ds=+` only | 241 | |
| `rs=−` only | 129 | `D` masks it |
| `ds=−` only | 99 | `R` is the necessary half of the escape |
| unsigned | 521 | scores nothing |

Plus 200 `Selector` loci (20 per breed), excluded — they carry no
attribute effect. Total 1576, matching `total_genes`.

## 3. The marginal term

The per-gene rule of §2, summed over all loci, does **not** identify the
two reference horses. Measured on the real stable:

| | Roach | Sardinilla | ρ vs `positive_genes` |
|---|---|---|---|
| `LOCK_BONUS = 0` | 15th | 24th | 0.63 |
| `LOCK_BONUS = 1` | 30th | 31st (last) | 0.81 |

The harder `LOCK_BONUS` weights homozygosity, the more the score
reproduces the metric it was built to replace. The reason is visible in
the slot counts: the top-scoring pet holds 434 locked useful slots to 68
carried, while Roach holds 266 to 379 and Sardinilla 260 to 376. They are
heterozygous nearly everywhere — consistent with how they were
constructed, to carry good alleles broadly rather than to breed true.
Summed naively, "locked is worth more" is a bet on the homozygous inbred
core of the stable, which is the opposite of the goal.

The per-gene reasoning is right *locally* — `R` at `01A1` genuinely does
beat `x` there. It goes wrong only in aggregation, because it credits a
locked allele identically whether twenty other pets have it locked too or
nobody else has it at all.

So each benefit slot is scaled by what the **rest of the stable can
already reliably produce**:

| tier | condition (excluding this pet) | meaning |
|---|---|---|
| `absent` | no other pet carries the allele | only this pet can supply it |
| `partial` | other carriers exist, none homozygous | reachable, but nobody breeds it true |
| `secured` | some other pet is homozygous for it | already locked in elsewhere |

**This is not the gene-rarity lens, and deliberately not.** Rarity treats
pool frequency as an estimate of a global property, which a 31-horse
stable cannot support. The tiers make no claim about the world: they ask
only "can I already breed this outcome from animals I own", which is a
fact about the stable and is *supposed* to change when the stable changes.
It is the same locked / partial / missing question `buildPoolCoverage`
already answers for the Breeding Assistant, asked leave-one-out.

`missing` from `GAP_WEIGHT` has no analogue here: the pet under
consideration carries the allele by construction, so "nothing carries it"
cannot arise. The inert tier of `#358` is structurally absent.

## 4. Calibration

Swept against the 31-stabled-horse reference collection. Reported: rank of
each reference horse, Spearman ρ against `positive_genes` (near zero means
the score adds information rather than restating it), and top-vs-median
score ratio (spread — too high means the score has collapsed into a
single indicator).

| tiers (absent/partial/secured) | `LOCK_BONUS` | Sardinilla | Roach | ρ | spread |
|---|---|---|---|---|---|
| 1 / 1 / 1 (no marginal term) | 0 | 24th | 15th | 0.63 | 1.03 |
| 2 / 1.2 / 0.6 (`GAP_WEIGHT`) | 0 | 1st | 2nd | 0.28 | 1.16 |
| 2 / 1.2 / 0.6 | 0.5 | 3rd | 23rd | 0.73 | 1.07 |
| 3 / 1.5 / 0.5 | 0 | 1st | 2nd | 0.13 | 1.35 |
| 3 / 1.5 / 0.5 | 0.5 | 1st | 4th | 0.62 | 1.21 |
| 3 / 1.5 / 0.5 | 1 | 1st | 22nd | 0.71 | 1.15 |
| **4 / 1.5 / 0.25** | **0.25** | **1st** | **2nd** | **0.06** | **1.84** |
| 4 / 1.5 / 0.25 | 1 | 1st | 2nd | 0.54 | 1.61 |
| 2 / 1 / 0 | 0 | 1st | 2nd | −0.65 | 16.40 |

Chosen: **`absent 4 / partial 1.5 / secured 0.25`, `LOCK_BONUS = 0.25`.**

Rationale, in order of weight:

1. **It is the only row where the ranking survives the whole
   `LOCK_BONUS` range** (0 → 1 all hold 1st/2nd). Every shallower tier set
   makes `LOCK_BONUS` load-bearing, and a parameter that flips Roach from
   2nd to 22nd is one nobody can tune with confidence later.
2. ρ = 0.06 — orthogonal to `positive_genes`, so the column earns its
   place in the roster instead of restating a column already there.
3. `LOCK_BONUS = 0.25` honours the "locked is worth more" intuition
   without letting it dominate; at these tiers it is safe to raise.
4. `secured = 0.25` rather than `0`: an allele the herd already has locked
   still transmits, so it is worth a little. Setting it to zero collapses
   the score into a sole-source count (spread 16.4).

These constants are calibrated against one collection, as
`RARITY_THRESHOLDS` was. They are exported and documented, not inlined.

## 5. Offspring-breed scoping

Because offspring can be of a breed neither parent is, the default scope
is **every locus, all breeds**. The score also accepts an
`offspringBreed`, scoping to breed-generic plus that breed's loci —
reusing the Breeding Assistant's existing control and
`isHorseBreedFiltered` gate.

Measured behaviour of the filter (tiers 4/1.5/0.25):

| `offspringBreed` | Sardinilla | Roach |
|---|---|---|
| any | 1st | 2nd |
| Standardbred | 1st | 4th |
| Kurbone | 1st | 25th |
| Calico / Paint | 1st | 2nd |

Roach dropping to 25th under a Kurbone target is **correct, not a bug**.
Roach is herself a Kurbone in a stable holding fourteen others, so at
Kurbone-scoped loci she supplies little the herd cannot already reach; her
value lay in other breeds' loci. Sardinilla, the lone Standardbred, stays
first everywhere. The filter is doing real work and the semantics need
documenting in the UI, or the swing will read as a defect.

This also settles a pre-existing inconsistency: per-pet stats exclude
breed-mismatched loci, the gene value filter never gates on breed lock.
The rule that generalises is *scope by the breed of the animal you are
reasoning about* — the pet, for its own stats; the offspring, for anything
predictive.

## 6. What "beneficial" means

§2 reads `+`/`−` straight from the parsed sign columns. The gene value
filter (`#369`) establishes that beneficial is **user-defined**, with the
shipped preset only a common-case shortcut. v1 keeps the sign columns and
does not consume `GeneFilter` criteria; the seam is the `benefit(D)` /
`benefit(R)` pair, which is the single place a criterion-driven predicate
would substitute in. Noted in §10 rather than built.

The `'expresses' | 'carries' | 'pure'` vocabulary from
`src/lib/utils/geneCriteria.ts` is the existing name for the distinction
this score turns on; the implementation should reuse those words rather
than invent parallel ones.

## 7. Module surface

Pure math, no I/O — mirrors `breedingGenetics.ts`:

- **`src/lib/utils/geneticQuality.ts`**
  - `benefitCounts(gene): { dom: number; rec: number }`
  - `TIER_WEIGHT`, `LOCK_BONUS`, `transmissionWeight(type, allele)`
  - `slotTier(tally, allele, ownType)` → `'absent' | 'partial' | 'secured'`
  - `scorePet(loci, parsedGenes, tallies, opts): GeneticQualityResult`

DB-aware composition:

- **`src/lib/services/geneticQualityService.ts`**
  - `scoreStable(pets, opts)` — one `getAllPetLociCached` read, one tally
    pass, then per-pet scoring. Returns `Map<petId, GeneticQualityResult>`.

`GeneticQualityResult` carries the headline plus the breakdown that makes
it explicable: `score`, `soleSourceSlots`, `lockedSlots`, `carriedSlots`,
and a per-attribute split (the Breeding Assistant precedent — attribute
breakdowns are what let a breeder target one trait).

Reused as-is: `loadAllPetLoci` / `getAllPetLociCached`, `PetLoci`,
`getParsedGenesCached`, `isHorseBreedFiltered`, `normalizeSpecies`.

Cost: 38 pets × 1576 loci ≈ 60k operations for the tally plus the same
again for scoring. Below the threshold where the rarity lens needed
measuring; no persistence, no migration.

**Not a persisted column.** Unlike `positive_genes`, the score is
stable-relative — every add, sale or stable toggle shifts it — so it is
computed live and cached via `petLociCache`'s invalidation, never written
to `pets`.

## 8. Edge cases

- **`?` loci** — skipped entirely, both in the tally and in scoring. `?`
  is skill-gated visibility uniform across the collection, not a per-animal
  gap; a locus nobody can read must not tier as `absent`.
- **Selector loci** — excluded (no attribute effect). Which breeds a pet
  can steer offspring toward is a separate question, out of scope for v1.
- **Unsigned loci** — `benefit(D) = benefit(R) = 0`, contribute nothing.
- **Single-pet stable** — every slot the pet carries tiers `absent`, so
  the score is at its structural maximum. Honest (nothing else can supply
  anything) but meaningless as a comparison. Suppress the column below a
  minimum population, as `SOLE_CARRIER_MIN_PETS` does for rarity.
- **Unstabled pets** — scored against the stabled baseline, not included
  in it. Matches the rarity lens, and "no stabled pet carries this" is a
  real reading for a pet you are deciding whether to keep.
- **Beewasp** — the model is species-agnostic (recessive-positive only,
  single effect per gene collapses `benefit` to one term). No special case
  needed, but chromosome 01's double-benefit class is horse-only.

## 9. Scope

**In:** the score, its breakdown, a sortable roster column beside
`+ Genes`, a panel on the pet detail view showing the top contributing
loci, and the offspring-breed selector.

**Out:** multi-generation forecasting; a blended score folding in
attributes; criterion-driven `benefit` (§6); wild-horse baselines
(blocked on `#367`); breed-steering value from selector loci; any change
to `positive_genes` or the Breeding Assistant's columns.

Consistent with house practice, this ships as an **additional** sortable
column with the default sort left alone — the same conservative choice
`#358` made for Pool gain.

## 10. Testing

Unit (`tests/unit/geneticQuality.test.ts`):

- `benefit` counts for all six locus classes, `01A1` explicitly.
- The `D → 0`, `x → 1`, `R → 2 × (1 + LOCK_BONUS)` table at `01A1`.
- `slotTier` leave-one-out: a pet must never tier itself into `secured` or
  `partial` on its own genotype.
- `?` excluded from tally and score.
- Monotonicity within a tier: `D` ≥ `x` ≥ `R` for a dominant benefit.

Regression (`tests/unit/geneticQualityCalibration.test.ts`): a fixture
holding the reference stable's genotypes at the loci that matter, asserting
Roach and Sardinilla rank 1st and 2nd. This is the test that would have
caught the `LOCK_BONUS` inversion, and the reason the constants are
exported.

E2E: column sorts, breed selector changes the ranking, column suppressed
below the minimum population.

## 11. Open questions

1. **Attribute weighting.** All benefits count 1 today. A breeder chasing
   Virility does not value a Friendliness+ slot equally. Defer to the
   criterion model (§6) rather than adding a second weighting scheme.
2. **Liability.** The score never subtracts. Sardinilla also carries 17
   rare *negative* alleles, and a breeder ought to see that. A paired
   liability figure is the obvious v2; folding it into the headline is not,
   given the twice-deferred composite precedent.
3. **Display scale.** Raw sums (~90–320 depending on scope) are not
   meaningful to a player. Percentile-within-stable is legible but hides
   absolute change; a fixed divisor keeps comparability. Undecided.
4. **`LOCK_BONUS` at steeper tiers.** §4 shows 4/1.5/0.25 tolerates
   `LOCK_BONUS = 1` while holding the ranking. If players find the locked
   emphasis too weak at 0.25, it can be raised — the calibration test is
   what makes that safe.
