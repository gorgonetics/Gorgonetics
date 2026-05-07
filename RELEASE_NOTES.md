# v0.6.2

A small but important patch. v0.6.1 shipped corrected horse gene effects, but the app's gene catalog only seeded itself on the very first launch — so anyone who already had Gorgonetics installed kept seeing the old, wrong effects after upgrading. This release fixes the upgrade path so future template fixes propagate automatically.

## Auto-refreshing gene templates

The app now hashes the bundled gene template files on each launch and re-syncs the gene catalog whenever the bundle's hash differs from what was last applied. After upgrading to v0.6.2, your catalog will pick up the v0.6.1 corrections (and any future ones) automatically — no need to wipe the database or re-import anything.

What's preserved across the refresh:

- Any **notes** you've written on individual genes via the Gene Editor — the user-authored field is the explicit carve-out and is read back from your database before each upsert.
- Pet stats — the `Total +` count on each pet is recomputed from the new effects in the background after launch, so the Stable view will update to reflect the corrected catalog automatically.

What changes:

- **effectDominant / effectRecessive / appearance / breed** track the bundled templates. If you'd previously edited any of these via the Gene Editor, those edits will be overwritten by the catalog. (See PR #219 for the rationale.)

The refresh is also defensive about edge cases — an empty bundle (resource directory missing) or a malformed JSON file abort the refresh without touching the catalog or the hash sentinel, so a launch can never silently brick the gene table.

## Dependency bumps

- `@sveltejs/kit` 2.57.1 → 2.59.1 (#206)
- `@tauri-apps/plugin-fs` 2.5.0 → 2.5.1 (#205)
