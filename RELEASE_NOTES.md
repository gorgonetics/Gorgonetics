# v0.10.0

A new **Study** tab works out what each gene is worth in attribute points, from the animals you already have and from the community catalogue. Breed, the pet grid, the genome map and the Trio now read those numbers. Still pre-1.0.

## The Study tab

Attributes and gene effects are integers, so the study treats the stable as a system of equations, not a fit. Two animals of one breed that differ at one slot give that slot's value outright. Known values substituted into wider pairs give more, and an elimination pass solves slots that are only determined jointly.

- **Community animals** — yield depends on corpus size: 7% of horse effects from a 36-horse stable, over half from ~450. **Fetch community animals** caches the catalogue as study evidence only; My Pets and the breeding pool do not change. Fetching is explicit, shows progress, and hash-verifies each genome.
- **Honest findings** — each value says how it was found (direct, derived, or solved as a system) and every result is checked against held-out pairs. On the live corpus that check is 100% exact once mis-recorded animals are excluded.
- **Gene doubts** — the declared +/− is never an input to the arithmetic, so it stays an independent check. When animals disagree with it, the gene is listed to check in game. **Table is right** confirms the declaration and moves the blame to the animals involved.
- **Suspect readings** — a mis-typed attribute shows as a constant offset across every equation the animal is in. Suspects are listed with **Stop using**, exclusions with **Use again**. The flag survives catalogue refreshes and backups.
- **Base values** — each breed's attribute base is inferred from the solved magnitudes, and animals of different breeds are now compared through their base gap. Horses: 513 of 879 effects known.
- Beewasps are studied too, in one shared pool. There is no real beewasp data yet, so this is not validated.
- Solved magnitudes persist across sessions and re-solve only when an input changes.

## Where the numbers show up

- **Breed** — per-attribute objectives rank by attribute points where the study measured them, and by positive count where it did not. A pair carrying one +5 gene now outranks one carrying three +1s, and negatives count against. Column headers say how many effects are measured.
- **Impact lens** — a fourth pet-grid view, and a Rarity | Impact toggle on the Reference genome map. Measured slots are tinted by sign and size; declared but unmeasured effects are hatched. Click an attribute chip to filter, and the stats pane splits each value into Measured and Rest. Community previews get it too.
- **Trio** — an Outcome | Impact toggle. Foal cells show the chance to beat the better parent or fall below the weaker one; the panel gives, per attribute, P(beats both), the Top 25% value and P(below both). Horses need an offspring breed for this.

## Also

- **Hidden genes** — every breeding score counts a `?` locus as carrying nothing. Free up slots, Breed and the Trio now warn when that applies, and Free up slots asks for an acknowledgement before it releases an animal with hidden genes.
- **Attributes from names** — typing a structured name in the editor fills the attributes. **My Pets → Fill from names** fills unmeasured pets in one step and lists disagreements on measured ones. BeeWasp structured names are now parsed.
- Whether a pet's attributes are real readings is now stored, not re-read from the name, so a rename no longer drops an animal from the study.
- Community imports are now added unstabled.
- Reference uses the same remembered species selector as Breed.
- Fix: restoring a backup keeps each animal's study exclusion.
- Dependency updates to Firebase, jszip, `tauri-plugin-sql`, Biome and Playwright.
