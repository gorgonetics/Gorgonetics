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
import GeneTooltip from '#lib/components/gene/GeneTooltip.svelte';
import EmptyState from '#lib/components/shared/EmptyState.svelte';
import { normalizeSpecies } from '#lib/services/configService.js';
import { loadRarityLookup, type RarityLookup, type RarityPopulation } from '#lib/services/frequencyService.js';
import { getGeneEffectsCached } from '#lib/services/geneService.js';
import { loadGeneImpact, STUDYABLE_SPECIES, studyInputsKey } from '#lib/services/studyService.js';
import { pets as petList } from '#lib/stores/pets.js';
import { GeneType } from '#lib/types/index.js';
import { breedFor, effectFor, type GeneEffectData } from '#lib/utils/geneAnalysis.js';
import { type Allele, SOLE_CARRIER_MIN_PETS } from '#lib/utils/geneFrequency.js';
import { computeGeneCellSize } from '#lib/utils/geneGridCells.js';
import { buildImpactCSS, buildImpactTooltip, maxAbsPoints, slotImpact } from '#lib/utils/geneImpact.js';
import { buildGenomeMapGrid, type GenomeMapGrid } from '#lib/utils/genomeMapGrid.js';
import { handleGridNavigation } from '#lib/utils/keyboard.js';
import { keyedResource } from '#lib/utils/keyedResource.svelte.js';
import { groupNeverSeenByChromosome, neverSeenAlleles, withDeclaredEffect } from '#lib/utils/neverSeen.js';
import { buildRarityCSS, type RarityCell } from '#lib/utils/rarityCSS.js';
import { buildRarityTooltip, placeRarityTooltip } from '#lib/utils/rarityTooltip.js';
import { capitalize } from '#lib/utils/string.js';

interface Props {
  /** Animal type from the Reference toolbar, e.g. `Horse`. */
  species: string;
  /** Population the baseline is measured over. */
  population?: RarityPopulation;
  /**
   * Breed to display, or '' for the whole genome.
   *
   * A **display filter only**: the frequencies behind every cell are still
   * computed across all pets of the species. Breed-scoped *populations* are
   * rejected (§8) because every horse carries all breeds' loci; breed-scoped
   * *views* are just a filter, and the two must not be conflated.
   */
  breedFilter?: string;
  /**
   * What the cells show: allele rarity across `population`, each slot's
   * measured attribute points from the study (`utils/geneImpact.ts`), or only
   * the alleles no animal in `population` carries (`utils/neverSeen.ts`).
   */
  lens?: 'rarity' | 'impact' | 'never';
  /**
   * Never-seen lens only: drop chromosome rows with nothing to look for. Ignored
   * while there is no never-seen allele at all, so the map never collapses to
   * an empty grid while the baseline loads or is too small to judge.
   */
  hideSeenChromosomes?: boolean;
  /** Never-seen lens only: leave out never-seen alleles with no declared effect. */
  hideNoEffect?: boolean;
}

const {
  species,
  population = { tier: 'all', pets: [] },
  breedFilter = '',
  lens = 'rarity',
  hideSeenChromosomes = false,
  hideNoEffect = false,
}: Props = $props();

let effects = $state<Record<string, GeneEffectData>>({});
let loading = $state(true);
let error = $state<string | null>(null);
let lookup = $state<RarityLookup | null>(null);
let lookupLoading = $state(true);
/**
 * Separate from `error`, which blanks the whole map: the grid's *structure*
 * comes from the gene template, so a failed baseline costs the colours, not the
 * genome. The map stays readable and says the frequencies are missing.
 */
let lookupError = $state<string | null>(null);
// Separate counters on purpose: one shared counter would let each load
// invalidate the other's in-flight request, and the gene-template load would
// never commit — the map would render empty forever.
let effectsSeq = 0;
let lookupSeq = 0;

