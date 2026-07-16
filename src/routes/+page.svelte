<script lang="ts">
import { onMount } from 'svelte';
import BreedView from '$lib/components/breeding/BreedView.svelte';
import CommunityTab from '$lib/components/community/CommunityTab.svelte';
import ReferenceView from '$lib/components/gene/ReferenceView.svelte';
import SettingsView from '$lib/components/layout/SettingsView.svelte';
import MyPets from '$lib/components/mypets/MyPets.svelte';
import PetEditor from '$lib/components/pet/PetEditor.svelte';
import StatusBanner from '$lib/components/shared/StatusBanner.svelte';
import { activeTab, appState, error, loading, notice, pets } from '$lib/stores/pets.js';
import { editingPet, settingsOpen, uiActions } from '$lib/stores/ui.js';

onMount(async () => {
  await appState.loadPets();
});
</script>

<div class="detail-content">
	<!-- The tab content is covered by the in-space overlays below. `inert` is
	     bound reactively (not set once on mount by DetailOverlay's sibling
	     logic) so that switching tabs while an overlay is open re-inerts the
	     freshly-rendered tab content, keeping focus/AT out of the covered UI. -->
	<div class="tab-layer" inert={$editingPet !== null || $settingsOpen}>
		{#if $error}
			<div class="error-banner" role="alert">
				<div class="error-message">⚠️ {$error}</div>
				<button class="error-close" onclick={() => appState.clearError()} aria-label="Dismiss error">×</button>
			</div>
		{/if}

		{#if $notice}
			<StatusBanner type="success" message={$notice} toast autoDismissMs={8000} onDismiss={() => appState.clearNotice()} />
		{/if}

		{#if $loading && $pets.length === 0}
			<!-- Full-screen spinner only on the INITIAL load, when there's nothing to
			     show yet. `$loading` also flips true for background reloads (e.g. an
			     import/backfill re-running loadPets); gating on those blanked the whole
			     destination to a spinner and remounted the active view mid-interaction —
			     tearing down an open overlay (e.g. the breeding trio). With data already
			     present, keep the current view mounted and let it update in place. -->
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

	{#if $editingPet}
		{#key $editingPet.id}
			<PetEditor pet={$editingPet} onClose={uiActions.closeEditor} onSave={uiActions.closeEditor} />
		{/key}
	{/if}

	{#if $settingsOpen}
		<SettingsView onClose={uiActions.closeSettings} />
	{/if}
</div>

<style>
	.detail-content {
		display: flex;
		flex-direction: column;
		position: absolute;
		inset: 0;
	}

	.tab-layer {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
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
