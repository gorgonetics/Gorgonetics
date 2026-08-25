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
top. That is the acceptance test this design is validated against.

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

Each benefit slot is then valued by the **capability** a population has at
it:

```
capability(homozygotes, carriers) =
  homozygotes > 0 ? 1    : // the outcome can be bred true
  carriers    > 0 ? 0.5  : // reachable, never reliably
                    0      // out of reach from this stable
```

**The 2:1 ratio is the entire weighting model.** A locked allele is worth
exactly twice a carried one — the "locked breeds true" intuition expressed
as a capability rather than a tuned bonus. An earlier revision of this
design had a `TIER_WEIGHT` table and a `LOCK_BONUS` calibrated against the
reference collection; both are gone, because capability derives what they
were approximating and there is nothing left to fit.

### Worked example: `01A1`

`01A1` is `Virility− / Temperament+` — `ds = '-'`, `rs = '+'`. So
`benefit(D) = 0` and `benefit(R) = 2`, and only the recessive allele can
earn anything. Scored against a herd that carries no `R` at this locus:

| genotype | contributes | score | why |
|---|---|---|---|
| `D` | — | **0** | passes `D` always; every offspring expresses Virility−, and Temperament+ is unreachable |
| `x` | 0.5 | `2 × 0.5` | the only carrier, so it alone puts the outcome in reach — both benefits, unreliably |
| `R` | 1 | `2 × 1` | breeds the pair true; exactly twice the carrier |

`D` scores zero rather than negative — the benefit scale declines to
credit rather than punishing. Liabilities are tracked separately (§3a).

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

Benefit potential summed *absolutely* over all loci does **not** identify
the two reference horses. Measured on the real stable, with the tuned
bonus this design originally carried:

| | Roach | Sardinilla | ρ vs `positive_genes` |
|---|---|---|---|
| absolute score, no lock bonus | 15th | 24th | 0.63 |
| absolute score, lock bonus 1 | 30th | 31st (last) | 0.81 |

The harder homozygosity is weighted, the more the score reproduces the
metric it was built to replace. The reason is visible in the slot counts:
the top-scoring animal holds 434 locked useful slots to 68 carried, while
Roach holds 266 to 379 and Sardinilla 260 to 376. They are heterozygous
nearly everywhere — consistent with how they were constructed, to carry
good alleles broadly rather than to breed true. Summed naively, "locked is
worth more" is a bet on the homozygous inbred core of the stable, which is
the opposite of the goal.

An intrinsic denominator cannot rescue it. Normalising by a perfect genome
was tested and puts Sardinilla **30th of 31**: a perfect-genome
denominator is a constant, so dividing by it cannot reorder anything — it
only rescales the absolute score. The comparison has to be against the
herd or the score does not work.

So the score is the capability the stable **loses if this animal goes**:

```
atRisk(animal) = Σ  benefit × ( capability(herd)
     over slots               − capability(herd without this animal) )
     it carries
```

Per slot that difference takes one of three values, which are also the
labels the UI shows:

| tier (herd without this animal) | capability | this animal's contribution |
|---|---|---|
| `sole` — no other animal carries it | 0 | 0.5 as a carrier, 1.0 locked |
| `partial` — carriers, none homozygous | 0.5 | 0.5 if homozygous, else nothing |
| `secured` — another animal is homozygous | 1 | nothing |

Redundancy therefore scores zero, and that is the point: an animal whose
every allele is available elsewhere costs nothing to let go.

**This is not the gene-rarity lens, and deliberately not.** Rarity treats
pool frequency as an estimate of a global property, which a 31-horse
stable cannot support. Capability claims nothing about the world: it asks
only "can I already breed this outcome from animals I own", which is a
fact about one stable and is *supposed* to move when the stable moves.

`missing` from `GAP_WEIGHT` has no analogue. Tiers are only computed for
an allele the animal itself carries, so "nothing carries it" cannot arise
— the inert tier of `#358` is structurally impossible here rather than
merely unused.

