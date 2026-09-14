# v0.9.3

Breed reach reaches the genetic quality score. A gene locked to a breed you are not breeding is now worth less than a breed-generic one — weighted, never dropped. Still pre-1.0.

## Why a weight

677 of the horse gene set's 879 benefit slots belong to one of ten breeds. Left unweighted, three-quarters of the Quality ranking was decided by material a single-breed breeder never uses. A filter was the obvious fix and the wrong one: hard-scoped to one breed, the sole carrier of three unrecoverable positives priced at zero and was offered for release.

So the score weighs instead. A breed-generic locus counts 1, because it serves every breed target you might later pick. A locked locus counts 1 ÷ 10, the same arithmetic read the other way. Your focus breed counts 1. Nothing is derived by taste.

## What you set

Settings gains **Genetic Quality**:

- **Breeding toward** — the breed valued at full weight. "Any breed" keeps the old behaviour.
- **Breed-locked gene weight** — Auto (the derived 0.10), Softer, Half, Equal, or Focus breed only. Free up slots clamps this above zero whatever you pick, so no setting can price another breed's sole carrier at nothing.

## What you see

- The Quality column marks animals whose value is mostly breed-generic, and the breakdown says how much of a score is breed-locked.
- Free up slots separates the breed-generic part of each release cost — material that stays useful whichever breed you switch to, so it cannot be won back by changing plans.
- Breeding pair ranking and the pool capability readout use the same weighting.

Release costs are now in reach-weighted units; the breeding readout stays in raw slot-units. The two are not directly comparable.

## Notes

The weighting and the reasoning against a filter are written up in `docs/design/genetic-quality-score-v1.md` §5a, which supersedes §5.
