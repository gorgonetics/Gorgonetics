# v0.7.0

A feature release covering community pet sharing, offspring breeding projections, and import/backup improvements.

## Community pet sharing

- New **Community** tab to browse a public catalogue of shared pets.
- Share any pet to the community via a dedicated dialog; the catalogue is split into metadata and genome collections so browsing stays fast.
- Firebase-backed, with App Check protecting public reads.

## Breeding — offspring trio view

- New trio genome grid showing Father / Offspring / Mother side by side, with a per-locus offspring projection and gain/risk verdicts.
- Inspect any ranked breeding pair to open its trio view.
- Filter the trio by offspring breed and focus on a single attribute.
- Locked-in gains now recognise shared recessive positives, not just dominants.

## Import & upload

- Drag-and-drop genome files directly onto the pet list to import them.
- Pending-import count badge on the auto-scan button.

## Backup & updates

- The updater backs up the current install before applying an update, so a failed update can be rolled back.
- Export streams the archive natively to keep memory bounded on large libraries, and warns before exporting a very large image library.

## Accessibility & navigation

- Keyboard-accessible reordering for the pet list and gallery.
- Back navigation between tabs.

## Under the hood

- Full migration of the frontend to TypeScript with `checkJs` enabled for end-to-end type coverage.
- Numerous correctness and review fixes across community, breeding, comparison, and the pet stores.
