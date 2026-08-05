<script lang="ts">
/**
 * Full-genome rarity map (#368, design §7).
 *
 * The per-pet lens answers "does this pet carry anything scarce?". This answers
 * the complementary question — "where is there scarce material in my stock at
 * all?" — which has no pet in it.
 *
 * **A map cell is exactly what a fully-mixed pet would render at that locus.**
 * That is not an analogy, it is the implementation: every cell is emitted as
 * `data-zygosity="mixed"` and fed to `buildRarityCSS` as `GeneType.MIXED`, so
 * the diverging scale, the split rendering, the thresholds and the injected
 * stylesheet are the *same code* the pet grid uses, with no map-specific
 * colouring at all. Recessive top-left, dominant bottom-right, as there.
 */
import { onDestroy, onMount } from 'svelte';
import './geneCell.css';
import GeneTooltip from '$lib/components/gene/GeneTooltip.svelte';
import EmptyState from '$lib/components/shared/EmptyState.svelte';
import { normalizeSpecies } from '$lib/services/configService.js';
import { computeRarityLookup, type RarityLookup } from '$lib/services/frequencyService.js';
import { getGeneEffectsCached } from '$lib/services/geneService.js';
import { GeneType, type Pet } from '$lib/types/index.js';
import { breedFor, effectFor, type GeneEffectData } from '$lib/utils/geneAnalysis.js';
import { computeGeneCellSize } from '$lib/utils/geneGridCells.js';
import { buildGenomeMapGrid, type GenomeMapGrid } from '$lib/utils/genomeMapGrid.js';
import { buildRarityCSS, type RarityCell } from '$lib/utils/rarityCSS.js';
import { buildRarityTooltip, placeRarityTooltip } from '$lib/utils/rarityTooltip.js';
import { capitalize } from '$lib/utils/string.js';

interface Props {
  /** Animal type from the Reference toolbar, e.g. `Horse`. */
  species: string;
  /** Population the baseline is measured over. */
  populationPets?: readonly Pet[];
  /**
   * Breed to display, or '' for the whole genome.
   *
   * A **display filter only**: the frequencies behind every cell are still
   * computed across all pets of the species. Breed-scoped *populations* are
   * rejected (§8) because every horse carries all breeds' loci; breed-scoped
   * *views* are just a filter, and the two must not be conflated.
   */
  breedFilter?: string;
}

const { species, populationPets = [], breedFilter = '' }: Props = $props();

let effects = $state<Record<string, GeneEffectData>>({});
let loading = $state(true);
let error = $state<string | null>(null);
let lookup = $state<RarityLookup | null>(null);
// Separate counters on purpose: one shared counter would let each load
// invalidate the other's in-flight request, and the gene-template load would
// never commit — the map would render empty forever.
let effectsSeq = 0;
let lookupSeq = 0;

let containerEl = $state<HTMLElement | null>(null);
let containerWidth = $state(0);
let styleEl: HTMLStyleElement | null = null;

let tooltipVisible = $state(false);
let tooltipX = $state(0);
let tooltipY = $state(0);
let tooltipGeneId = $state('');
let tooltipSubtitle = $state('');
let tooltipLines = $state<string[]>([]);

const speciesKey = $derived(normalizeSpecies(species));

/** Gene ids to display: the whole genome, or one breed's loci plus untagged. */
const visibleGeneIds = $derived.by(() => {
  const ids = Object.keys(effects);
  if (!breedFilter) return ids;
  return ids.filter((id) => {
    const breed = breedFor(effects[id]);
    return !breed || breed === breedFilter;
  });
});

const grid = $derived<GenomeMapGrid>(buildGenomeMapGrid(visibleGeneIds));

const cellSize = $derived(
  computeGeneCellSize({
    containerWidth,
    totalColumns: grid.totalColumns,
    blockCount: grid.sortedBlocks.length,
  }),
);

const blockIndices = $derived.by(() => {
  const out: Record<string, number[]> = {};
  for (const block of grid.sortedBlocks) {
    out[block] = Array.from({ length: grid.blockMaxGenes.get(block) ?? 0 }, (_, i) => i);
  }
  return out;
});

onMount(() => {
  styleEl = document.createElement('style');
  styleEl.id = 'genome-map-rarity';
  document.head.appendChild(styleEl);
});

onDestroy(() => {
  styleEl?.remove();
  styleEl = null;
});

// Gene template DB for the species — this is what gives the map its shape.
$effect(() => {
  const key = speciesKey;
  if (!key) {
    effects = {};
    loading = false;
    return;
  }
  const mine = ++effectsSeq;
  loading = true;
  error = null;
  getGeneEffectsCached(species)
    .then((data) => {
      if (mine !== effectsSeq) return;
      effects = data?.effects ?? {};
      loading = false;
    })
    .catch((err: unknown) => {
      if (mine !== effectsSeq) return;
      console.error('Failed to load gene effects for the genome map:', err);
      error = 'Could not load the gene reference';
      loading = false;
    });
});

// Baseline. Same service and cache as the per-pet lens, so opening the map
// after viewing a pet is free.
$effect(() => {
  const key = speciesKey;
  const pets = populationPets;
  if (!key) return;
  const mine = ++lookupSeq;
  computeRarityLookup(pets, species)
    .then((result) => {
      if (mine !== lookupSeq) return;
      lookup = result;
    })
    .catch((err: unknown) => {
      console.error('Failed to compute the genome map baseline:', err);
    });
});

$effect(() => {
  const el = containerEl;
  if (!el) return;
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) containerWidth = entry.contentRect.width;
  });
  ro.observe(el);
  containerWidth = el.clientWidth;
  return () => ro.disconnect();
});