// Impact lens: the gene declarations and the study's magnitudes, loaded only
// when the lens is on and keyed on the study's inputs, like the pet grid's.
const impactKey = $derived.by(() => {
  if (!speciesKey || lens !== 'impact') return null;
  void $petList;
  return studyInputsKey(speciesKey);
});
const impactResource = keyedResource(() => impactKey, loadGeneImpact);
const impact = $derived(impactResource.value ?? null);
const impactLoading = $derived(impactResource.loading);
const impactError = $derived(
  impactResource.error
    ? 'Could not load gene impact'
    : impact?.studyFailed
      ? 'The study failed — showing declared effects only'
      : null,
);

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
  const pop = population;
  if (!key || lens === 'impact') return;
  const mine = ++lookupSeq;
  lookupLoading = true;
  lookupError = null;
  loadRarityLookup(pop, species)
    .then((result) => {
      if (mine !== lookupSeq) return;
      lookup = result;
      lookupLoading = false;
    })
    .catch((err: unknown) => {
      // Seq-guarded like the success path, and it must set state: without an
      // error the map would render every cell at the common centre, telling the
      // player there is nothing scarce in their stock when in fact nothing was
      // measured at all.
      if (mine !== lookupSeq) return;
      console.error('Failed to compute the genome map baseline:', err);
      lookupError = 'Could not analyse rarity';
      lookup = null;
      lookupLoading = false;
    });
});

const impactReady = $derived(!impactLoading && impact !== null && impact.species === speciesKey);
const impactMaxAbs = $derived(impact ? maxAbsPoints(impact.magnitudes) : 0);
const impactStudied = $derived(STUDYABLE_SPECIES.includes(speciesKey));

