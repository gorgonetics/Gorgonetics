# v0.9.4

The breeding scores now show their work. A ranked pair told you which number won and never what produced it; the Trio and the pair table now answer that. Still pre-1.0.

## What the Trio shows

Select a pair and the offspring projection explains its own ranking.

- **Tint by score contribution** — colour the offspring row by each locus's share of **Quality**, **Pool-weighted +** or **Total +**, so you can see which slots carry the score rather than inferring it.
- **Clarification** — the mean, the spread and the baseline behind **Ceiling**, **Floor** and **Cleanup**. Ceiling and Floor share a mean and a spread and differ only in their baseline (the better and the weaker parent); Cleanup reads against the cleaner parent's negatives.

Only the first three scores are a sum over loci, so only they get a lens. Ceiling, Floor and Cleanup are `E[max(0, X − baseline)]` taken after the loop, and that integral's gradient with respect to the mean is one constant across the genome — a per-locus Ceiling lens would rank identically to Floor's and to Total +'s, so it is deliberately not built.

## What the pair table shows

Absolute columns now carry the reference you should read them against.

- Each parent's own positive count sits beside its name, on the same locus basis and breed scope as the offspring figures.
- **Total +** and every attribute column carry an unclamped signed gap against the better parent. Ceiling bottoms out at zero, so on its own it cannot separate a foal one positive short of the better parent from one ninety short. The gap can. A difference that rounds to nothing is left off rather than shown as a decorative `+0.0`.

No gap is shown on the pool-weighted column or on Mixed/Unknown: those figures are weighted and the parents' counts are not, so subtracting them would compare different units. The parent counts on the row remain the honest reference there.

## One rename

**Pool gain** is now **Pool-weighted +**. It re-weights an absolute positive count by how thinly the pool already covers each slot; it does not measure a gain over the parents, and a positive both parents already breed true still scores, at the lowest weight. Display only — the sort key is unchanged, so saved sort settings still apply.

## Notes

Also in this release: dependency updates to Svelte, SvelteKit, Vite, Biome, `@lucide/svelte`, `tauri-plugin-sql` and `tauri-plugin-log`.
