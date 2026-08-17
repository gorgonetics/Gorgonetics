<script lang="ts">
/**
 * Genes — the collapsible gene-value filter section of My Pets (#369).
 *
 * One chip per criterion, not per locus: an attribute expansion is a single
 * chip carrying its threshold (86 locus chips would bury the hand-picked
 * ones). The result narrows the roster itself; this section owns the adder,
 * the chips, and the §3 exclusion counts — including the not-revealed empty
 * state, which must never read as "you have no pets like this".
 * See docs/design/gene-value-filter-v1.md §5–§6.
 */

import { normalizeSpecies } from '$lib/services/configService.js';
import {
  type ExpandableAttribute,
  expandAttributeCriterion,
  listExpandableAttributes,
} from '$lib/services/geneCriteriaService.js';
import { getAllPetLociCached } from '$lib/services/petLociCache.js';
import {
  addGeneCriterion,
  clearGeneCriteria,
  myPetsView,
  removeGeneCriterion,
  replaceGeneCriterion,
} from '$lib/stores/mypets.svelte.js';
import { GeneType, type Pet } from '$lib/types/index.js';
import {
  type AttributeCriterion,
  type AttributeWant,
  classifyAgainstCriteria,
  evaluateAttribute,
  type GeneFilterVerdict,
  type KnownGeneType,
  type LocusCriterion,
  normalizeCriterion,
} from '$lib/utils/geneCriteria.js';
import type { PetLoci } from '$lib/utils/petLoci.js';

interface Props {
  /** Pets passing every non-gene filter — the §3 counts are over these. */
  candidates: Pet[];
  /** Loaded `pet_genes` projection; undefined while loading (criteria not applied — §7). */
  lociMap: Map<number, PetLoci> | undefined;
}

const { candidates, lociMap }: Props = $props();

const WANTS: AttributeWant[] = ['expresses', 'carries', 'pure'];
const STATES: { state: KnownGeneType; label: string }[] = [
  { state: GeneType.DOMINANT, label: 'D' },
  { state: GeneType.RECESSIVE, label: 'R' },
  { state: GeneType.MIXED, label: 'x' },
];

/** The species criteria target: locked once criteria exist, else the roster's species filter. */
const speciesForGenes = $derived(myPetsView.geneSpecies || myPetsView.species);
const active = $derived(myPetsView.geneCriteria);

// --- Attribute options for the adder --------------------------------------
let attributes = $state<ExpandableAttribute[]>([]);
$effect(() => {
  const sp = speciesForGenes;
  if (!sp) {
    attributes = [];
    return;
  }
  let cancelled = false;
  listExpandableAttributes(sp)
    .then((a) => {
      if (!cancelled) attributes = a;
    })
    .catch((err) => {
      console.error('gene filter: failed to list attributes', err);
      if (!cancelled) attributes = [];
    });
  return () => {
    cancelled = true;
  };
});

let selAttr = $state('');
let selWant = $state<AttributeWant>('carries');
let adding = $state(false);
let editingIndex = $state<number | null>(null);

const usedAttributes = $derived(
  new Set(active.filter((c) => c.kind === 'attribute').map((c) => (c as AttributeCriterion).attribute)),
);
// One attribute criterion per attribute (§8) — offered list excludes active ones.
const offerable = $derived(attributes.filter((a) => !usedAttributes.has(a.attribute)));

/**
 * The slider default sits at the median of the per-pet matched counts over
 * the current candidates, so the filter opens showing roughly half the
 * roster instead of zero or all of it (§5a). With one or two pets the
 * median is arbitrary — the sortable column is the interface there.
 */
async function medianMatched(criterion: AttributeCriterion, sp: string): Promise<number> {
  const ids = candidates.filter((p) => normalizeSpecies(p.species) === sp).map((p) => p.id);
  if (ids.length === 0) return 1;
  const loci = await getAllPetLociCached(ids);
  const counts = ids.map((id) => evaluateAttribute(criterion, loci.get(id)).matched).sort((a, b) => a - b);
  return counts[Math.floor(counts.length / 2)] ?? 1;
}

