<script>
import { onMount } from 'svelte';
import { communityView, loadInitial } from '$lib/stores/community.svelte.js';
import CommunityPetDetail from './CommunityPetDetail.svelte';
import CommunityPetTable from './CommunityPetTable.svelte';

onMount(() => {
  // Pull-on-demand only (design §7): the catalogue loads when this tab is
  // first opened. Re-mounting on tab return re-fetches — acceptable
  // because the Spark read quota is generous for the realistic scale.
  loadInitial();
});
</script>

<div class="community-tab" data-testid="community-tab">
  <header class="community-header">
    <h2>Community catalogue</h2>
    <p class="subtitle">
      Browse pets shared by other players. Click a row to preview, then import to add it
      to your stable.
    </p>
  </header>

  <div class="community-body">
    <div class="community-table-pane">
      <CommunityPetTable />
    </div>

    <aside class="community-detail-pane">
      {#if communityView.selectedHash}
        <CommunityPetDetail />
      {:else}
        <div class="empty-state" data-testid="community-empty-selection">
          <div class="empty-icon">🐾</div>
          <p class="empty-title">Select a pet to see details</p>
          <p class="empty-text">Click any row in the catalogue to preview its genome and import.</p>
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

  .community-header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-primary);
    flex-shrink: 0;
  }

  .community-header h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .subtitle {
    margin: 4px 0 0;
    color: var(--text-tertiary);
    font-size: 13px;
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

  .empty-state {
    padding: 32px 20px;
    text-align: center;
    color: var(--text-tertiary);
  }

  .empty-icon {
    font-size: 32px;
    margin-bottom: 12px;
  }

  .empty-title {
    margin: 0;
    font-size: 14px;
    color: var(--text-primary);
    font-weight: 600;
  }

  .empty-text {
    margin: 8px 0 0;
    font-size: 12px;
  }
</style>
