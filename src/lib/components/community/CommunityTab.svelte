<script lang="ts">
import { onMount } from 'svelte';
import EmptyState from '$lib/components/shared/EmptyState.svelte';
import PageHeader from '$lib/components/shared/PageHeader.svelte';
import { communityView, loadInitial } from '$lib/stores/community.svelte.js';
import CommunityPetDetail from './CommunityPetDetail.svelte';
import CommunityPetTable from './CommunityPetTable.svelte';

onMount(() => {
  // Pull-on-demand (design §7): the catalogue loads when this tab is
  // first opened. The store short-circuits cached pages younger than
  // its `STALE_AFTER_MS` window, so toggling away from the tab and
  // back within a few minutes reuses the existing page instead of
  // burning Spark read quota.
  loadInitial();
});
</script>

<div class="community-tab" data-testid="community-tab">
  <PageHeader
    icon="🌐"
    title="Community catalogue"
    subtitle="Browse pets shared by other players. Click a row to preview, then import to add it to your stable."
  />

  <div class="community-body">
    <div class="community-table-pane">
      <CommunityPetTable />
    </div>

    <aside class="community-detail-pane">
      {#if communityView.selectedHash}
        <CommunityPetDetail />
      {:else}
        <div data-testid="community-empty-selection" class="community-empty">
          <EmptyState
            icon="🐾"
            title="Select a pet to see details"
            body="Click any row in the catalogue to preview its genome and import it."
          />
        </div>
      {/if}
    </aside>
  </div>
</div>

<style>
  .community-tab {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .community-body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .community-table-pane {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .community-detail-pane {
    width: 360px;
    flex-shrink: 0;
    border-left: 1px solid var(--border-primary);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .community-empty {
    flex: 1;
    min-height: 0;
  }
</style>
