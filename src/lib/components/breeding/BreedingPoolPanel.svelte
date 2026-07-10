<script lang="ts">
/**
 * The breeding pool — every stabled animal of the chosen species, split ♂ / ♀
 * and listed in stable alphabetical order so a pet is findable by position.
 * Click one to bench it (already breeding elsewhere, or just not wanted): benched
 * animals drop out of the ranking, so every pair using them disappears. Benched
 * rows dim and check off *in place* — order never shifts under you. Collapsed by
 * default so it doesn't crowd the ranking; the header keeps the counts visible.
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

const byName = (a: Pet, b: Pet) => a.name.localeCompare(b.name);

// Split by gender in one pass; sort each column alphabetically (stable order —
// benching doesn't move a pet). benchedCount drives the header + Return all.
const males = $derived(pool.filter((p) => p.gender === Gender.MALE).sort(byName));
const females = $derived(pool.filter((p) => p.gender === Gender.FEMALE).sort(byName));
const benchedCount = $derived(pool.reduce((n, p) => n + (benchedIds.has(p.id) ? 1 : 0), 0));
const availableCount = $derived(pool.length - benchedCount);
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
      {#each [{ label: '♂ Males', pets: males }, { label: '♀ Females', pets: females }] as col (col.label)}
        <div class="pool-col">
          <div class="col-head">{col.label} · {col.pets.length}</div>
          <div class="grid">
            {#each col.pets as pet (pet.id)}
              {@const benched = benchedIds.has(pet.id)}
              <button
                type="button"
                class="cell"
                class:benched
                aria-pressed={benched}
                title={benched ? `Return ${pet.name} to the pool` : `Bench ${pet.name} (already breeding)`}
                data-testid="pool-chip"
                data-pet-id={pet.id}
                onclick={() => onToggle(pet.id)}
              >
                <span class="box" aria-hidden="true">{benched ? '' : '✓'}</span>
                <span class="name">{pet.name}</span>
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
    padding: 7px 10px;
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
    gap: 8px 16px;
    padding: 0 10px 10px;
  }

  .col-head {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-tertiary);
    margin-bottom: 4px;
  }

  /* Aligned columns of names — scannable like a list, not a pill cloud. */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 1px 8px;
  }

  .cell {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 4px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    overflow: hidden;
  }

  .cell:hover {
    background: var(--bg-tertiary);
  }

  .box {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-primary);
    border-radius: 3px;
    background: var(--accent);
    color: var(--text-inverse);
    font-size: 10px;
    line-height: 1;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cell.benched .box {
    background: transparent;
    color: transparent;
  }

  .cell.benched .name {
    color: var(--text-tertiary);
    text-decoration: line-through;
  }
</style>
