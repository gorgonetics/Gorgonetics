# v0.11.0

You can now send gene effect corrections to the maintainer from the app, and the Quality score shows which genes make a pet valuable.

- **Report gene corrections.** After you change a gene's effect in the Genes editor and save, a **Report upstream** button appears. It shows every field that will be sent and lets you add a note. No account is needed. The maintainer checks each report and corrects the bundled gene data in a later release. Nothing is sent until you click Send.
- **Your gene edits survive updates.** An update that changes the bundled gene data no longer overwrites the effects you edited. Effects you did not edit take the new bundled values.
- **Quality lens.** A new lens in the pet view shows, for each gene, whether this pet is the only carrier of a benefit allele, the only true breeder, or backed up by other pets. The Stats drawer lists the genes behind the Quality score, most valuable first.
- **Recessive alleles are judged per sex.** A recessive outcome needs a copy from each parent, so a male and a female that both carry it no longer count as backing each other up. This changes the Quality score, the cull suggestions and the breeding gain.
- **Community pets** open in the same detail view as your own pets, with all four lenses and the Stats drawer.
- **Base values** tab in Study: one table of breeds by attributes, showing each base value as exact, a range, a one-sided bound or unknown.
- **Gene data fixes** reported by a player: horse 26B3's recessive effect is now Toughness−, and horse 47I3's Virility+ is now dominant instead of recessive.