async function addAttribute(): Promise<void> {
  const sp = speciesForGenes;
  if (!sp || !selAttr || adding) return;
  adding = true;
  try {
    const expanded = await expandAttributeCriterion(sp, selAttr, selWant);
    if (!expanded) return;
    const median = await medianMatched(expanded, sp);
    const criterion = normalizeCriterion({ ...expanded, min: median });
    if (criterion) addGeneCriterion(criterion, sp);
    selAttr = '';
  } finally {
    adding = false;
  }
}

// --- Chip editing -----------------------------------------------------------

function setThreshold(index: number, criterion: AttributeCriterion, min: number): void {
  const next = normalizeCriterion({ ...criterion, min });
  if (next) replaceGeneCriterion(index, next);
}

/** Changing the want re-derives every locus's allow set — a re-expansion with the threshold kept. */
async function setWant(index: number, criterion: AttributeCriterion, want: AttributeWant): Promise<void> {
  if (want === criterion.want) return;
  const expanded = await expandAttributeCriterion(myPetsView.geneSpecies, criterion.attribute, want);
  if (!expanded) return;
  const next = normalizeCriterion({ ...expanded, min: criterion.min });
  if (next) replaceGeneCriterion(index, next);
}

/** Re-snapshot against the current effects DB (§11: snapshots are stable; this is the opt-in refresh). */
async function reExpand(index: number, criterion: AttributeCriterion): Promise<void> {
  const expanded = await expandAttributeCriterion(myPetsView.geneSpecies, criterion.attribute, criterion.want);
  if (!expanded) {
    removeGeneCriterion(index);
    return;
  }
  const next = normalizeCriterion({ ...expanded, min: criterion.min });
  if (next) replaceGeneCriterion(index, next);
}

/**
 * Toggle one state on a locus chip. The last active state can't be turned
 * off (empty matches nothing — §8), and allowing all three is not a filter,
 * so the criterion drops (§2).
 */
function toggleLocusState(index: number, criterion: LocusCriterion, state: KnownGeneType): void {
  const has = criterion.allow.includes(state);
  if (has && criterion.allow.length === 1) return;
  const allow = has ? criterion.allow.filter((s) => s !== state) : [...criterion.allow, state];
  const next = normalizeCriterion({ ...criterion, allow });
  if (next) replaceGeneCriterion(index, next);
  else removeGeneCriterion(index);
}

// --- §3 result counts --------------------------------------------------------

const speciesCandidates = $derived(
  speciesForGenes ? candidates.filter((p) => normalizeSpecies(p.species) === speciesForGenes) : [],
);

const verdicts = $derived.by(() => {
  if (active.length === 0 || !lociMap) return null;
  const tally: Record<GeneFilterVerdict, number> = { match: 0, 'not-revealed': 0, 'no-match': 0, 'not-imported': 0 };
  for (const p of speciesCandidates) {
    tally[classifyAgainstCriteria(lociMap.get(p.id), active)]++;
  }
  return tally;
});

function chipLabel(c: AttributeCriterion): string {
  return `${c.attribute} · ${c.want} ≥${c.min} of ${c.loci.length}`;
}
</script>