// Every cell is the mixed case, so the pet grid's stylesheet builder applies
// unchanged — no map-specific colour logic exists.
$effect(() => {
  if (!styleEl) return;
  if (!lookup) {
    styleEl.textContent = '';
    return;
  }
  const cells: RarityCell[] = visibleGeneIds.map((geneId) => ({ geneId, type: GeneType.MIXED }));
  styleEl.textContent = buildRarityCSS({ cells, lookup });
});

function showTooltip(geneId: string, event: MouseEvent): void {
  const { subtitle, lines } = buildRarityTooltip(lookup, geneId, capitalize(species), {
    dominant: effectFor(effects[geneId], 'D'),
    recessive: effectFor(effects[geneId], 'R'),
  });
  const { x, y } = placeRarityTooltip(event.clientX, event.clientY, lines.length, {
    width: window.innerWidth,
    height: window.innerHeight,
  });

  tooltipX = x;
  tooltipY = y;
  tooltipGeneId = geneId;
  tooltipSubtitle = subtitle;
  tooltipLines = lines;
  tooltipVisible = true;
}
</script>

<div class="genome-map">
    {#if error}
        <EmptyState icon="⚠️" title="Gene reference unavailable" body={error} />
    {:else if loading}
        <EmptyState icon="🧬" title="Loading genome…" body="Reading the gene reference for {species}." />
    {:else if grid.rows.length === 0}
        <EmptyState
            icon="🧬"
            title="No genes to show"
            body={breedFilter ? `No ${breedFilter} loci in this genome.` : 'Pick an animal type above.'}
        />
    {:else}
        <!-- Shares `.gene-grid-container` AND `.view-rarity` deliberately: that is
             what makes the pet grid's static rarity CSS and the injected
             stylesheet apply here with no duplication. -->
        <div
            class="gene-grid-container view-rarity"
            data-testid="genome-map-grid"
            bind:this={containerEl}
            style="--cell-size: {cellSize}px"
        >
            <table class="gene-grid-table">
                <thead class="gene-headers">
                    <tr>
                        <th class="chromosome-header">Chr</th>
                        {#each grid.sortedBlocks as block (block)}
                            {#each blockIndices[block] as i (i)}
                                <th class="position-header {i === 0 ? 'block-label block-start' : ''}">{i === 0 ? block : ""}</th>
                            {/each}
                        {/each}
                    </tr>
                </thead>
                <tbody class="gene-rows">
                    {#each grid.rows as row (row.chromosome)}
                        <tr class="chromosome-row" data-chromosome={row.chromosome}>
                            <td class="chromosome-label">{row.chromosome}</td>
                            {#each grid.sortedBlocks as block, bi (block)}
                                {#each blockIndices[block] as i (i)}
                                    {@const geneId = row.cells[bi]?.[i] ?? null}
                                    <td class="gene-cell-container {i === 0 ? 'block-start' : ''} {!geneId ? 'empty' : ''}">
                                        {#if geneId}
                                            <div
                                                class="gene-cell gene-mixed"
                                                data-gene-id={geneId}
                                                data-zygosity="mixed"
                                                role="button"
                                                tabindex="-1"
                                                aria-label={geneId}
                                                onmouseenter={(e) => showTooltip(geneId, e)}
                                                onmouseleave={() => { tooltipVisible = false; }}
                                                onfocus={(e) => showTooltip(geneId, e as unknown as MouseEvent)}
                                                onblur={() => { tooltipVisible = false; }}
                                            ></div>
                                        {/if}
                                    </td>
                                {/each}
                            {/each}
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}

    <GeneTooltip
        visible={tooltipVisible}
        x={tooltipX}
        y={tooltipY}
        geneId={tooltipGeneId}
        geneType="x"
        subtitle={tooltipSubtitle}
        effectsLabel="Rarity"
        potentialEffects={tooltipLines}
    />
</div>

<style>
    .genome-map {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        min-width: 0;
    }

    .gene-grid-container {
        flex: 1;
        min-height: 0;
        overflow: auto;
        border: 1px solid var(--border-primary);
        border-radius: 6px;
        background: var(--bg-secondary);
        /* Same reason as the pet grid (#436): cell size is computed from this
           box's contentRect.width, which excludes a scrollbar that takes layout
           space, so a purely vertical change would otherwise leak into cell
           width. */
        scrollbar-gutter: stable;
    }

    .gene-grid-table {
        border-collapse: collapse;
        table-layout: fixed;
    }

    .chromosome-header,
    .chromosome-label {
        width: 28px;
        min-width: 28px;
        font-size: 10px;
        color: var(--text-tertiary);
        text-align: center;
        position: sticky;
        left: 0;
        background: var(--bg-secondary);
        z-index: 1;
    }

    /* Cell and block spacing must match the pet grid exactly, and not only for
       consistency: `computeGeneCellSize` budgets CHR_COL_WIDTH + one BLOCK_GAP
       per block + a 1px gutter each side of every cell, so a grid that drops
       them lays out tighter than the size it asked for. */
    .position-header {
        width: var(--cell-size, 16px);
        min-width: var(--cell-size, 16px);
        max-width: var(--cell-size, 16px);
        font-size: 9px;
        color: var(--text-tertiary);
        font-weight: 600;
        text-align: left;
        height: 14px;
    }

    .position-header.block-start {
        padding-left: 10px;
    }

    .position-header.block-start:first-of-type {
        padding-left: 2px;
    }

    .gene-cell-container {
        padding: 1px;
        text-align: center;
        vertical-align: middle;
        line-height: 0;
        width: var(--cell-size, 16px);
    }

    .gene-cell-container.block-start {
        /* KEEP IN SYNC with BLOCK_GAP in utils/geneGridCells.ts */
        padding-left: 8px;
    }

    .gene-cell-container.block-start:first-of-type {
        padding-left: 1px;
    }
</style>
