<script lang="ts">
import { onMount } from 'svelte';
import BreedView from '$lib/components/breeding/BreedView.svelte';
import CommunityTab from '$lib/components/community/CommunityTab.svelte';
import ReferenceView from '$lib/components/gene/ReferenceView.svelte';
import MyPets from '$lib/components/library/MyPets.svelte';
import { activeTab, appState, error, loading } from '$lib/stores/pets.js';

onMount(async () => {
  await appState.loadPets();
});
</script>

<div class="detail-content">
	{#if $error}
		<div class="error-banner" role="alert">
			<div class="error-message">⚠️ {$error}</div>
			<button class="error-close" onclick={() => appState.clearError()} aria-label="Dismiss error">×</button>
		</div>
	{/if}

	{#if $loading}
		<div class="center-state">
			<div class="spinner"></div>
			<p class="state-text">Loading...</p>
		</div>
	{:else if $activeTab === 'reference'}
		<ReferenceView />
	{:else if $activeTab === 'breed'}
		<BreedView />
	{:else if $activeTab === 'community'}
		<CommunityTab />
	{:else}
		<MyPets />
	{/if}
</div>

<style>
	.detail-content {
		display: flex;
		flex-direction: column;
		position: absolute;
		inset: 0;
	}

	.error-banner {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 8px 16px;
		background: var(--error-bg);
		border-bottom: 1px solid var(--error-border);
		color: var(--error-text);
		font-size: 13px;
		flex-shrink: 0;
		max-height: 35vh;
	}

	.error-message {
		flex: 1;
		overflow-y: auto;
		max-height: calc(35vh - 16px);
		white-space: pre-wrap;
		word-break: break-word;
	}

	.error-close {
		flex-shrink: 0;
		background: none;
		border: none;
		font-size: 16px;
		cursor: pointer;
		color: var(--error-text);
		padding: 0 4px;
	}

	.center-state {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		color: var(--text-muted);
	}

	.state-text {
		font-size: 13px;
		color: var(--text-muted);
		margin: 0;
	}

</style>
