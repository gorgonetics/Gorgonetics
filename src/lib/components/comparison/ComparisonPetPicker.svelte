<script>
import { normalizeSpecies } from '$lib/services/configService.js';
import { comparisonActions, comparisonPets, speciesMismatch } from '$lib/stores/comparison.js';
import { pets } from '$lib/stores/pets.js';
import { getSpeciesEmoji } from '$lib/utils/species.js';

let searchQuery = $state('');

// Auto-filter to same species as Slot A
const slotASpecies = $derived($comparisonPets[0] ? normalizeSpecies($comparisonPets[0].species) : '');

const filteredPets = $derived.by(() => {
  const q = searchQuery ? searchQuery.toLowerCase() : '';
  return $pets.filter((pet) => {
    // Don't show already-selected pets
    if ($comparisonPets[0]?.id === pet.id || $comparisonPets[1]?.id === pet.id) return false;
    // Search filter
    if (q && !(pet.name || '').toLowerCase().includes(q) && !(pet.species || '').toLowerCase().includes(q)) {
      return false;
    }
    // Species filter: when Slot A is filled, only show same species
    if (slotASpecies && normalizeSpecies(pet.species) !== slotASpecies) return false;
    return true;
  });
});

function handlePetClick(pet) {
  comparisonActions.addPet(pet);
}
</script>

<div class="comparison-picker">
    <h3 class="picker-title">Compare Pets</h3>

    <div class="picker-slots">
        <div class="slot-label">Pet A</div>
        <div class="picker-slot" class:filled={$comparisonPets[0]}>
            {#if $comparisonPets[0]}
                <span class="slot-pet">
                    <span class="slot-emoji">{getSpeciesEmoji($comparisonPets[0].species)}</span>
                    <span class="slot-name">{$comparisonPets[0].name}</span>
                </span>
                <button class="slot-clear" onclick={() => comparisonActions.setPet(0, null)} title="Remove">×</button>
            {:else}
                <span class="empty-slot">Pick a pet...</span>
            {/if}
        </div>

        <button class="swap-btn" onclick={() => comparisonActions.swapPets()} title="Swap pets"
            disabled={!$comparisonPets[0] && !$comparisonPets[1]}>
            ⇅
        </button>

        <div class="slot-label">Pet B</div>
        <div class="picker-slot" class:filled={$comparisonPets[1]}>
            {#if $comparisonPets[1]}
                <span class="slot-pet">
                    <span class="slot-emoji">{getSpeciesEmoji($comparisonPets[1].species)}</span>
                    <span class="slot-name">{$comparisonPets[1].name}</span>
                </span>
                <button class="slot-clear" onclick={() => comparisonActions.setPet(1, null)} title="Remove">×</button>
            {:else}
                <span class="empty-slot">Pick a pet...</span>
            {/if}
        </div>
    </div>

    {#if $speciesMismatch}
        <div class="species-warning" role="alert">
            ⚠️ Different species — comparison may be limited
        </div>
    {/if}

    <div class="picker-search">
        <input
            type="text"
            class="search-input"
            placeholder="Search pets..."
            bind:value={searchQuery}
        />
    </div>

    {#if slotASpecies}
        <div class="species-filter-hint">
            Showing {slotASpecies} only
        </div>
    {/if}

    <div class="picker-list">
        {#each filteredPets as pet (pet.id)}
            <button class="picker-pet-card" onclick={() => handlePetClick(pet)}>
                <span class="picker-pet-icon">{getSpeciesEmoji(pet.species)}</span>
                <span class="picker-pet-info">
                    <span class="picker-pet-name">{pet.name || 'Unnamed'}</span>
                    <span class="picker-pet-meta">
                        {pet.species || 'Unknown'}
                        {#if pet.breed && pet.breed !== 'Mixed'}
                            · {pet.breed}
                        {/if}
                        · {pet.gender || 'Unknown'}
                    </span>
                </span>
            </button>
        {:else}
            <p class="picker-empty">
                {#if $pets.length === 0}
                    No pets uploaded yet
                {:else}
                    No matching pets
                {/if}
            </p>
        {/each}
    </div>
</div>

<style>
    .comparison-picker {
        display: flex;
        flex-direction: column;
        gap: 10px;
        height: 100%;
        overflow: hidden;
    }

    .picker-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
        padding: 12px 12px 0;
    }

    .picker-slots {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 0 12px;
    }

    .slot-label {
        font-size: 10px;
        font-weight: 600;
        color: var(--text-tertiary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .picker-slot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 10px;
        background: var(--bg-primary);
        border: 1px dashed var(--border-primary);
        border-radius: 8px;
        font-size: 13px;
        min-height: 38px;
    }

    .picker-slot.filled {
        border-style: solid;
        border-color: var(--accent);
        background: var(--bg-selected);
    }

    .slot-pet {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
    }

    .slot-emoji {
        font-size: 16px;
        flex-shrink: 0;
    }

    .slot-name {
        font-weight: 600;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .slot-clear {
        background: none;
        border: none;
        color: var(--text-tertiary);
        font-size: 16px;
        cursor: pointer;
        padding: 0 2px;
        line-height: 1;
        flex-shrink: 0;
    }

    .slot-clear:hover {
        color: var(--error);
    }

    .empty-slot {
        color: var(--text-muted);
        font-style: italic;
        font-size: 12px;
    }

    .swap-btn {
        align-self: center;
        background: var(--bg-tertiary);
        border: 1px solid var(--border-primary);
        border-radius: 6px;
        padding: 2px 10px;
        font-size: 14px;
        cursor: pointer;
        color: var(--text-secondary);
        transition: all 0.15s ease;
    }

    .swap-btn:hover:not(:disabled) {
        background: var(--bg-secondary);
        color: var(--text-primary);
    }

    .swap-btn:disabled {
        opacity: 0.3;
        cursor: default;
    }

    .species-warning {
        margin: 0 12px;
        padding: 6px 10px;
        background: var(--warning-bg, #fef3c7);
        border: 1px solid var(--warning-border, #f59e0b);
        border-radius: 6px;
        font-size: 11px;
        color: var(--warning-text, #92400e);
    }

    .picker-search {
        padding: 0 12px;
    }

    .search-input {
        width: 100%;
        padding: 6px 10px;
        border: 1px solid var(--border-primary);
        border-radius: 6px;
        font-size: 12px;
        background: var(--bg-primary);
        color: var(--text-primary);
        outline: none;
        box-sizing: border-box;
    }

    .search-input:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 2px var(--accent-soft);
    }

    .species-filter-hint {
        padding: 0 12px;
        font-size: 10px;
        color: var(--text-tertiary);
        font-style: italic;
    }

    .picker-list {
        flex: 1;
        overflow-y: auto;
        padding: 0 12px 12px;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .picker-pet-card {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 8px 10px;
        background: var(--bg-primary);
        border: 1px solid var(--border-primary);
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s ease;
        text-align: left;
    }

    .picker-pet-card:hover {
        background: var(--bg-secondary);
        border-color: var(--accent);
    }

    .picker-pet-icon {
        font-size: 16px;
        flex-shrink: 0;
    }

    .picker-pet-info {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .picker-pet-name {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .picker-pet-meta {
        font-size: 10px;
        color: var(--text-tertiary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .picker-empty {
        text-align: center;
        color: var(--text-muted);
        font-size: 12px;
        padding: 20px 0;
        margin: 0;
    }
</style>
