<script>
	import { onMount } from 'svelte';
	import {
		selectedPet,
		loading,
		error,
		geneEditingView,
		appState,
	} from '$lib/stores/pets.js';
	import PetVisualization from '$lib/components/pet/PetVisualization.svelte';
	import GeneEditingView from '$lib/components/GeneEditingView.svelte';

	onMount(async () => {
		await appState.loadPets();
	});
</script>

<div class="detail-content">
	{#if $error}
		<div class="error-banner" role="alert">
			<span>⚠️ {$error}</span>
			<button class="error-close" onclick={() => appState.clearError()}>×</button>
		</div>
	{/if}

	{#if $loading}
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
		height: 100%;
		min-height: 0;
	}

	.error-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 16px;
		background: #fef2f2;
		border-bottom: 1px solid #fecaca;
		color: #dc2626;
		font-size: 13px;
		flex-shrink: 0;
	}

	.error-close {
		background: none;
		border: none;
		font-size: 16px;
		cursor: pointer;
		color: #dc2626;
		padding: 0 4px;
	}

	.center-state {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		color: #9ca3af;
	}

	.empty-icon {
		font-size: 48px;
		opacity: 0.4;
	}

	.state-title {
		font-size: 16px;
		font-weight: 600;
		color: #6b7280;
		margin: 0;
	}

	.state-text {
		font-size: 13px;
		color: #9ca3af;
		margin: 0;
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid #e5e7eb;
		border-top: 3px solid #3b82f6;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
