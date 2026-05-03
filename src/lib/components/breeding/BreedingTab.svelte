<script>
import { getSupportedSpecies, normalizeSpecies } from '$lib/services/configService.js';
import { breedingView } from '$lib/stores/breeding.svelte.js';
import { pets } from '$lib/stores/pets.js';
import { Gender } from '$lib/types/index.js';

const species = getSupportedSpecies();

const eligibleBySpecies = $derived.by(() => {
  const counts = {};
  for (const s of species) counts[s] = { male: 0, female: 0 };
  for (const p of $pets) {
    if (!p.stabled) continue;
    const bucket = counts[normalizeSpecies(p.species)];
    if (!bucket) continue;
    if (p.gender === Gender.MALE) bucket.male++;
    else if (p.gender === Gender.FEMALE) bucket.female++;
  }
  return counts;
});
</script>

<div class="breeding-tab" data-testid="breeding-tab">
    <header class="breeding-header">
        <h2>💞 Breeding Assistant</h2>
        <p class="subtitle">
            Rank stabled male × female pairs by expected offspring quality.
        </p>
    </header>

    <section class="status">
        <h3>Eligible parents</h3>
        <ul class="species-list">
            {#each species as s (s)}
                {@const counts = eligibleBySpecies[s] ?? { male: 0, female: 0 }}
                <li>
                    <strong>{s}</strong>: {counts.male} ♂ × {counts.female} ♀
                    {#if counts.male > 0 && counts.female > 0}
                        <span class="pair-count">→ {counts.male * counts.female} pair{counts.male * counts.female === 1 ? '' : 's'}</span>
                    {:else}
                        <span class="pair-count empty">→ no pairs (need at least one of each gender)</span>
                    {/if}
                </li>
            {/each}
        </ul>
    </section>

    <section class="placeholder-note">
        <p>
            The ranking table and offspring-breed selector are coming in the next
            iteration. Active species: <strong>{breedingView.species}</strong>.
        </p>
    </section>
</div>

<style>
    .breeding-tab {
        flex: 1;
        padding: 24px 32px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 24px;
    }

    .breeding-header h2 {
        margin: 0 0 4px 0;
        font-size: 20px;
    }

    .subtitle {
        margin: 0;
        color: var(--text-muted);
        font-size: 13px;
    }

    .status h3 {
        font-size: 14px;
        font-weight: 600;
        margin: 0 0 8px 0;
        color: var(--text-secondary);
    }

    .species-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .species-list li {
        font-size: 14px;
    }

    .pair-count {
        margin-left: 8px;
        color: var(--text-muted);
        font-size: 13px;
    }

    .pair-count.empty {
        color: var(--text-tertiary);
        font-style: italic;
    }

    .placeholder-note {
        padding: 12px 16px;
        background: var(--bg-secondary);
        border: 1px dashed var(--border-primary);
        border-radius: 6px;
        color: var(--text-secondary);
        font-size: 13px;
    }

    .placeholder-note p {
        margin: 0;
    }
</style>