### 3a. Liability

The same leave-one-out applies to negative alleles: what negatives leave
with the animal. Reported as `liabilityAtRisk` beside the headline and
**never netted into it**, matching the house preference for separate
columns over composites.

A flat, un-tiered liability penalty was tried and rejected: it drives 29
of 31 animals negative (range −9% to +9%), because tier-discounted
positives against undiscounted negatives is unit-inconsistent. Tier-weight
it and the ranking is stable at every penalty tried (1.25, 2, 3), which is
also why no penalty constant survives in the code.

Benefits and liabilities are asymmetric in severity, and the model does
not yet capture it: a transmitted `D` at a dominant-negative locus
**guarantees** expression, while a transmitted `R` at a recessive-negative
locus only bites if the other parent also passes `R`. Recorded in §11.

## 4. Validation

Nothing here is fitted, so this section validates rather than calibrates.
Against the 31-stabled-horse reference collection:

| | at-risk capability | share | sole source | sole lock | negatives removed |
|---|---|---|---|---|---|
| **Sardinilla** | 29.0 | 56.3% | 37 | 15 | 8 |
| **Roach** | 5.0 | 9.7% | 3 | 7 | 0.5 |
| 3rd place | 1.5 | 2.9% | 0 | 3 | 0 |
| 9 animals | 0 | 0% | 0 | 0 | — |

Both reference horses land first and second with a wide margin, and nine
animals score exactly zero irreplaceable capability — the cull list stated
directly rather than inferred from a ranking.

`share` is at-risk capability over the stable's total (51.5 slot-units).
That is the honest percentage: a real quantity over a real denominator,
unlike a fraction of a perfect-genome ideal.

### Individual scores do not add up

Leave-one-out is not additive, and culling is the use case that trips over
it. Where two animals are the only carriers of an allele, **each reads
zero** — the other covers it — but removing both loses the allele outright.

Measured on the reference stable: all nine zero-scoring animals read "free
to let go" individually, yet culling all nine at once costs 0.5 capability.

| approach | removed | capability lost |
|---|---|---|
| batch, every zero-scoring animal | 9 | 0.5 |
| sequential, recomputing after each | 8 | 0.0 |

Small here (0.07% of 758), structural everywhere, and worse the more paired
redundancy a herd carries. Consequence for the UI: a sortable column is not
enough, because a column invites selecting the bottom N at once. The
service must expose a **safe cull set** built greedily — score, remove the
cheapest, recompute, repeat while the cheapest costs zero — which is what
correctly stops at eight above.

The same caveat applies in reverse to the breeding side: two pairings that
each add capability may add the *same* capability, so their gains are not
summable across a multi-slot plan. `suggestPlans` would need the same
sequential treatment to use this as its objective.

### The sparsity is real, and only half acceptable

The measure is coarse by construction. For **culling** that is a feature —
nine zeros is an answer. For **breeding optimisation** it is a limitation:
across 234 M×F pairs the forward measure (§7, `expectedCapabilityGain`)
produces only **17 distinct values, 64 of them exactly zero**. The top of
the ranking is well separated and correct — the best pairings are exactly
those involving the two reference horses, and Sardinilla's mean gain is
0.97 against a herd mean of 0.28 — but past the leaders it is a flat
plateau with no gradient. Anything wanting a total order over all pairs
needs a denser tiebreak underneath. Noted in §11, not solved here.

## 4a. Choosing releases

The game caps concurrent breeding at six pairs, so a full stable must give
up six animals to start a round. The question is therefore **"which six,
and what do they cost?"** — not "what is free?". `safeCullOrder` takes a
target count and returns that many, priced, stopping early only at the
population floor.

Order of preference, cheapest released first:

1. **Capability cost**, ascending — the measure itself.
2. **Rare benefit alleles held**, ascending (§4b).
3. **Liability cleared**, descending.
4. **Attribute total**, ascending.
5. **Id**, ascending — determinism, nothing more.

