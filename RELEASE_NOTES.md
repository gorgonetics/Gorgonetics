# v0.10.3

My Pets now shows every column for every species, and the database is much smaller.

- **My Pets table** is laid out like the Community table. Attribute columns, Total and Quality now show without a species selected. Each attribute is filled only where it applies to that row's species, and shows a dash elsewhere. New **Species** and **Imported** columns are added; Imported sorts newest first on the first click.
- **Quality under "All"** scores each species against its own stabled animals. A pet's share is of its own species' total, and the tooltip names the species. A species with too few stabled animals is marked as not scored, with the reason.
- **Attribute order** is now the order a structured name spells them, everywhere: the species' own attribute first, then Toughness, Ruggedness, Enthusiasm, Friendliness, Intelligence, Virility. This applies to My Pets, Community, Breed, the Trio, the stats table, the pet editor and the Study tabs.
- **Smaller database.** Each pet's genes are now stored in one compact column, and the parsed-genome copy is removed. On a 492-pet stable the file goes from 141.5 MB to 4.9 MB. The first launch after the update converts the database once, so it can take longer than usual.
- **Faster Study.** The solver is about twice as fast, and the Study tab keeps its result for the session, so it opens again without a new solve.
- Backups now include each pet's stored genes, so a restore keeps pets that have no genome file.
- Fix: importing a backup now clears cached results, so Breed and Study do not show data from before the import.
