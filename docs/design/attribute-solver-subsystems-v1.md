# Attribute solver: determined subsystems — v1 Design

Issue: TBD. Branch: `feat/subsystem-solver`.

Raises magnitude coverage by solving the equation systems the current solver
builds but declines to solve. No new animals, no new corpus, no change to
what counts as evidence.

## 1. Goal

`studyAttribute` accepts a slot only when it is the **sole remaining
unknown** in some equation (`attributeStudy.ts:615-645`). That is triangular
substitution. It never forms a determined 2×2 or 3×3 subsystem, even when
the equations it already holds pin those variables uniquely.

Measured on the reference stable — 36 eligible horses, 4 breeds, 879
declared slots — by rebuilding the identical equation system and asking
which variables it determines (`x_j` is determined iff `e_j` lies in the row
space of `A`):

| attribute | found | determined | gain |
|---|---|---|---|
| enthusiasm | 1 | 17 | **+16** |
| friendliness | 4 | 24 | **+20** |
| toughness | 5 | 17 | **+12** |
| intelligence | 23 | 23 | — |
| virility | 25 | 25 | — |
| temperament | 5 | 5 | — |
| ruggedness | 1 | 1 | — |
| **total** | **64** | **112** | **+48** |

**That is the acceptance test this design is validated against**: 64 → 112
on the reference stable, with every new finding passing the checks in §4.

The gain lands exactly where coverage is worst — the three attributes at 1%,
3% and 4% — which is also what was blocking every downstream feature that
wanted magnitudes.

Two things this is *not*:

- **Not a `maxDistance` change.** Sweeping 6 → 10 → 20 → 40 moves determined
  slots 112 → 116 → flat. The existing comment that 6 spans every
  substitution that closes is correct. Raising it buys almost nothing and
  costs quadratic time.
- **Not a statistical fit.** A determined variable is entailed by the
  corpus exactly as a `direct` finding is. Nothing here estimates.

## 2. Why the systems are trustworthy

The per-attribute systems are **massively over-determined**, and they are
consistent:

| attribute | equations | unknowns | rank | contradictory rows |
|---|---|---|---|---|
| enthusiasm | 88 | 26 | 22 | 0 |
| friendliness | 107 | 29 | 27 | 0 |
| intelligence | 137 | 28 | 25 | 0 |
| ruggedness | 60 | 25 | 22 | 0 |
| temperament | 264 | 18 | 13 | 0 |
| toughness | 142 | 24 | 23 | 0 |
| virility | 157 | 27 | 26 | 0 |

A contradictory row is one that reduces to `0 = k` for non-zero `k`. Across
seven systems carrying 955 equations over 177 unknowns there are none. That
is a far stronger statement about corpus quality than anything the current
engine can make, because the current engine never combines enough equations
to be able to contradict itself.

Where the two methods overlap they agree: **64 agreements, 0 clashes.**

## 3. Approach: a second pass, not a replacement

Keep the existing fixpoint exactly as it is, then run an elimination pass
over what it leaves.

```
findings = fixpoint(equations)            // unchanged
residual = equations with findings substituted in
findings += determinedIn(residual)        // new
```

The fixpoint earns its place. It is what produces the `support`/`dissent`
tallies, the blame accounting, `GeneDoubt` and `StudyContradiction` — all of
which depend on seeing the *same slot* resolved independently by several
single-unknown equations. A subsystem solve returns one answer with no
tally and can reproduce none of that. Replacing the fixpoint would trade a
working corpus-error detector for coverage; running it first and eliminating
afterwards keeps both, and the measured zero clashes say the two never
disagree.

**Exact rational arithmetic, not floating point.** Integrality is the
correctness check for this whole feature (§4), so computing it in floats
would undermine the thing it exists to prove. Coefficients start at ±1 and
the systems are a few hundred rows, so `BigInt` fractions are cheap; the
spike's float-with-tolerance version is adequate for measuring and not for
shipping.

## 4. What may be published

A determined variable is not automatically a finding. Three gates, each one
a check the engine already believes in:

1. **Integral.** The game's arithmetic is integral. A determined slot whose
   value is a fraction is *proof* that some equation in its subsystem rests
   on a mis-recorded animal. This is a new corpus self-check, and one the
   current solver cannot make because it never forms the subsystem.
2. **Non-zero.** A magnitude of zero contradicts the declaration that the
   gene has an effect. The fixpoint already treats this as `no-effect`
   doubt rather than a finding.
3. **Sign agrees with the declaration.** The declared `+`/`-` is never an
   input to the arithmetic, which is precisely what lets it be tested. It
   passed 48 times out of 48 on the reference stable — an independent
   confirmation, not a tautology.

A variable failing (1) or (3) is evidence about the corpus, so it is routed
into the existing `GeneDoubt` surface rather than dropped silently.

## 5. Reporting a subsystem finding

`StudyFinding` gains a third tier. `direct` and `derived` must stay
distinguishable — the module doc is explicit that collapsing tiers "would
launder a chain of substitutions into the same object as a value 200 pairs
agree on" — and a subsystem finding is a third kind of claim again.

- `tier: 'system'`
- `support`: the number of residual equations mentioning the slot — how
  much evidence touches it. Deliberately *not* reused as "independent
  agreements", which is what it counts for the other two tiers; a subsystem
  solve produces one value, so there is nothing to agree.
- `dissent`: 0 — an inconsistent subsystem publishes nothing at all rather
  than a majority value.
- `witnesses`: the animal pairs behind the combined equations.
- `depth`: unchanged meaning (substitution rounds), 0 for a subsystem find.

`validate` (`:675-709`) holds out pairs differing at 2+ known slots. More
known slots means more testable pairs, so the existing out-of-sample score
should be re-measured after this lands and quoted in the PR — it is the
check on whether the extra 48 are real.

## 6. Files

- `src/lib/utils/attributeStudy.ts` — the elimination pass, the rational
  arithmetic helper, the three gates, the new tier. Pure; no DB, no Svelte.
- `src/lib/components/study/StudyFindingsTable.svelte` — render the third
  tier alongside `direct`/`derived`.
- Everything downstream (`attributePoints.ts`, `breedingService.ts`, the
  breeding columns) is tier-agnostic and needs no change: it reads
  `magnitude` and already includes `derived` findings deliberately.

## 7. Verification

- Unit tests in `tests/unit/` following the existing style — synthetic
  fixtures asserting exact integers: a 2×2 subsystem the fixpoint cannot
  reach but elimination can; a fractional solution rejected and routed to
  doubt; a sign-clashing solution rejected; an inconsistent system
  publishing nothing.
- The acceptance number from §1 re-measured on the reference stable.
- The `validate` out-of-sample score before and after, quoted in the PR.
  Measured on the reference stable: **196/196 exact before, 437/437 after**.
  The extra 48 findings more than double the number of held-out equations
  the engine can be tested against, and every one still lands exactly.
  `direct` (13) and `derived` (51) counts are unchanged, which is the check
  that the new pass is purely additive.
- `pnpm run lint:ci`, `npx tsc --noEmit -p .`, `npx vitest run`,
  `pnpm test:e2e`.