Liability sits *below* rarity, reversing an earlier draft. A released rare
allele may be unrecoverable; a negative allele can be bred out later, so
irreversible loss outranks a temporary cost. The earlier order was measured
and was wrong in practice: exactly one animal in nine has any liability to
clear, and it is the one holding the most rare material, so liability-first
fired once and fired on the animal it should have protected.

### Attributes are not a value axis

Attributes carry real in-game value — a mount's speed, resilience and
carrying capacity — but they are **not** a reason to keep a genetically
redundant animal. Only one mount is needed, and keeping several
near-identical high-attribute horses serves nothing. So attributes never
compete with the genetic measure; they only separate animals it has already
called equal.

The animal you actually ride is protected by **pinning**, not by scoring:
`safeCullSet` excludes every `starred` pet from the walk. The score has no
view on riding and should not pretend to; the exemption is declared by the
player. An earlier draft tried a Pareto rule over capability, rarity and
every attribute — it marked 1 of 31 animals releasable, and that one was the
stable's strongest phenotype. With ten axes and thirty-one animals almost
nothing is dominated, and "best in stable at ruggedness" is meaningless when
five animals tie at 100. Dominance was abandoned for pinning.

### 4b. Why rarity is bucketed

Rarity is counted on `geneFrequency`'s ordinal buckets — benefit alleles at
`RARE_BUCKET_FLOOR` or above — not on raw frequency, and delegates to
`rarityBucket` so the app keeps one definition of rarity.

A continuous rarity value resolves every tie it is handed, which leaves any
criterion behind it dead code. Measured: continuous rarity gives 9 distinct
values for the 9 tied animals, so the attribute term never fires; bucketed
gives 4, leaving genuine ties. It also separates cleanly on real data — the
lone Paint holds 30 rare benefit alleles, the Statehelm 3, every other
animal 0–1.

Counted over benefit-bearing alleles only. Rarity across all loci is
dominated by the ~520 unsigned ones and ranks animals by how genetically
unusual they are rather than how much rare *useful* material they hold. A
naive sum over carried alleles is worse still: it correlates 0.923 with raw
allele count, making it a heterozygosity measure wearing a rarity label.

### Measured on the reference stable

Asking for six slots costs **nothing** — all six releases are free, drawn
from the redundant Kurbone core in ascending rarity then attribute order.

Worth noting what the sequential walk does here. The stable's
second-strongest animal by attributes (423) scores zero in the full stable
and would be released by any batch rule. Its cost rises to 0.5 once three
of its redundant siblings have gone:

| after releasing | its cost |
|---|---|
| nothing | 0 |
| 1 sibling | 0 |
| 2 siblings | 0 |
| 3 siblings | **0.5** |

It stops being redundant when its redundancy leaves. The tiebreaks did not
save it; re-scoring each step did.

## 5. Offspring-breed scoping

Because offspring can be of a breed neither parent is, the default scope
is **every locus, all breeds**. The score also accepts an
`offspringBreed`, scoping to breed-generic plus that breed's loci —
reusing the Breeding Assistant's existing control and
`isHorseBreedFiltered` gate.

Measured behaviour of the filter:

| `offspringBreed` | Sardinilla | Roach | animals scoring zero |
|---|---|---|---|
| any | 1st (29.0) | 2nd (5.0) | 9 of 31 |
| Standardbred | 1st (4.0) | 2nd (1.0) | 21 of 31 |
| Kurbone | 1st (5.0) | **18th (0)** | 24 of 31 |
| Calico | 1st (7.0) | 17th (0) | 23 of 31 |

Roach falling to zero under a Kurbone target is **correct, not a bug**.
She is herself a Kurbone in a stable holding fourteen others, so at
Kurbone-scoped loci she supplies nothing the herd cannot already reach;
her value lay in other breeds' loci. Sardinilla, the lone Standardbred,
stays first under every target. The filter is doing real work, and the
semantics need saying in the UI or the swing will read as a defect.

