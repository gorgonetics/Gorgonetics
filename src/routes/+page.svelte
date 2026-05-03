<script>
import { onMount } from 'svelte';
import BreedingTab from '$lib/components/breeding/BreedingTab.svelte';
import ComparisonView from '$lib/components/comparison/ComparisonView.svelte';
import GeneEditingView from '$lib/components/GeneEditingView.svelte';
import PetVisualization from '$lib/components/pet/PetVisualization.svelte';
import StableTable from '$lib/components/stable/StableTable.svelte';
import { activeTab, appState, error, geneEditingView, loading, selectedPet } from '$lib/stores/pets.js';

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

	{#if $activeTab === 'stable'}
		<StableTable />
	{:else if $activeTab === 'compare'}
		<ComparisonView />
	{:else if $activeTab === 'breeding'}
		<BreedingTab />
	{:else if $loading}
		<div class="center-state">
			<div class="spinner"></div>
			<p class="state-text">Loading...</p>
		</div>
	{:else if $selectedPet}
		<PetVisualization pet={$selectedPet} />
	{:else if $geneEditingView}
		<GeneEditingView
			animalType={$geneEditingView.animalType}
			chromosome={$geneEditingView.chromosome}
		/>
	{:else}
		<div class="center-state">
			<div class="empty-icon">🐾</div>
			<p class="state-title">Select a pet to view details</p>
			<p class="state-text">Choose a pet from the list, or upload a new genome file</p>
		</div>
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

	.empty-icon {
		font-size: 48px;
		opacity: 0.4;
	}

	.state-title {
		font-size: 16px;
		font-weight: 600;
		color: var(--text-tertiary);
		margin: 0;
	}

	.state-text {
		font-size: 13px;
		color: var(--text-muted);
		margin: 0;
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--border-primary);
		border-top: 3px solid var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
