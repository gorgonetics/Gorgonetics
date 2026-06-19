<script>
import GenomeGridTrio from '$lib/components/comparison/GenomeGridTrio.svelte';
import { normalizeSpecies } from '$lib/services/configService.js';
import { focusTrap } from '$lib/utils/focusTrap.js';
import { getSpeciesEmoji } from '$lib/utils/species.js';

/**
 * @typedef {Object} Props
 * @property {import('$lib/stores/breeding.svelte.js').SelectedBreedingPair} pair
 * @property {string} [offspringBreed]
 * @property {() => void} onClose
 */

/** @type {Props} */
const { pair, offspringBreed = '', onClose } = $props();

const father = $derived(pair.male);
const mother = $derived(pair.female);
const speciesLabel = $derived(father ? normalizeSpecies(father.species) : '');
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="modal-backdrop"
    onclick={onClose}
    onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
    role="presentation"
>
    <div
        class="dialog trio-dialog"
        role="dialog"
        aria-label="Offspring trio"
        aria-modal="true"
        tabindex="-1"
        use:focusTrap
        data-testid="trio-view"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
        <div class="dialog-header">
            <h3 class="trio-title">
                <span class="parent-name father">♂ {father?.name}</span>
                <span class="cross">×</span>
                <span class="parent-name mother">♀ {mother?.name}</span>
                {#if speciesLabel}
                    <span class="species-badge">{getSpeciesEmoji(father?.species)} {speciesLabel}</span>
                {/if}
                {#if offspringBreed}
                    <span class="breed-badge">{offspringBreed}</span>
                {/if}
            </h3>
            <button type="button" class="close-btn" onclick={onClose} aria-label="Close trio view">×</button>
        </div>

        <div class="dialog-body trio-body">
            <GenomeGridTrio {father} {mother} {offspringBreed} />
        </div>
    </div>
</div>

<style>
    .trio-dialog {
        width: 92%;
        max-width: 1100px;
        max-height: 88vh;
        display: flex;
        flex-direction: column;
    }

    .trio-title {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin: 0;
    }

    .parent-name { font-weight: 700; }
    .parent-name.father { color: var(--accent); }
    .parent-name.mother { color: #a855f7; }
    .cross { color: var(--text-muted); font-weight: 500; }

    .species-badge,
    .breed-badge {
        font-size: 12px;
        font-weight: 500;
        padding: 2px 8px;
        background: var(--bg-tertiary);
        border-radius: 10px;
        color: var(--text-secondary);
        white-space: nowrap;
    }

    /* Body scrolls on its own so the wide grid never pushes the page. */
    .trio-body {
        flex: 1;
        min-height: 0;
        overflow: auto;
    }
</style>