Note the second column: narrowing the scope makes the measure much
sparser, because fewer loci are in play and redundancy rises. Under a
Kurbone target 24 of 31 animals are individually expendable. That is a
true statement about a stable with a large same-breed cohort, but it
leaves the ranking nearly flat, which reinforces §4's point about needing
a denser tiebreak for anything that wants a total order.

### The scope belongs to breeding, never to culling

**`offspringBreed` must not be applied to the cull path.** A breeding plan
commits to one pairing and can be scoped to the breed it targets. Releasing
an animal is irreversible against *every* breed you might ever target, so
it has to be judged unscoped.

Roach is the worked example, and it is not a near miss. Under a Kurbone
target she scores zero. Unscoped she scores 5.0 across ten irreplaceable
slots — spread over six other breeds' loci, with **none** at Kurbone or
breed-generic ones, exactly as her pedigree predicts: her Kurbone material
is already held by her descendants and what survives is what they did not
need. Three of the ten are sole-carrier slots, where no other animal in
the stable carries the allele at all:

| locus | breed | benefit | genotype |
|---|---|---|---|
| `10A4` | Standardbred | +virility | `x`, sole carrier |
| `18B3` | Ilmarian | +ruggedness | `x`, sole carrier |
| `22C2` | Plateau Pony | +ruggedness | `x`, sole carrier |

A breed-scoped cull score would have recommended releasing the only carrier
of three unrecoverable positives. `safeCullSet` therefore takes no
`offspringBreed`, and the roster's cull view must not inherit the breeding
view's filter.

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

Pure math, no I/O — mirrors `breedingGenetics.ts`. **Implemented**, with
`tests/unit/geneticQuality.test.ts` covering it:

- **`src/lib/utils/geneticQuality.ts`**
  - `benefitSlots(gene): BenefitSlot[]` — enumerates the good outcomes, each
    tagged `add` / `clear` and with the attribute it moves.
  - `benefitCounts(gene)` / `liabilityCounts(gene)` — the scalar summaries.
  - `capability(homozygotes, carriers)` — the 2:1 model, and the only
    weighting in the module.
  - `TIER_CAPABILITY`, `MIN_POPULATION`
  - `transmissionProbability(type, allele)`, `carries(type, allele)`
  - `tallyAlleles(byPet)` → `Map<geneId, AlleleTally>`, `tallyFor(…)`
  - `supplyTier(tally, allele, ownType)` → `'sole' | 'partial' | 'secured'`
  - `scorePet(loci, genes, tallies, opts): GeneticQualityResult` — culling.
  - `capabilityShare(results)` → `Map<petId, percent>` — the honest 0–100.
  - `expectedCapabilityGain(dist, gene, tally)` — breeding, the same
    capability function run forward over a foal's genotype distribution.

No tuned constant survives. `TIER_WEIGHT` and `LOCK_BONUS` are gone with
the absolute score they weighted; `TIER_CAPABILITY` is a naming of
`capability`'s three outputs, asserted equal to it in the tests so the
label and the arithmetic cannot drift.

`benefitSlots` rather than a scalar per allele because a `clear` benefit
lands on the attribute of the negative being *avoided*, not the one the
allele expresses. At `01A1` the recessive allele adds Temperament+ **and**
escapes Virility−; counting two benefits against `recessiveAttribute`
would file half the per-attribute breakdown under the wrong trait at every
chromosome-01 locus.

`supplyTier`, not `slotTier`, and `sole`, not `absent` — the pet carries
the allele, so nothing is absent; what varies is whether anything *else*
supplies it. Named apart from `breedingService`'s `CoverageTier`
(`locked`/`partial`/`missing`) because that one describes a pool including
the pet and this one excludes it.

