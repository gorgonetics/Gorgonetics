<script>
import { onMount } from 'svelte';
import { initDatabase } from '$lib/services/database.js';
import { loadDemoPetsIfNeeded, populateGenesIfNeeded } from '$lib/services/demoService.js';
import { autoScanGameFolder, watchGameFolder } from '$lib/services/gameImport.js';
import { backfillParsedGeneEffectsIfNeeded } from '$lib/services/geneService.js';
import { runMigrations } from '$lib/services/migrationService.js';
import {
  backfillGeneCountsIfNeeded,
  backfillImportedFilesIfNeeded,
  backfillPetGenesIfNeeded,
  backfillPositiveGenesIfNeeded,
} from '$lib/services/petService.js';
import { appState } from '$lib/stores/pets.js';
import { settings, settingsActions } from '$lib/stores/settings.js';

const { children } = $props();
let ready = $state(false);
let liveScanRunning = false;

async function runLiveScan() {
  if (liveScanRunning) return;
  liveScanRunning = true;
  try {
    const result = await autoScanGameFolder();
    if (result.imported > 0) {
      void appState.loadPets();
    }
  } catch (err) {
    console.warn('live game-folder scan failed:', err);
  } finally {
    liveScanRunning = false;
  }
}

// Re-arm the folder watcher whenever the configured path changes.
// Reading $settings makes this effect track the store; we gate on
// `ready` so the watcher only starts after settings have been loaded
// from disk (otherwise the first read sees defaults and would arm
// twice in quick succession).
$effect(() => {
  if (!ready) return;
  // Touch the store so the effect re-fires on path changes.
  void $settings['import.gameFolderPath'];

  let cancelled = false;
  let activeStop = null;

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
  await populateGenesIfNeeded();
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

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .loading-screen p {
    color: var(--text-tertiary);
    font-size: 1.1rem;
  }

  .app-root {
    height: 100%;
  }
</style>
