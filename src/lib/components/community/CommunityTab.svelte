<script lang="ts">
import { onMount } from 'svelte';
import DetailOverlay from '$lib/components/shared/DetailOverlay.svelte';
import PageHeader from '$lib/components/shared/PageHeader.svelte';
import { clearSelection, loadInitial, selectedSharedPet } from '$lib/stores/community.svelte.js';
import { getSpeciesEmoji } from '$lib/utils/species.js';
import CommunityPetTable from './CommunityPetTable.svelte';
import CommunityPetVisualization from './CommunityPetVisualization.svelte';

onMount(() => {
  // Pull-on-demand (design §7): the catalogue loads when this tab is
  // first opened. The store short-circuits cached pages younger than
  // its `STALE_AFTER_MS` window, so toggling away from the tab and
  // back within a few minutes reuses the existing page instead of
  // burning Spark read quota.
  loadInitial();
});

// The selected row opens a full-view genome preview overlay (mirrors My
// Pets), keyed on the store's `selectedHash`. The list holds metadata-only
// SharedPets; the overlay lazy-fetches the genome blob itself.
const selected = $derived(selectedSharedPet());
</script>

<div class="community-tab" data-testid="community-tab">
  <div class="ct-main" class:hidden={selected}>
    <PageHeader
      icon="🌐"
      title="Community catalogue"
      subtitle="Browse pets shared by other players. Click a row to preview its genome, then import it to your stable."
    />
    <div class="ct-table">
      <CommunityPetTable />
    </div>
  </div>

  {#if selected}
    <DetailOverlay
      testid="community-detail-overlay"
      backTestid="community-detail-back"
      backLabel="← Catalogue"
      ariaLabel="Community pet detail"
      onBack={clearSelection}
    >
      {#snippet title()}{getSpeciesEmoji(selected.species)} {selected.name || '(unnamed)'}{/snippet}
      <CommunityPetVisualization pet={selected} />
    </DetailOverlay>
  {/if}
</div>

<style>
  .community-tab {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .ct-main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .ct-main.hidden {
    display: none;
  }

  .ct-table {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
</style>