**Known debt:** the service reads via `loadAllPetLoci`, uncached. The
bounded `getAllPetLociCached` this design names lives on
`feat/369-gene-value-filter-v2` and is not on this branch; duplicating it
here would collide on merge. Fine at 38 animals — the cull walk's repeated
re-scoring is the heavier cost and it is in-memory — but it should switch
to the cache when `#369` lands.

DB-aware composition:

- **`src/lib/services/geneticQualityService.ts`**
  - `scoreStable(pets, opts)` — one `getAllPetLociCached` read, one tally
    pass, then per-pet scoring. Returns `Map<petId, GeneticQualityResult>`.
  - `safeCullSet(pets)` — greedy sequential removal while the cheapest
    animal costs zero, per §4. Not derivable from `scoreStable`'s output:
    leave-one-out scores are not additive. Takes **no** `offspringBreed`;
    see §5.

`GeneticQualityResult` carries the headline plus the breakdown that makes
it explicable: `atRiskCapability`, `soleSourceSlots`, `soleLockSlots`,
`liabilityAtRisk`, and a per-attribute split (the Breeding Assistant
precedent — attribute
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
  gap; a locus nobody can read must not tier as `sole`.
- **Selector loci** — excluded (no attribute effect). Which breeds a pet
  can steer offspring toward is a separate question, out of scope for v1.
- **Unsigned loci** — `benefit(D) = benefit(R) = 0`, contribute nothing.
- **Single-pet stable** — every slot the pet carries tiers `sole`, so
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

Unit (`tests/unit/geneticQuality.test.ts`, 36 cases):

- `capability` — the 2:1 ratio asserted directly, and `TIER_CAPABILITY`
  asserted equal to it so the display labels cannot drift from the maths.
- `benefitSlots` / `benefitCounts` / `liabilityCounts` across every locus
  class, with `01A1` named explicitly.
- The `D → 0`, `x → 2 × 0.5`, `R → 2 × 1` table at `01A1`, plus the
  attribute split (a `clear` files against the negative it avoids).
- `supplyTier` leave-one-out: an animal must never read its own allele back
  as coverage.
- `?` excluded from tally and score.
- Redundancy scores exactly zero; the sole animal able to breed a shared
  allele true scores `soleLockSlots`.
- `expectedCapabilityGain`: nothing credited where the herd already breeds
  true, monotone in the useful genotype's probability, and the
  no-benefit allele never earns.

Regression: a **synthetic** herd — ten homozygous siblings plus one
heterozygous outcrosser that is the only carrier of the good allele where
the siblings are worthless — asserting the outcrosser outranks the core,
that the siblings score exactly zero, and that the outcrosser holds 100%
of the stable's irreplaceable capability. This is the invariant whose
absence let the absolute score of §3 look plausible.

Synthetic rather than a fixture of the reference stable, for two reasons:
the stable is private user data, and an invariant ("an outcrossed sole
carrier beats an inbred core") is what we actually mean — a memorised
ranking of eleven names would pass for the wrong reasons the moment the
model changed. The real collection is used to *validate* (§4) and the
shipped module reproduces its ranking exactly, but that check is run by
hand, not in CI.

E2E: column sorts, breed selector changes the ranking, column suppressed
below `MIN_POPULATION`.

## 10a. Breeding has five purposes, not one

Every attempt to reduce pairing choice to a single objective failed against
a case the player could name, and each failure was measured on the
reference stable rather than argued:

| purpose | metric | what it answers |
|---|---|---|
| Reach new ground | `evCapabilityGain` | can the foal do something the stable cannot? |
| Raise the ceiling | `evPositiveImprovement` | can it beat the **better** parent? |
| Raise the floor | `evPairUpgrade` | can it replace the **weaker** parent, improving next round's pair? |
| Clean the line | `evLiabilityReduction` | does it drop a negative, even at a cost elsewhere? |

**A single objective is not merely inconvenient, it is wrong.** The
measurements:

- *Absolute positive count* ranks the two best animals together at the top,
  and the foal regresses: three of its top six pairings have means of 346,
  339 and 336 against a better parent of 349, with a 0.1–12.8% chance of
  improving on it. This is the local maximum, visible in the data.
- *Improvement over the better parent* fixes that — top-10 overlap with the
  absolute measure is 1 of 10 — but blinds you to the 113 of 234 pairings
  that cannot beat the better parent yet can replace the weaker one.
- *Improvement over the weaker parent* surfaces those, but correlates 0.751
  with the gap between the parents, so it ranks "breed your best to your
  worst" at the top. That is an honest description of a floor-raising
  strategy, not a defect, but it is not overall pair quality.
- *Any positive-side measure* hides a pairing made purely to drop a
  negative, which can be worth doing when the foal is worse than both
  parents.

There is a fifth, and it is per-attribute: lifting one trait that lags.
`evPositiveByAttribute` cannot express it for the same reason
`evPositiveTotal` could not express the fourth — a pairing can lead the
field on Intelligence while being unable to beat either parent's
Intelligence. So `evAttributeImprovement` measures each attribute against
the better parent *on that attribute*.

| purpose | metric |
|---|---|
| Reach new ground | `evCapabilityGain` |
| Raise the ceiling | `evPositiveImprovement` |
| Raise the floor | `evPairUpgrade` |
| Clean the line | `evLiabilityReduction` |
| Improve one attribute | `evAttributeImprovement[attr]` |

**The objective is a player choice per breeding round, not a property of
the app.** `utils/breedingObjectives.ts` is the registry: named strategies
with a selector each, plus `attributeObjective(attr)` for the parameterised
one. `suggestPlans` already takes `score`, so the picker feeds the planner
directly and nothing needs recomputing when the player changes intent —
`rankBreedingPairs` returns every component on each pair.

Deliberately **not** offered: a weighted blend. The weights would encode a
breeding strategy the app has no basis to choose, and would hide exactly
the conflicts a breeder needs to see. "Most positive genes" is kept in the
registry because a player may genuinely want the level, but its description
says plainly that it favours pairing your two best animals and that their
foals often regress.

## 11. Open questions

1. ~~**A denser tiebreak for breeding.**~~ **Resolved.** Sort pairs by
   `evCapabilityGain`, break ties on `evPositiveTotal` — which
   `rankBreedingPairs` already computed, so no new metric was needed.
   Measured across 234 pairs: capability takes 17 distinct values,
   `evPositiveTotal` takes 108, and within capability's 64-pair zero
   plateau it still takes 48. The pair is near-totally ordered.

   Two things make the remaining flatness acceptable rather than a defect.
   A tie is not a decision you are stuck with — the alternative pairing is
   still there next round — and `suggestPlans` seeds distinct lead pairings,
   so a plateau naturally spreads across plan *variants* instead of needing
   to be collapsed into one order.

   The residual problem is at plan level, not pair level: `suggestPlans`
   ranks by the sum of pair scores, and capability gains do not sum. See
   `breedingPlan.ts` — ~7% overcount on six pairs, documented not fixed.
2. **Liability severity.** `liabilityCounts` treats a dominant negative and
   a recessive negative alike, but a transmitted `D` at a dominant-negative
   locus guarantees expression while a transmitted `R` needs the other
   parent to match. The counts are right; the severity is not modelled.
3. **Attribute weighting.** All benefits count 1. A breeder chasing
   Virility does not value a Friendliness+ slot equally. Defer to the
   criterion model (§6) rather than adding a second weighting scheme.
4. **What capability means for a wild horse.** Capability is defined
   against animals you own, so a wild horse carrying an allele nothing in
   the stable has cannot be scored by it — the same gap `#367` blocks for
   the rarity lens. Until then the score describes only the stable.
5. **Whether `MIN_POPULATION = 3` is high enough.** At three animals almost
   everything tiers `sole`, so the score is near-degenerate even above the
   floor. The rarity lens needed ten for its loudest steps; this may too.
