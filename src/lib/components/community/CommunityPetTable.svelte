<script>
import StatusBanner from '$lib/components/shared/StatusBanner.svelte';
import StatusPane from '$lib/components/shared/StatusPane.svelte';
import { communityView, loadInitial, loadMore } from '$lib/stores/community.svelte.js';
import CommunityPetRow from './CommunityPetRow.svelte';
</script>

<div class="community-table" data-testid="community-table">
  {#if communityView.loading && communityView.pets.length === 0}
    <div data-testid="community-loading">
      <StatusPane variant="loading" body="Loading catalogue…" />
    </div>
  {:else if communityView.error && communityView.pets.length === 0}
    <div data-testid="community-error">
      <StatusPane
        variant="error"
        body={communityView.error}
        actionLabel="Try again"
        onAction={() => loadInitial({ force: true })}
      />
    </div>
  {:else if communityView.pets.length === 0}
    <div data-testid="community-empty">
      <StatusPane variant="empty" body="The catalogue is empty — be the first to share a pet." />
    </div>
  {:else}
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Character</th>
            <th>Species</th>
            <th>Tags</th>
            <th class="col-uploaded">Uploaded</th>
          </tr>
        </thead>
        <tbody>
          {#each communityView.pets as pet (pet.contentHash)}
            <CommunityPetRow {pet} selected={pet.contentHash === communityView.selectedHash} />
          {/each}
        </tbody>
      </table>
    </div>

    {#if communityView.error}
      <div data-testid="community-loadmore-error">
        <StatusBanner type="error" message={communityView.error} />
      </div>
    {/if}

    <div class="table-footer">
      {#if communityView.hasMore}
        <button
          class="btn btn-secondary load-more-btn"
          data-testid="community-load-more"
          onclick={loadMore}
          disabled={communityView.loadingMore}
        >
          {communityView.loadingMore ? 'Loading…' : 'Load more'}
        </button>
      {:else}
        <span class="end-marker">
          End of catalogue · {communityView.pets.length}
          {communityView.pets.length === 1 ? 'pet' : 'pets'}
        </span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .community-table {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .table-scroll {
    flex: 1;
    overflow: auto;
    min-height: 0;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  thead {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--bg-secondary);
  }

  th {
    text-align: left;
    padding: 8px 12px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    border-bottom: 1px solid var(--border-primary);
  }

  .col-uploaded {
    text-align: right;
    white-space: nowrap;
  }

  .table-footer {
    padding: 12px 16px;
    border-top: 1px solid var(--border-primary);
    display: flex;
    justify-content: center;
    flex-shrink: 0;
  }

  .end-marker {
    font-size: 12px;
    color: var(--text-tertiary);
  }

  .load-more-btn {
    min-width: 160px;
  }
</style>
