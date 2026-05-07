# v0.6.1

A small patch release to ship hand-verified horse gene effect corrections and stabilise the gene editor export format so future fixes round-trip cleanly against the bundled asset files.

## Horse gene effect corrections

Eight genes across six chromosomes had their dominant/recessive effects wrong in the bundled templates. Each correction was reviewed manually against in-game data:

- **chr15** `15D1` — Ruggedness+ moved from dominant to recessive
- **chr16** `16J4` — dominant set to Toughness+
- **chr20** `20F2`/`20F3` — Intelligence+ moved from F2 dominant to F3 dominant
- **chr22** `22E2` — Virility+ moved from recessive to dominant
- **chr24** `24B3` — cleared a stray dominant Toughness+
- **chr42** `42E3`/`42E4` — recessive Intelligence+ corrected to Ruggedness+

If you previously imported the demo gene set, the app will pick up these corrections on next launch. (#214)

## Gene editor export round-trip

The chromosome export had two papercuts that produced massive cosmetic diffs whenever an exported file was used to update the bundled assets:

- The exported filename had a duplicated `chr` prefix (e.g. `horse_genes_chrchr15.json`).
- The field order put `notes` before `breed`, while asset files used the reverse — and a cleared effect was written as `""` instead of `"None"`.

Both are fixed: the editor now exports byte-identical JSON to the asset files when no edits are made. All 58 horse + beewasp asset files were also reordered to the canonical export shape (purely cosmetic — no gene effects changed by this rewrite). New tests lock in the export contract by round-tripping three real asset files through the gene editor pipeline. (#215)

## New asset invariant tests

Two species-specific data invariants are now enforced in CI:

- **Beewasp**: dominant alleles always carry a negative or `"None"` effect; recessive alleles always positive or `"None"`. (#215)
- **Horse**: chromosome 1 genes always carry a negative dominant *and* a positive recessive effect; genes on chr02..chr48 carry an effect on at most one allele. (#215)

A future asset edit that violates either rule will fail the test suite without needing chromosome-by-chromosome manual review.

## Other fixes

- Genome diff totals no longer count padded grid cells, and the per-species total is now sourced from the gene catalog rather than a hardcoded constant. (#212, #213)
- `pnpm-workspace.yaml` whitelists `esbuild` builds so fresh `pnpm install` runs no longer get blocked on the build-script approval prompt. (#203)

## Dependency bumps

- `tauri` 2.10.3 → 2.11.0 (#206)
- `tauri-plugin-fs` 2.5.0 → 2.5.1 (#210)
- `tauri-plugin-dialog` 2.7.0 → 2.7.1 (#211)
- `@tauri-apps/api` 2.10.1 → 2.11.0 (#208)
- `@tauri-apps/cli` 2.10.1 → 2.11.0 (#204)
