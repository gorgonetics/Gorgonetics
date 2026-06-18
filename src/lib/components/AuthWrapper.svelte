<script>
import { onMount } from 'svelte';
import { initDatabase } from '$lib/services/database.js';
import { loadDemoPetsIfNeeded, refreshGeneTemplatesIfChanged } from '$lib/services/demoService.js';
import { autoScanGameFolder, watchGameFolder } from '$lib/services/gameImport.js';
import { backfillParsedGeneEffectsIfNeeded } from '$lib/services/geneService.js';
import { runMigrations } from '$lib/services/migrationService.js';
import {
  backfillGeneCountsIfNeeded,
  backfillImportedFilesIfNeeded,
  backfillPetGenesIfNeeded,
  backfillPositiveGenesIfNeeded,
} from '$lib/services/petService.js';
import { refreshPendingImportCount } from '$lib/stores/gameImport.js';
import { appState } from '$lib/stores/pets.js';
import { settings, settingsActions } from '$lib/stores/settings.js';

const { children } = $props();
let ready = $state(false);
let liveScanRunning = false;
let pendingRescan = false;

async function runLiveScan() {
  // Drop into a queued state instead of starting a parallel scan —
  // a file written during a long scan would otherwise be missed
  // until the next unrelated event.
  if (liveScanRunning) {
    pendingRescan = true;
    return;
  }
  liveScanRunning = true;
  try {
    do {
      pendingRescan = false;
      // autoScanGameFolder refreshes the pets store itself on a DB change (#253).
      await autoScanGameFolder();
    } while (pendingRescan);
  } catch (err) {
    console.warn('live game-folder scan failed:', err);
  } finally {
    liveScanRunning = false;
    pendingRescan = false;
    // Whatever the scan imported, the pending badge should reflect what's left.
    void refreshPendingImportCount();
  }
}

// Track only the configured path. Reading $settings directly inside
// the effect would re-fire on any settings write (theme, font scale,
// etc.) because the store spreads a new object on every update;
// $derived memoizes on the computed value so unrelated keys don't
// thrash the watcher.
const gameFolderPath = $derived($settings['import.gameFolderPath'] ?? '');

$effect(() => {
  if (!ready) return;
  void gameFolderPath;

  let cancelled = false;
  let activeStop = null;

  // Recompute the pending badge whenever the watched folder is (re)armed —
  // covers app startup (ready flips true) and the user changing the path.
  void refreshPendingImportCount();

  void (async () => {
    try {
      const stop = await watchGameFolder(runLiveScan);
      if (cancelled) {
        if (stop) await stop();
        return;
      }
      activeStop = stop;
    } catch (err) {
      console.warn('failed to start game-folder watcher:', err);
    }
  })();

  return () => {
    cancelled = true;
    if (activeStop) {
      void activeStop();
      activeStop = null;
    }
  };
});

onMount(async () => {
  await initDatabase();
  await runMigrations();
  await refreshGeneTemplatesIfChanged();
  await loadDemoPetsIfNeeded();
  await settingsActions.load();
  ready = true;

  // Run startup backfills sequentially, off the critical path. They each
  // briefly hold SQLite's writer lock; running them in parallel just makes
  // them fight for it. parsed-effects must come first because positive_genes
  // reads the parsed columns it populates. Reload pets after each backfill
  // that affects pet-row columns so the UI surfaces updates without waiting
  // for the slow ones (pet_genes can take minutes on big stables).
  void (async () => {
    try {
      await backfillParsedGeneEffectsIfNeeded();
    } catch (err) {
      console.warn('parsed-effects backfill aborted:', err);
    }

    try {
      await backfillPositiveGenesIfNeeded();
      void appState.loadPets();
    } catch (err) {
      console.warn('positive_genes backfill aborted:', err);
    }

    try {
      await backfillPetGenesIfNeeded();
    } catch (err) {
      console.warn('pet_genes backfill aborted:', err);
    }

    try {
      await backfillGeneCountsIfNeeded();
      void appState.loadPets();
    } catch (err) {
      console.warn('gene_counts backfill aborted:', err);
    }

    try {
      await backfillImportedFilesIfNeeded();
    } catch (err) {
      console.warn('imported_files backfill aborted:', err);
    }
    // The ledger the pending count reads is only populated once this backfill
    // runs (legacy DBs start without it), so recompute now that it's seeded —
    // otherwise the startup count can over-report until the next scan/event.
    void refreshPendingImportCount();
  })();
});
</script>

{#if !ready}
  <div class="loading-screen">
    <div class="loading-spinner"></div>
    <p>Loading...</p>
  </div>
{:else}
  <div class="app-root">
    {@render children()}
  </div>
{/if}

<style>
  .loading-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    background-color: var(--bg-secondary);
  }

  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 4px solid var(--border-primary);
    border-top: 4px solid var(--accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 1rem;
  }


  .loading-screen p {
    color: var(--text-tertiary);
    font-size: 1.1rem;
  }

  .app-root {
    height: 100%;
  }
</style>
