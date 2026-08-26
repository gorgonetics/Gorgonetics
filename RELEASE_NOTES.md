# v0.9.0

Two new ways to judge a pet: how rare its genes are across your own collection, and what it can give offspring that no other animal in your stable can. Still pre-1.0.

## Gene rarity lens

- New **Rarity** view on the pet gene grid. Each allele is coloured by how rare it is across your pets, on a diverging scale — rare recessive at one end, rare dominant at the other, common in the middle.
- Six steps: Common, Uncommon, Notable, Rare, Sole carrier, Never seen. "Never seen" marks a value none of your pets carry, and is the one reading you cannot breed your way to.
- Baseline toggle: **Stabled** or **All my pets**. The legend gives the baseline size and flags pets studied at a lower Genetics level, whose unread genes count for nothing.
- The tooltip gives the exact allele frequencies for that locus and the effect valence.

## Reference genome map

- The **Reference** destination now opens on a full-genome rarity map for the species — every locus of every chromosome on the same scale, with no pet selected. Use it to see where your collection is thin.
- Gene template editing moved behind an **Edit** toggle in the same toolbar.

## Genetic quality and culling

- New **Quality** column on My Pets. It reads as a share of the stable's irreplaceable genetics: what this animal can pass on that no other stabled animal of its species can. A pet that scores zero is not a bad pet — every allele it carries is available elsewhere in the stable.
- Scored over the stabled population of one species, never over the filtered view, so a search box cannot change a score.
- New **Free up slots** dialog. Give it a number of slots; it returns the cheapest ordered set of animals to release, the breeding capability each release costs, and the negative alleles that leave with it. Releasing un-stables an animal. Nothing is deleted.

## Breeding strategies

- New **Breed for** picker. Breeding has more than one goal and they conflict, so the app no longer picks one for you: *Reach new ground*, *Raise the ceiling*, *Raise the floor*, *Clean the line*, *Most positive genes*, or improvement on a single attribute. The pair ranking and the breeding plan both follow the choice.
- New pair columns to match: **Quality**, **Ceiling**, **Floor**, **Cleanup**.
- Pairs are now scored on improvement over the parents, not on the offspring's absolute level. Ranking by absolute level puts your two best animals together at the top, and their foal usually regresses.

## Community

- Bulk share runs in the background. You can keep working while the selected pets upload.

## Fixes & performance

- The genome grid width no longer follows the detail header's content.
- Background reloads no longer blank the active view.
- Rarity baselines aggregate in SQLite instead of in JavaScript.
- One spacing scale (`--space-*`) and one segmented-control style across the app.
- Dependency updates across npm and Cargo.
