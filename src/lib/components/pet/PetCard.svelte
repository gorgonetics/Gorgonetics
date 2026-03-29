<script>
const { pet, selected = false, onclick } = $props();

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
>
    <div class="pet-card-main">
        <div class="pet-card-icon">{getSpeciesEmoji(pet.species)}</div>
        <div class="pet-card-info">
            <div class="pet-card-name">{pet.name || 'Unnamed'}</div>
            <div class="pet-card-meta">
                {pet.species || 'Unknown'}
                <span class="meta-dot">·</span>
                {pet.gender || 'Unknown'}
                {#if pet.known_genes}
                    <span class="meta-dot">·</span>
                    <span class="gene-count">{pet.known_genes} genes</span>
                {/if}
            </div>
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
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.15s ease;
        text-align: left;
    }

    .pet-card:hover {
        background: #f9fafb;
        border-color: #d1d5db;
    }

    .pet-card.selected {
        background: #eff6ff;
        border-color: #3b82f6;
        border-left: 3px solid #3b82f6;
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
        color: #111827;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .pet-card-meta {
        font-size: 11px;
        color: #6b7280;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .meta-dot {
        margin: 0 3px;
        color: #d1d5db;
    }

    .gene-count {
        color: #3b82f6;
    }

    .selected-indicator {
        color: #3b82f6;
        font-size: 12px;
        flex-shrink: 0;
    }
</style>
