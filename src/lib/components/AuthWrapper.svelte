<script>
import { onMount } from 'svelte';
import { initDatabase } from '$lib/services/database.js';
import { loadDemoPetsIfNeeded, populateGenesIfNeeded } from '$lib/services/demoService.js';
import { backfillParsedGeneEffectsIfNeeded } from '$lib/services/geneService.js';
import { runMigrations } from '$lib/services/migrationService.js';
import { backfillPetGenesIfNeeded, backfillPositiveGenesIfNeeded } from '$lib/services/petService.js';
import { appState } from '$lib/stores/pets.js';
import { settingsActions } from '$lib/stores/settings.js';

const { children } = $props();
let ready = $state(false);

onMount(async () => {
  await initDatabase();
  await runMigrations();
  await populateGenesIfNeeded();
  await loadDemoPetsIfNeeded();
  await settingsActions.load();
  ready = true;

  // The gene-effects DB is populated, so backfill can compute positive_genes
  // for existing pets — but we deliberately don't await it. On large stables
  // it's CPU-bound enough to block the UI for minutes; running it off the
  // critical path lets the app open immediately and the stable table fills
  // in as pets are re-read from the DB.
  backfillPositiveGenesIfNeeded()
    .then(() => {
      // Refresh the pets store so updated positive_genes values surface
      // without a manual reload.
      void appState.loadPets();
    })
    .catch((err) => {
      console.warn('positive_genes backfill aborted:', err);
    });

  backfillParsedGeneEffectsIfNeeded().catch((err) => {
    console.warn('parsed-effects backfill aborted:', err);
  });

  backfillPetGenesIfNeeded()
    .then(() => {
      void appState.loadPets();
    })
    .catch((err) => {
      console.warn('pet_genes backfill aborted:', err);
    });
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
