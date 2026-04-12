<script>
const { pet, selected = false, onclick, onkeydown } = $props();

function getSpeciesEmoji(species) {
  const s = (species || '').toLowerCase();
  if (s.includes('bee') || s.includes('wasp')) return '🐝';
  if (s.includes('horse')) return '🐴';
  return '🐾';
}
</script>

<button
    class="pet-card"
    class:selected
    onclick={() => onclick?.(pet)}
    {onkeydown}
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
    {#if selected}
        <span class="selected-indicator">▸</span>
    {/if}
</button>

<style>
    .pet-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        padding: 10px 12px;
        background: var(--bg-primary);
        border: 1px solid var(--border-primary);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.15s ease;
        text-align: left;
    }

    .pet-card:hover {
        background: var(--bg-secondary);
        border-color: var(--border-secondary);
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
</style>
