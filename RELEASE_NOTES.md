# v0.5.1

Hotfix for large stables on v0.5.0.

## Fixed

- **`positive_genes` backfill no longer blocks the loading screen.** On v0.5.0, first-launch ran the backfill synchronously inside the startup chain, which on a large stable (200+ pets, horse-heavy) could pin the main thread for several minutes and leave the app stuck on "Loading...". The backfill now runs off the critical path after the app is ready, so the UI becomes interactive immediately and the **+Genes** column fills in progressively as pets are re-read from the database.
- **Throttled work so the UI stays responsive while the backfill runs.** Pets are processed in batches of 8 with a yield to the event loop between each batch, and progress is logged as `positive_genes backfill: N/total computed` for diagnosis if it ever regresses.

No schema changes; users upgrading from v0.5.0 with an already-complete backfill are unaffected. If the v0.5.0 backfill partially ran before you force-quit, the flag was never set, so v0.5.1 picks it up from scratch on next launch — now non-blocking.
