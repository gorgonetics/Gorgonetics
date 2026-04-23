<script>
import { House, PawPrint, Star } from '@lucide/svelte';
import { getSpeciesEmoji } from '$lib/utils/species.js';

const { pet, selected = false, onclick, onkeydown, onToggleMarker } = $props();

function toggleMarker(e, key, value) {
  e.stopPropagation();
  onToggleMarker?.(pet.id, key, value);
}

function handleKey(e) {
  // Ignore keys that bubbled up from inner marker buttons — they handle
  // Space/Enter themselves; otherwise hitting those on a marker would also
  // fire the card's own "select pet" action.
  if (e.currentTarget !== e.target) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    onclick?.(pet);
    return;
  }
  onkeydown?.(e);
}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
    class="pet-card"
    class:selected
    role="button"
    tabindex="0"
    onclick={() => onclick?.(pet)}
    onkeydown={handleKey}
>
    <div class="pet-card-main">
        <div class="pet-card-icon">{getSpeciesEmoji(pet.species)}</div>
        <div class="pet-card-info">
            <div class="pet-card-name">{pet.name || 'Unnamed'}</div>
            <div class="pet-card-meta">
                {pet.species || 'Unknown'}
                {#if pet.breed && pet.breed !== 'Mixed'}
                    <span class="meta-dot">·</span>
                    {pet.breed}
                {/if}
                <span class="meta-dot">·</span>
                {pet.gender || 'Unknown'}
                {#if pet.known_genes}
                    <span class="meta-dot">·</span>
                    <span class="gene-count">{pet.known_genes} genes</span>
                {/if}
            </div>
            {#if pet.tags?.length > 0}
                <div class="pet-card-tags">
                    {#each pet.tags as tag}
                        <span class="tag-badge">{tag}</span>
                    {/each}
                </div>
            {/if}
        </div>
    </div>
    <div class="pet-card-side">
        <button
            type="button"
            class="marker-toggle star-toggle"
            class:active={pet.starred}
            title={pet.starred ? 'Unstar' : 'Star'}
            aria-label={pet.starred ? 'Unstar pet' : 'Star pet'}
            aria-pressed={!!pet.starred}
            onclick={(e) => toggleMarker(e, 'starred', !pet.starred)}
        >
            <Star size={14} fill={pet.starred ? 'currentColor' : 'none'} />
        </button>
        <button
            type="button"
            class="marker-toggle stable-toggle"
            class:active={pet.stabled}
            title={pet.stabled ? 'Remove from stables' : 'Mark as stabled'}
            aria-label={pet.stabled ? 'Unstable pet' : 'Mark as stabled'}
            aria-pressed={!!pet.stabled}
            onclick={(e) => toggleMarker(e, 'stabled', !pet.stabled)}
        >
            <House size={14} fill={pet.stabled ? 'currentColor' : 'none'} />
        </button>
        {#if pet.is_pet_quality}
            <PawPrint class="marker-badge pet-quality" size={14} aria-label="Pet quality" />
        {/if}
        {#if selected}
            <span class="selected-indicator">▸</span>
        {/if}
    </div>
</div>

<style>
    .pet-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        padding: 10px 64px 10px 12px;
        background: var(--bg-primary);
        border: 1px solid var(--border-primary);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.15s ease;
        text-align: left;
        box-sizing: border-box;
    }

    .pet-card:hover {
        background: var(--bg-secondary);
        border-color: var(--border-secondary);
    }

    .pet-card:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }

    .pet-card.selected {
        background: var(--bg-selected);
        border-color: var(--accent);
        border-left: 3px solid var(--accent);
    }

    .pet-card-main {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
    }

    .pet-card-icon {
        font-size: 20px;
        flex-shrink: 0;
    }

    .pet-card-info {
        min-width: 0;
    }

    .pet-card-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .pet-card-meta {
        font-size: 11px;
        color: var(--text-tertiary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .pet-card-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 3px;
        margin-top: 3px;
    }

    .tag-badge {
        display: inline-block;
        padding: 1px 6px;
        background: var(--bg-selected);
        color: var(--accent-text);
        border-radius: 8px;
        font-size: 10px;
        font-weight: 500;
    }

    .selected-indicator {
        color: var(--accent-text);
        font-size: 12px;
        flex-shrink: 0;
    }

    .pet-card-side {
        display: flex;
        align-items: center;
        gap: 2px;
        flex-shrink: 0;
        margin-left: 6px;
    }

    .marker-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        padding: 0;
        border: none;
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        border-radius: 4px;
        transition: color 0.15s, background 0.15s;
    }

    .marker-toggle:hover {
        background: var(--bg-tertiary);
        color: var(--text-primary);
    }

    .marker-toggle:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
    }

    .star-toggle.active {
        color: #f59e0b;
    }

    .stable-toggle.active {
        color: var(--accent);
    }

    :global(.marker-badge.pet-quality) {
        color: var(--text-muted);
        margin-left: 2px;
    }
</style>
