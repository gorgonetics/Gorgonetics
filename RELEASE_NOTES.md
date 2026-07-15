# v0.8.0

A major release built around a complete UI redesign, alongside new community and breeding functionality. Still pre-1.0 while the redesign settles.

## Redesigned interface

- Ground-up redesign of the library workspace: unified chrome primitives, pet rows, filter bar, and modals for a consistent look across the app.
- New genome/gene grid with consistent fill and dimming behaviour.
- Workspace "lenses" for switching how the library is viewed, plus a dedicated breed lens.
- Unified trio overlay and grid filters so the same controls behave the same way everywhere.
- Redesigned community shell and side-by-side comparison view.
- A shared design-token system underpinning colours, spacing, and typography.

## Community

- Submit and track community attribute corrections for shared pets, with corrections bound to the correct pet identity.
- Auto-share on import, plus share-all and bulk-share flows for pushing pets to the community catalogue.
- Import feedback and filtering when browsing the community.

## Breeding

- Breeding bench batches for working through multiple pairings.
- Trio offspring outcome map for visualising projected offspring across a pairing.
- Pool-gap pairing weight factored into breeding-pair suggestions.

## Fixes & performance

- Numerous regression fixes from the redesign cutover (detail header, overlay layering, breed destination, correction identity binding, detail-pane and backfill races).
- Performance work on the gene visualizer (CSS filters) and trio gradient bars.