<div class="gene-filter" data-testid="gene-filter">
  <button
    type="button"
    class="gf-toggle"
    data-testid="gene-filter-toggle"
    aria-expanded={myPetsView.genesOpen}
    onclick={() => {
      myPetsView.genesOpen = !myPetsView.genesOpen;
    }}
  >
    <span class="gf-caret" aria-hidden="true">{myPetsView.genesOpen ? '▾' : '▸'}</span>
    🧬 Genes{active.length > 0 ? ` (${active.length})` : ''}
  </button>

  {#if active.length > 0 && verdicts}
    <span class="gf-counts" data-testid="gene-filter-counts">
      {verdicts.match} of {speciesCandidates.length} match
      {#if verdicts['not-revealed'] > 0}
        · {verdicts['not-revealed']} not revealed
      {/if}
      {#if verdicts['not-imported'] > 0}
        · {verdicts['not-imported']} not imported
      {/if}
    </span>
  {:else if active.length > 0 && !lociMap}
    <span class="gf-counts" data-testid="gene-filter-loading">Loading gene data — filter not applied yet…</span>
  {/if}

  {#if myPetsView.genesOpen}
    <div class="gf-body">
      {#if !speciesForGenes}
        <p class="gf-hint">Pick a species above to filter by gene values.</p>
      {:else}
        <div class="gf-adder">
          <select
            class="gf-select"
            data-testid="gene-filter-attribute"
            bind:value={selAttr}
            aria-label="Attribute to filter by"
          >
            <option value="">Attribute…</option>
            {#each offerable as a (a.attribute)}
              <option value={a.attribute}>{a.attribute} ({a.lociCount} loci)</option>
            {/each}
          </select>
          <div class="seg" role="group" aria-label="Want">
            {#each WANTS as w (w)}
              <button
                type="button"
                class="seg-btn gf-seg-btn"
                class:active={selWant === w}
                aria-pressed={selWant === w}
                onclick={() => {
                  selWant = w;
                }}
              >{w}</button>
            {/each}
          </div>
          <button
            type="button"
            class="gf-add"
            data-testid="gene-filter-add"
            disabled={!selAttr || adding}
            onclick={addAttribute}
          >{adding ? 'Adding…' : '+ Add'}</button>
          <span class="gf-map-hint">Specific loci: click cells on the Reference genome map.</span>
        </div>

        {#if active.length > 0}
          <div class="gf-chips" data-testid="gene-filter-chips">
            {#each active as criterion, i (criterion.kind === 'locus' ? `locus:${criterion.geneId}` : `attr:${criterion.attribute}`)}
              {#if criterion.kind === 'attribute'}
                <div class="gf-chip" data-testid="gene-chip-attribute">
                  <span class="gf-chip-label">{chipLabel(criterion)}</span>
                  <button
                    type="button"
                    class="gf-chip-btn"
                    data-testid="gene-chip-edit"
                    aria-expanded={editingIndex === i}
                    onclick={() => {
                      editingIndex = editingIndex === i ? null : i;
                    }}
                  >edit</button>
                  <button
                    type="button"
                    class="gf-chip-btn"
                    data-testid="gene-chip-remove"
                    aria-label="Remove {criterion.attribute} criterion"
                    onclick={() => {
                      editingIndex = null;
                      removeGeneCriterion(i);
                    }}
                  >×</button>
                </div>
                {#if editingIndex === i}
                  <div class="gf-editor" data-testid="gene-chip-editor">
                    <div class="seg" role="group" aria-label="Want for {criterion.attribute}">
                      {#each WANTS as w (w)}
                        <button
                          type="button"
                          class="seg-btn gf-seg-btn"
                          class:active={criterion.want === w}
                          aria-pressed={criterion.want === w}
                          onclick={() => setWant(i, criterion, w)}
                        >{w}</button>
                      {/each}
                    </div>
                    <label class="gf-slider">
                      at least
                      <input
                        type="range"
                        min="1"
                        max={criterion.loci.length}
                        value={criterion.min}
                        data-testid="gene-chip-threshold"
                        oninput={(e) => setThreshold(i, criterion, Number(e.currentTarget.value))}
                      />
                      <strong>{criterion.min}</strong> of {criterion.loci.length}
                    </label>
                    <button
                      type="button"
                      class="gf-chip-btn"
                      data-testid="gene-chip-reexpand"
                      title="Re-resolve the locus list against the current gene templates"
                      onclick={() => reExpand(i, criterion)}
                    >re-expand</button>
                  </div>
                {/if}
              {:else}
                <div class="gf-chip" data-testid="gene-chip-locus">
                  <span class="gf-chip-label">{criterion.geneId}</span>
                  <span class="gf-states" role="group" aria-label="Allowed states for {criterion.geneId}">
                    {#each STATES as s (s.state)}
                      <button
                        type="button"
                        class="gf-state"
                        class:active={criterion.allow.includes(s.state)}
                        aria-pressed={criterion.allow.includes(s.state)}
                        data-state={s.label}
                        onclick={() => toggleLocusState(i, criterion, s.state)}
                      >{s.label}</button>
                    {/each}
                  </span>
                  <button
                    type="button"
                    class="gf-chip-btn"
                    data-testid="gene-chip-remove"
                    aria-label="Remove {criterion.geneId} criterion"
                    onclick={() => removeGeneCriterion(i)}
                  >×</button>
                </div>
              {/if}
            {/each}
            <button type="button" class="gf-clear" data-testid="gene-filter-clear" onclick={clearGeneCriteria}>
              Clear all
            </button>
          </div>

          {#if verdicts && verdicts.match === 0 && verdicts['not-revealed'] > 0}
            <!-- §3: an empty roster from unrevealed loci is not "you have no pets
                 like this" — skill-gating is uniform, so nobody has looked yet. -->
            <p class="gf-empty" data-testid="gene-filter-not-revealed">
              No pets match — but {verdicts['not-revealed']} of {speciesCandidates.length} were excluded because a
              filtered locus isn't revealed on them. Re-study those pets to find out.
            </p>
          {/if}
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .gene-filter {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-2xs) var(--space-xl);
    border-bottom: 1px solid var(--border-primary);
    background: var(--bg-secondary);
    font-size: 12px;
  }
  .gf-toggle {
    background: none;
    border: none;
    padding: var(--space-2xs) 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .gf-toggle:hover { color: var(--accent-text, var(--accent)); }
  .gf-caret { display: inline-block; width: 1em; color: var(--text-tertiary); }
  .gf-counts { color: var(--text-tertiary); }

  .gf-body { flex-basis: 100%; display: flex; flex-direction: column; gap: var(--space-sm); padding-bottom: var(--space-xs); }
  .gf-hint { margin: 0; color: var(--text-muted); font-style: italic; }
  .gf-adder { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-sm); }
  .gf-select {
    padding: var(--space-2xs) var(--space-sm);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-md);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 12px;
  }
  /* Chrome comes from the shared .seg/.seg-btn (app.css); compact sizing here. */
  .gf-seg-btn { font-size: 11px; padding: var(--space-2xs) var(--space-md); }
  .gf-add {
    padding: var(--space-2xs) var(--space-md);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-md);
    background: var(--bg-primary);
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .gf-add:hover:not(:disabled) { border-color: var(--accent); color: var(--accent-text, var(--accent)); }
  .gf-add:disabled { opacity: 0.5; cursor: default; }
  .gf-map-hint { color: var(--text-muted); font-size: 11px; }

  .gf-chips { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-xs); }
  /* Deliberately neutral chrome: no purple/orange — those hues belong to the
     rarity lens, and #465 must be able to compose the two without a collision. */
  .gf-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-2xs) var(--space-sm);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-pill);
    background: var(--bg-primary);
  }
  .gf-chip-label { font-weight: 600; color: var(--text-secondary); }
  .gf-chip-btn {
    background: none;
    border: none;
    padding: 0 var(--space-2xs);
    font-size: 11px;
    color: var(--text-tertiary);
    cursor: pointer;
  }
  .gf-chip-btn:hover { color: var(--accent-text, var(--accent)); }
  .gf-states { display: inline-flex; gap: var(--space-3xs); }
  .gf-state {
    width: 20px;
    height: 20px;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    background: var(--bg-primary);
    color: var(--text-tertiary);
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
  }
  .gf-state.active { background: var(--accent); border-color: var(--accent); color: var(--text-inverse); }
  .gf-editor { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-md); padding-left: var(--space-lg); }
  .gf-slider { display: inline-flex; align-items: center; gap: var(--space-xs); color: var(--text-secondary); }
  .gf-clear {
    background: none;
    border: none;
    padding: 0 var(--space-xs);
    font-size: 11px;
    color: var(--text-tertiary);
    text-decoration: underline;
    cursor: pointer;
  }
  .gf-clear:hover { color: var(--accent-text, var(--accent)); }
  .gf-empty {
    margin: 0;
    padding: var(--space-xs) var(--space-md);
    border: 1px dashed var(--border-primary);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
  }
</style>
