<script>
import { communityView, loadInitial, loadMore } from '$lib/stores/community.svelte.js';
import CommunityPetRow from './CommunityPetRow.svelte';
</script>

<div class="community-table" data-testid="community-table">
  {#if communityView.loading && communityView.pets.length === 0}
    <div class="state-row" data-testid="community-loading">
      <div class="spinner"></div>
      <p>Loading catalogue…</p>
    </div>
  {:else if communityView.error && communityView.pets.length === 0}
    <div class="state-row state-error" role="alert" data-testid="community-error">
      <p>{communityView.error}</p>
      <button class="btn btn-secondary" onclick={() => loadInitial({ force: true })}>Try again</button>
    </div>
  {:else if communityView.pets.length === 0}
    <div class="state-row" data-testid="community-empty">
      <p>The catalogue is empty — be the first to share a pet.</p>
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
      <div
        class="state-row state-error inline-error"
        role="alert"
        data-testid="community-loadmore-error"
      >
        <p>{communityView.error}</p>
        <button class="btn btn-secondary" onclick={loadMore}>Try again</button>
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
        <span class="end-marker">End of catalogue · {communityView.pets.length} pets</span>
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

  .state-row {
    padding: 32px 20px;
    text-align: center;
    color: var(--text-tertiary);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .state-error p {
    color: var(--text-primary);
  }

  .inline-error {
    padding: 12px 16px;
    border-top: 1px solid var(--border-primary);
    border-bottom: none;
    flex-direction: row;
    justify-content: space-between;
    text-align: left;
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--border-primary);
    border-top-color: var(--accent-text);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
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
