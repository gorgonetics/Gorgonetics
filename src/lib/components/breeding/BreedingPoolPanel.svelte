<script lang="ts">
/**
 * The breeding pool — one chip per stabled animal of the chosen species, split
 * ♂ / ♀. Click a chip to bench that animal (it's already breeding elsewhere, or
 * you just don't want it paired): benched animals drop out of the ranking, so
 * every pair involving them disappears. Benched chips sink to the bottom of
 * their column, dimmed and struck through, and click again to return them.
 *
 * Collapsed by default so it doesn't crowd the ranking; the header keeps the
 * available/benched counts visible either way.
 */
import { Gender, type Pet } from '$lib/types/index.js';

interface Props {
  /** Every stabled pet of the chosen species — benched or not. */
  pool: Pet[];
  benchedIds: Set<number>;
  onToggle: (id: number) => void;
  onClearBench: () => void;
}

const { pool, benchedIds, onToggle, onClearBench }: Props = $props();

let open = $state(false);

// One pass over the pool: split by gender and count benched. Benched chips sink
// to the bottom of their column but keep name order within each group, so a
// chip's position only changes when you bench/return it.
const grouped = $derived.by(() => {
  const males: Pet[] = [];
  const females: Pet[] = [];
  let benched = 0;
  for (const p of pool) {
    if (benchedIds.has(p.id)) benched++;
    (p.gender === Gender.MALE ? males : females).push(p);
  }
  const order = (a: Pet, b: Pet) =>
    (benchedIds.has(a.id) ? 1 : 0) - (benchedIds.has(b.id) ? 1 : 0) || a.name.localeCompare(b.name);
  males.sort(order);
  females.sort(order);
  return { males, females, benchedCount: benched, availableCount: pool.length - benched };
});

const males = $derived(grouped.males);
const females = $derived(grouped.females);
const benchedCount = $derived(grouped.benchedCount);
const availableCount = $derived(grouped.availableCount);
</script>

<section class="pool" data-testid="breeding-pool">
  <div class="pool-header">
    <button
      type="button"
      class="pool-toggle"
      aria-expanded={open}
      onclick={() => { open = !open; }}
    >
      <span class="caret" class:open>▸</span>
      Pool
      <span class="counts">{availableCount} available{benchedCount > 0 ? ` · ${benchedCount} benched` : ''}</span>
    </button>
    {#if benchedCount > 0}
      <button type="button" class="return-all" onclick={onClearBench} data-testid="pool-return-all">
        Return all
      </button>
    {/if}
  </div>

  {#if open}
    <div class="pool-body">
      {#each [{ label: '♂', pets: males }, { label: '♀', pets: females }] as col (col.label)}
        <div class="pool-col">
          <div class="col-head">{col.label} {col.pets.length}</div>
          <div class="chips">
            {#each col.pets as pet (pet.id)}
              {@const benched = benchedIds.has(pet.id)}
              <button
                type="button"
                class="chip"
                class:benched
                aria-pressed={benched}
                title={benched ? `Return ${pet.name} to the pool` : `Bench ${pet.name} (already breeding)`}
                data-testid="pool-chip"
                data-pet-id={pet.id}
                onclick={() => onToggle(pet.id)}
              >
                {pet.name}
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .pool {
    flex-shrink: 0;
    border: 1px solid var(--border-primary);
    border-radius: 6px;
    background: var(--bg-secondary);
  }

  .pool-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .pool-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    padding: 8px 10px;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font: inherit;
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
    text-align: left;
  }

  .caret {
    display: inline-block;
    transition: transform 0.15s ease;
    color: var(--text-tertiary);
  }

  .caret.open {
    transform: rotate(90deg);
  }

  .counts {
    font-weight: 400;
    font-size: 12px;
    color: var(--text-tertiary);
  }

  .return-all {
    margin-right: 8px;
    padding: 3px 8px;
    background: transparent;
    border: 1px solid var(--border-primary);
    border-radius: 6px;
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
  }

  .return-all:hover {
    background: var(--bg-tertiary);
  }

  .pool-body {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    padding: 0 10px 10px;
  }

  .col-head {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-tertiary);
    margin-bottom: 6px;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chip {
    padding: 3px 9px;
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: 999px;
    color: var(--text-primary);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.12s ease;
  }

  .chip:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .chip.benched {
    background: transparent;
    color: var(--text-tertiary);
    text-decoration: line-through;
    opacity: 0.7;
  }

  .chip.benched:hover {
    color: var(--text-secondary);
    border-color: var(--border-primary);
  }
</style>
