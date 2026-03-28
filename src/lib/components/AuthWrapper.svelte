<script>
  import { onMount } from 'svelte';
  import { initDatabase } from '$lib/services/database.js';
  import { populateGenesIfNeeded, loadDemoPetsIfNeeded } from '$lib/services/demoService.js';

  const { children } = $props();
  let ready = $state(false);

  onMount(async () => {
    await initDatabase();
    await populateGenesIfNeeded();
    await loadDemoPetsIfNeeded();
    ready = true;
  });
</script>

{#if !ready}
  <div class="loading-screen">
    <div class="loading-spinner"></div>
    <p>Loading...</p>
  </div>
{:else}
  {@render children()}
{/if}

<style>
  .loading-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    background-color: #f8fafc;
  }

  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 4px solid #e5e7eb;
    border-top: 4px solid #3b82f6;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 1rem;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .loading-screen p {
    color: #6b7280;
    font-size: 1.1rem;
  }
</style>
