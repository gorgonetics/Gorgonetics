# v0.9.2

Guards around the culling score, and a warning when *Reach new ground* has nothing left to reach. Both come out of simulating the loop a player actually runs — free slots, breed, stable the foals, repeat — over forty rounds. Still pre-1.0.

v0.9.1 was tagged but its build failed before anything was published, so this release supersedes it. Everything below is new since v0.9.0, the last release with binaries.

## Release guards on Free up slots

The score prices only what an animal can pass on. Three things it cannot see now sit around the walk as separate guards, so the trade-off stays visible instead of disappearing into the cost:

- **Sex floor.** The list never drops either sex below the number of pairs the freed slots are for. In simulation, one run in twelve drained a sex until no pair could form at all.
- **Keep my best**, on by default. Pins the top animal by *+ Genes* and by attribute total. A founder reads as free the moment its foals cover it; without the pin, the stable's current best was released in 17 of 240 rounds.
- **Release by.** Choose between losing the least potential and clearing the most negatives. Capability-only culling lets locked-in negatives climb round after round; clean mode holds the rise for a small cost in capability.

The dialog now states its units — slot-units, 0.5 for a beneficial allele only this animal carries, 1 for one only it breeds true — reports how many males, females and pairs are left, and gives the reason each held-back animal was excluded. Changing a setting drops the stale plan, so an out-of-date list cannot be released.

Only alleles with an attribute effect are priced. Coat, marking and breed-selector genes are not, so a "free" release can still be the last carrier of a look.

## Breeding pool capability

With spots set, the breeding header shows how much capability the pool holds against what its alleles could ever lock, and what the best *Reach new ground* plan would still add per pair. Reach saturates after a handful of rounds; below one slot-unit per pair the view says so and suggests comparing *Raise the ceiling* and *Clean the line*. It measures Reach only, so check the others before switching — on a pool that is already clean and cannot beat its best parent, they can be zero too.

## Fixes

- The Quality column separates "not stabled" from "no usable genome data", and says to re-import the genome file for the second.
- The sex floor is judged on the animals left, not on the starting population.
- Only scored animals count toward the release floor.
- The untargeted cull walk stops on the ordering key rather than raw cost.
- Dependency updates across npm and Cargo.
- `@tauri-apps/plugin-updater` realigned with the 2.11 Rust crate; the mismatch broke the v0.9.1 build on every platform.

## Notes

The multi-round simulation, its corrected figures and the reasoning behind each guard are written up in `docs/design/genetic-quality-score-v1.md` §4c. A shorter version runs as a test against the real services.