/** Measured slots over declared slots, across every attribute. */
const impactCoverage = $derived.by(() => {
  let known = 0;
  let total = 0;
  for (const c of impact?.magnitudes.coverage.values() ?? []) {
    known += c.known;
    total += c.total;
  }
  return { known, total };
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

/**
 * Keyboard navigation, delegated on the container exactly as the pet grid does.
 *
 * Without it the map was reachable by pointer only: a keyboard user could read
 * exact allele frequencies on a pet's grid but not one cell of the reference map,
 * and the cells' own `onfocus` tooltip could never fire. Attached imperatively
 * rather than as `onkeydown` so the container stays a plain, non-interactive
 * wrapper — the cells are the controls.
 */
$effect(() => {
  const el = containerEl;
  if (!el) return;
  const onKeydown = (event: KeyboardEvent) => {
    const active = document.activeElement as HTMLElement | null;
    const cell = (active?.closest?.('.gene-cell[data-gene-id]') as HTMLElement | null) ?? null;
    if ((event.key === 'Enter' || event.key === ' ') && cell) {
      event.preventDefault();
      const rect = cell.getBoundingClientRect();
      showTooltip(cell.dataset.geneId ?? '', rect.left + rect.width / 2, rect.top);
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const cells = Array.from(el.querySelectorAll<HTMLElement>('.gene-cell[data-gene-id]'));
    const current = cell ? cells.indexOf(cell) : -1;
    if (current < 0) return;
    const row = cell?.closest('tr');
    const columns = row ? row.querySelectorAll('.gene-cell[data-gene-id]').length : 1;
    handleGridNavigation(cells, current, event, columns);
  };
  el.addEventListener('keydown', onKeydown);
  return () => el.removeEventListener('keydown', onKeydown);
});

/**
 * Whether the baseline in hand is about the species on screen.
 *
 * The animal-type switch reloads the template behind its own `loading` gate, but
 * `lookup` outlives it — and gene ids are only meaningful within a species
 * (`01A1` names a different gene on a horse than on a beewasp), so a stale
 * lookup does not fail to match, it matches *everything* and paints the new
 * genome with the old species' frequencies. Checking the species the lookup was
 * built for is what makes that impossible rather than merely unlikely.
 */
const lookupReady = $derived(!lookupLoading && !lookupError && lookup !== null && lookup.species === speciesKey);

/** Never-seen lens: the one allele to look for at each locus that has one. */
const allNeverSeen = $derived(
  lens === 'never' && lookupReady && lookup ? neverSeenAlleles(visibleGeneIds, lookup) : new Map<string, Allele>(),
);
/** What the lens shows: `allNeverSeen`, less the no-effect alleles when hidden. */
const neverSeen = $derived(hideNoEffect ? withDeclaredEffect(allNeverSeen, effects) : allNeverSeen);
const hiddenNoEffect = $derived(allNeverSeen.size - neverSeen.size);
const neverSeenList = $derived(groupNeverSeenByChromosome(neverSeen));
const displayRows = $derived(
  lens === 'never' && hideSeenChromosomes && neverSeen.size > 0
    ? grid.rows.filter((row) => row.cells.some((block) => block.some((id) => id !== null && neverSeen.has(id))))
    : grid.rows,
);
const neverSeenCounts = $derived.by(() => {
  let dominant = 0;
  let recessive = 0;
  for (const allele of neverSeen.values()) {
    if (allele === GeneType.DOMINANT) dominant++;
    else recessive++;
  }
  return { dominant, recessive };
});

// Every cell is the mixed case, so the pet grid's stylesheet builder applies
// unchanged — no map-specific colour logic exists.
$effect(() => {
  if (!styleEl) return;
  // The never-seen lens marks its cells in the markup; it needs no sheet.
  if (lens === 'never') {
    styleEl.textContent = '';
    return;
  }
  if (lens === 'impact') {
    if (!impactReady || !impact) {
      styleEl.textContent = '';
      return;
    }
    const { parsed, magnitudes } = impact;
    styleEl.textContent = buildImpactCSS({
      scope: '.view-impact.gene-grid-container',
      cells: visibleGeneIds.map((geneId) => ({
        geneId,
        dom: slotImpact(parsed[geneId], geneId, 'dominant', magnitudes),
        rec: slotImpact(parsed[geneId], geneId, 'recessive', magnitudes),
      })),
      maxAbs: impactMaxAbs,
    });
    return;
  }
  if (!lookupReady || !lookup) {
    styleEl.textContent = '';
    return;
  }
  const cells: RarityCell[] = visibleGeneIds.map((geneId) => ({ geneId, type: GeneType.MIXED }));
  styleEl.textContent = buildRarityCSS({ cells, lookup });
});

/**
 * `clientX`/`clientY` come from the pointer, or from the cell's own box when the
 * cell was focused rather than hovered — a `FocusEvent` has no coordinates, and
 * reading them off one yields `undefined`, which propagates to `NaN` positions
 * and drops the card in the corner of the panel.
 */
function showTooltip(geneId: string, clientX: number, clientY: number): void {
  const { subtitle, lines } = lens === 'impact' ? impactTooltip(geneId) : rarityTooltip(geneId);
  const { x, y } = placeRarityTooltip(clientX, clientY, lines.length, {
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

function impactTooltip(geneId: string): { subtitle: string; lines: string[] } {
  if (!impactReady || !impact) return { subtitle: impactError ?? 'Loading…', lines: [] };
  const gd = impact.parsed[geneId];
  return buildImpactTooltip(
    slotImpact(gd, geneId, 'dominant', impact.magnitudes),
    slotImpact(gd, geneId, 'recessive', impact.magnitudes),
    null,
  );
}

function rarityTooltip(geneId: string): { subtitle: string; lines: string[] } {
  return buildRarityTooltip(lookupReady ? lookup : null, geneId, capitalize(species), {
    dominant: effectFor(effects[geneId], 'D'),
    recessive: effectFor(effects[geneId], 'R'),
  });
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
        {#if lens === 'impact'}
            <div class="map-legend" data-testid="map-impact-legend">
                {#each [4, 3, 2, 1] as l (l)}
                    <span class="swatch" style="background: var(--impact-neg-{l})"></span>
                {/each}
                <span class="swatch" style="background: var(--impact-neutral)" title="No attribute effect"></span>
                {#each [1, 2, 3, 4] as l (l)}
                    <span class="swatch" style="background: var(--impact-pos-{l})"></span>
                {/each}
                <span class="legend-text">{impactMaxAbs > 0 ? `Measured points, up to ±${impactMaxAbs}` : 'Measured points'}</span>
                <span class="swatch legend-gap" style="background: var(--impact-pos-unknown)"></span>
                <span class="swatch" style="background: var(--impact-neg-unknown)"></span>
                <span class="legend-text">Declared, size not measured</span>
                <span class="legend-text legend-muted legend-gap" data-testid="map-impact-status">
                    {#if impactError}
                        {impactError}
                    {:else if !impactReady}
                        Loading study…
                    {:else if !impactStudied}
                        The study does not cover {capitalize(speciesKey)} yet — only declared effects are shown.
                    {:else}
                        {impactCoverage.known} of {impactCoverage.total} effect sizes measured · recessive top-left, dominant bottom-right
                    {/if}
                </span>
            </div>
        {:else if lens === 'never'}
            <div class="map-legend" data-testid="map-never-legend">
                <span class="swatch" style="background: var(--rarity-r-5)"></span>
                <span class="legend-text">R never seen</span>
                <span class="swatch legend-gap" style="background: var(--rarity-d-5)"></span>
                <span class="legend-text">D never seen</span>
                <span class="legend-text legend-muted legend-gap" data-testid="map-never-status">
                    {#if lookupError}
                        {lookupError}
                    {:else if !lookupReady}
                        Analysing…
                    {:else if population.tier === 'community' && (lookup?.petCount ?? 0) === 0}
                        No shared {capitalize(speciesKey)}s cached · fetch them in the Study tab
                    {:else if (lookup?.petCount ?? 0) < SOLE_CARRIER_MIN_PETS}
                        Needs at least {SOLE_CARRIER_MIN_PETS} {capitalize(speciesKey)} pets to call an allele never seen — this baseline has {lookup?.petCount ?? 0}
                    {:else if allNeverSeen.size === 0}
                        No never-seen alleles at genes read on {SOLE_CARRIER_MIN_PETS} or more of {population.tier === 'community' ? 'the shared' : 'your'} pets · genes read on fewer, or not yet revealed, are not counted
                    {:else}
                        {neverSeen.size} allele{neverSeen.size === 1 ? '' : 's'} that none of {population.tier === 'community' ? `the ${lookup?.petCount} shared` : `your ${lookup?.petCount}`} pets carry ({neverSeenCounts.recessive} R, {neverSeenCounts.dominant} D){hiddenNoEffect > 0 ? ` · ${hiddenNoEffect} with no effect hidden` : ''} · genes read on fewer than {SOLE_CARRIER_MIN_PETS} pets are not counted
                    {/if}
                </span>
            </div>
        {:else if population.tier === 'community' && lookupReady && lookup?.petCount === 0}
            <p class="map-status" data-testid="map-community-empty">
                No shared {capitalize(speciesKey)}s cached · fetch them in the Study tab.
            </p>
        {:else if population.tier === 'community' && lookupReady && lookup?.refreshAdvised}
            <p class="map-status" data-testid="map-community-refresh">
                Cached by an older version · refresh in the Study tab to add the animals it left out.
            </p>
        {:else if lookupError}
            <!-- The genome is still worth showing — only the frequencies are
                 missing, and the dashed cells say so per-cell. -->
            <p class="map-status" data-testid="map-baseline-error">
                <span aria-hidden="true">⚠️</span> {lookupError} — the genome is shown without frequencies.
            </p>
        {/if}
        <div class="map-body">
        <div
            class="gene-grid-container {lens === 'impact' ? 'view-impact' : lens === 'never' ? 'view-never' : 'view-rarity'}"
            class:rarity-unscored={lens === 'rarity' && !lookupReady}
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
                    {#each displayRows as row (row.chromosome)}
                        <tr class="chromosome-row" data-chromosome={row.chromosome}>
                            <td class="chromosome-label">{row.chromosome}</td>
                            {#each grid.sortedBlocks as block, bi (block)}
                                {#each blockIndices[block] as i (i)}
                                    {@const geneId = row.cells[bi]?.[i] ?? null}
                                    {@const never = geneId ? neverSeen.get(geneId) : undefined}
                                    <td class="gene-cell-container {i === 0 ? 'block-start' : ''} {!geneId ? 'empty' : ''}">
                                        {#if geneId}
                                            <div
                                                class="gene-cell gene-mixed"
                                                class:impact-split={lens === 'impact'}
                                                data-gene-id={geneId}
                                                data-zygosity="mixed"
                                                data-allele={never}
                                                role="button"
                                                tabindex="0"
                                                aria-label={never ? `${geneId}: ${never} never seen` : geneId}
                                                onmouseenter={(e) => showTooltip(geneId, e.clientX, e.clientY)}
                                                onmouseleave={() => { tooltipVisible = false; }}
                                                onfocus={(e) => { const r = e.currentTarget.getBoundingClientRect(); showTooltip(geneId, r.left + r.width / 2, r.top); }}
                                                onblur={() => { tooltipVisible = false; }}
                                            >{never ?? ''}</div>
                                        {/if}
                                    </td>
                                {/each}
                            {/each}
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
        {#if lens === 'never' && neverSeenList.length > 0}
            <!-- The same alleles as text, for reading off beside a wild pet's
                 genome without matching columns. -->
            <ol class="never-list" aria-label="Never-seen alleles by chromosome" data-testid="map-never-list">
                {#each neverSeenList as line (line.chromosome)}
                    <li data-chromosome={line.chromosome}>
                        <span class="never-chr">{line.chromosome}</span>
                        <span class="never-alleles">
                            {#each line.alleles as a (a.geneId)}
                                <span class="never-entry" data-allele={a.allele}>{a.slot}&nbsp;<b>{a.allele}</b></span>
                            {/each}
                        </span>
                    </li>
                {/each}
            </ol>
        {/if}
        </div>
    {/if}

    <GeneTooltip
        visible={tooltipVisible}
        x={tooltipX}
        y={tooltipY}
        geneId={tooltipGeneId}
        geneType="x"
        subtitle={tooltipSubtitle}
        effectsLabel={lens === 'impact' ? 'Impact' : 'Rarity'}
        valenceFromText={false}
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

    .map-body {
        display: flex;
        gap: var(--space-md);
        flex: 1;
        min-height: 0;
        min-width: 0;
    }

    .never-list {
        flex: 0 0 auto;
        width: 15rem;
        margin: 0;
        padding: var(--space-xs) var(--space-sm);
        overflow: auto;
        list-style: none;
        border: 1px solid var(--border-primary);
        border-radius: 6px;
        background: var(--bg-secondary);
        font-size: 12px;
        font-variant-numeric: tabular-nums;
    }

    .never-list li {
        display: flex;
        gap: var(--space-sm);
        padding: var(--space-3xs) 0;
    }

    .never-list li + li {
        border-top: 1px solid var(--border-primary);
    }

    .never-chr {
        flex: 0 0 auto;
        width: 1.75em;
        color: var(--text-tertiary);
        font-weight: 600;
    }

    .never-alleles {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2xs) var(--space-sm);
        color: var(--text-secondary);
    }

    /* The letter names the allele; the hue is an underline, not the text
       colour, because the light-theme orange is below 4.5:1 on this surface. */
    .never-entry b {
        color: var(--text-primary);
        border-bottom: 2px solid;
    }

    .never-entry[data-allele="D"] b {
        border-bottom-color: var(--rarity-purple);
    }

    .never-entry[data-allele="R"] b {
        border-bottom-color: var(--rarity-orange);
    }

    .gene-grid-container {
        flex: 1;
        min-width: 0;
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
        padding-left: var(--space-md);
    }

    .position-header.block-start:first-of-type {
        padding-left: var(--space-3xs);
    }

    .map-legend {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.35em;
        margin: 0 0 var(--space-xs);
        font-size: 11px;
        color: var(--text-secondary);
    }

    .map-legend .swatch {
        width: 1.15em;
        height: 1.15em;
        border-radius: 3px;
        border: 1px solid var(--border-secondary);
    }

    .map-legend .legend-text {
        font-weight: 600;
    }

    .map-legend .legend-muted {
        color: var(--text-tertiary);
        font-weight: 500;
    }

    .map-legend .legend-gap {
        margin-left: 1.5em;
    }

    .map-status {
        margin: 0 0 var(--space-xs);
        font-size: 11px;
        color: var(--text-tertiary);
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
        padding-left: var(--space-sm);
    }

    .gene-cell-container.block-start:first-of-type {
        padding-left: 1px;
    }
</style>
