# v0.5.2

Pure performance round — no behavior changes, no schema migrations. A repo-wide audit found work that was being repeated unnecessarily; this release collapses it.

## Faster

- **Backup import parses the zip exactly once.** The dialog used to inspect, validate, and import the same archive — three full `JSZip.loadAsync` passes. The flow now threads the parsed instance through the dialog, so a large backup decompresses once instead of three times. (#93)
- **Bulk pet and image uploads are no longer O(N · existing).** `uploadPet` and `addImage` previously fetched every existing `sort_order` row to compute the next one. Replaced with a single `MAX(sort_order)` scalar query each — bulk uploads now scale with how many *new* rows are coming in, not with how big the stable already is. (#158, #159)
- **Backup import writes are batched and atomic.** Gene, pet, and pet-tag inserts collapse from one IPC round-trip per row to one per chunk, and the whole import now runs through `db.transaction()` on a pinned connection — so a partial failure in replace mode no longer leaves a half-wiped database. (#160)
- **Gene visualizer hot path is leaner.** The per-effect-string attribute scan is replaced with a per-species memoised matcher (one regex pass instead of N substring scans), and the species/attribute lookup tables are precomputed once at module load instead of rebuilt on every accessor call. (#157, #163)
- **Image gallery reuses asset-protocol URLs.** `getImageUrl` was calling `appDataDir()` + `join()` over Tauri IPC for every image on every render. Results are now cached by `petId/filename` and invalidated on delete, so scrolling and filtering galleries no longer hammer the IPC bridge. (#162)

## Cleaner internals

- **Gene-color palette has a single source of truth.** Values used to be hand-maintained in `gene-colors.ts` and `app.css` simultaneously, with both files commenting that the *other* one was canonical. Now `gene-colors-data.json` is the only place colours live; the TS module imports it and `gene-colors.generated.css` is regenerated from the same JSON at build time. (#168)
- **Smaller assorted cleanups** in `StableTable`, `PetList`, `PetEditor`, and the visualizer template cache key. (#164–#167)

## Known caveat (unchanged)

- Backup *export* still materialises the full zip in memory. For typical libraries (a few hundred MB) this is fine; tracked separately for a future memory-pressure pass. (#92)
