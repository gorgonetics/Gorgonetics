# Screenshot fixtures

`stable/` holds the genome files for the horses that
`scripts/capture-quickstart-screenshots.mjs` imports before it captures the
quickstart guide.

They exist because the three bundled demo pets cannot photograph the app
honestly. Rarity, genetic quality and safe culling are all measured against a
population, and each suppresses itself below a floor the demo set never
reaches: a locus needs two pets with a reading before rarity scores it, the
Quality column needs three stabled animals of one species, and "Free up slots"
needs more than three. Shot against demo data, three of the app's headline
features photograph as empty.

The capture script imports these through the app's own drag-and-drop path, so
nothing here is a database format — each file is a plain Project Gorgon genome
export. The file's `Entity=` line becomes the pet name, and the structured-name
parser derives breed, gender and attributes from it.

`Roach` is deliberately absent: `data/Genes_Roach.txt` already ships the same
horse as a demo pet, and importing both puts two pets of that name in every
screenshot.
