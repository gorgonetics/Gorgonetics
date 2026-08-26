<script lang="ts">
/**
 * The Breed destination — a first-class, search-first breeding helper. Pick a
 * species and it ranks male × female pairs across your whole stabled collection
 * of that species, then opens the offspring Trio on inspect. Unlike the old
 * selection-driven lens, breeding starts here without pre-selecting pets — the
 * tool finds the best pairs for you. Reuses the breeding service + pair table +
 * TrioView. See docs/design/redesign-library-workspace-v1.md (§2, IA v2).
 */
import { onDestroy } from 'svelte';
import BreedingPairTable from '$lib/components/breeding/BreedingPairTable.svelte';
import BreedingPoolPanel from '$lib/components/breeding/BreedingPoolPanel.svelte';
import TrioView from '$lib/components/breeding/TrioView.svelte';
import BreedSelector from '$lib/components/shared/BreedSelector.svelte';
import EmptyState from '$lib/components/shared/EmptyState.svelte';
import PageHeader from '$lib/components/shared/PageHeader.svelte';
import StatusPane from '$lib/components/shared/StatusPane.svelte';
import { rankBreedingPairs } from '$lib/services/breedingService.js';
import { getAllAttributeNames, getSupportedSpecies, normalizeSpecies } from '$lib/services/configService.js';
import { breedingView, clearBench, toggleBench } from '$lib/stores/breeding.svelte.js';
// `loading` aliased: this component has its own ranking `loading` flag.
import { pets, loading as petsLoading } from '$lib/stores/pets.js';
import { type BreedingPairResult, HORSE_BREEDS } from '$lib/types/index.js';
import {
  attributeObjective,
  BREEDING_OBJECTIVES,
  type BreedingObjective,
  resolveObjective,
} from '$lib/utils/breedingObjectives.js';
import { suggestPlans } from '$lib/utils/breedingPlan.js';
import { getSpeciesEmoji } from '$lib/utils/species.js';
import { capitalize } from '$lib/utils/string.js';

// Species options, normalized for matching but shown with their display name.
const speciesOptions = getSupportedSpecies().map((s) => ({
  raw: s,
  key: normalizeSpecies(s),
  label: capitalize(normalizeSpecies(s)),
}));

// Until the player picks a species, default to the most-populated *stabled*
// one (a user with 25 stabled horses and 7 beewasps should land on horses,
// not the alphabetical first). Derived, not assigned at mount: the pet list
// lands well after mount (AuthWrapper's loadPets), so a mount-time pick would
// race it and lock in the fallback. Ties go to supported-species order.
const defaultSpecies = $derived.by(() => {
  const counts = new Map<string, number>();
  for (const p of $pets) {
    if (!p.stabled) continue;
    const key = normalizeSpecies(p.species);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const opt of speciesOptions) {
    const count = counts.get(opt.key) ?? 0;
    if (count > bestCount) {
      best = opt.key;
      bestCount = count;
    }
  }
  return best || (speciesOptions[0]?.key ?? '');
});

// An explicit pick persists in breedingView.species across destination
// switches (this component unmounts); '' falls through to the default.
const species = $derived(breedingView.species || defaultSpecies);

// Breeding spots. 0 = planning off (flat ranking). Clamped to a sane range;
// the exact ceiling is arbitrary — you never plan dozens of simultaneous pairs.
function setSpots(n: number) {
  breedingView.spots = Math.max(0, Math.min(99, Math.floor(n)));
}

function selectSpecies(key: string) {
  const changed = key !== species;
  // Pin the choice even when it matches the current default, so a later
  // change in stable composition can't silently move the player elsewhere.
  breedingView.species = key;
  if (changed) {
    breedingView.offspringBreed = '';
    breedingView.scrollTop = 0;
    breedingView.scrollLeft = 0;
  }
}

// Offspring breed only shapes the ranking for species that have breeds (horses:
// breed-locked loci are dropped, and it feeds the pool-gap pairing weight).
const breedsForSpecies = $derived(species === 'horse' ? HORSE_BREEDS : null);

const attrNames = $derived(species ? getAllAttributeNames(species).map(capitalize) : []);

// Breed across the stable: every stabled pet of the chosen species. `pool` is
// the full set (shown in the bench panel so benched animals can be returned);
// `candidates` drops the benched ones and feeds the ranking.
const pool = $derived($pets.filter((p) => p.stabled && normalizeSpecies(p.species) === species));
const candidates = $derived(pool.filter((p) => !breedingView.benchedIds.has(p.id)));
// Identity of the candidate set (which stabled pets of this species exist).
// Lets us skip a re-rank when a `$pets` re-emit returns the same set with a new
// array reference (a background loadPets, an unrelated marker toggle, …).
const candidateKey = $derived(`${species}|${candidates.map((p) => p.id).join(',')}`);

let pairs = $state<BreedingPairResult[]>([]);
let loading = $state(false);
let errored = $state(false);

/**
 * The strategies on offer: the five general ones plus one per attribute.
 *
 * Breeding has no single objective — each of these surfaces pairings the
 * others hide, and which is right changes from round to round (design doc
 * §10a). So the player picks, and the picked selector drives both the table
 * sort and the planner. No blend is offered: the weights would encode a
 * breeding strategy the app has no basis to choose.
 */
const objectives = $derived<BreedingObjective[]>([
  ...BREEDING_OBJECTIVES,
  ...attrNames.map((a) => attributeObjective(a)),
]);
// `attrNames` invalidates a persisted `attribute:<Name>` pick that the current
// species has no attribute for (switch from horses to beewasps and back). Left
// unfiltered, the <select> would hold a value matching no option — the browser
// shows the first option while the planner and the sort column still use the
// stale attribute strategy. The store keeps the id, so the pick returns when
// the player switches back.
const objective = $derived(
  resolveObjective(breedingView.objective, attrNames) ?? (BREEDING_OBJECTIVES[0] as BreedingObjective),
);

function selectObjective(id: string) {
  breedingView.objective = id;
  // The table sorts by the strategy's own column so the ranking it shows and
  // the ranking it planned with cannot disagree. An attribute strategy keeps
  // its own id as the column: the table renders a Δ column for it, because
  // the plain per-attribute column holds the *absolute* expected value, not
  // the improvement the strategy ranks by.
  const column = id.startsWith('attribute:') ? id : OBJECTIVE_COLUMN[id];
  if (column) {
    breedingView.sortCol = column;
    breedingView.sortDir = 'desc';
  }
}

/** Which table column each general strategy sorts. */
const OBJECTIVE_COLUMN: Record<string, string> = {
  reach: 'evCapabilityGain',
  ceiling: 'evPositiveImprovement',
  floor: 'evPairUpgrade',
  clean: 'evLiabilityReduction',
  positives: 'evPositiveTotal',
};

// Suggested plans (spots > 0): several distinct N-pair options, ranked by the
// chosen strategy. undefined when planning is off — the table then shows the
// flat ranking.
const plans = $derived(
  breedingView.spots > 0
    ? suggestPlans({ ranked: pairs, slots: breedingView.spots, score: objective.score })
    : undefined,
);
let seq = 0;
let prevKey: string | undefined;
let prevSpecies: string | undefined;

$effect(() => {
  // Re-rank when the species, its candidate set, or the offspring breed
  // actually changes — NOT on every `$pets` emission. A sequence guard
  // discards stale async results.
  const sp = species;
  const breed = breedingView.offspringBreed;
  const ps = candidates;
  const key = `${candidateKey}|${breed}`;

  // Only close an open Trio on a genuine species change. An unrelated store
  // refresh (or an offspring-breed change) must not yank the projection shut.
  if (prevSpecies !== undefined && prevSpecies !== sp) {
    breedingView.selectedPair = null;
    // Drop the previous species' pairs so the loading pane shows instead of
    // ranking/plans built from the old species during the async re-rank. Only
    // on a species change — same-species refreshes keep `pairs` to avoid
    // flicker.
    pairs = [];
  }
  const unchanged = prevKey === key;
  prevKey = key;
  prevSpecies = sp;
  if (unchanged) return;

  if (!sp || ps.length === 0) {
    pairs = [];
    loading = false;
    errored = false;
    return;
  }

  const mine = ++seq;
  loading = true;
  errored = false;
  rankBreedingPairs({ species: sp, pets: ps, offspringBreed: breed })
    .then((result) => {
      if (mine !== seq) return;
      pairs = result;
      loading = false;
    })
    .catch((err: unknown) => {
      if (mine !== seq) return;
      console.error('rankBreedingPairs failed', err);
      pairs = [];
      errored = true;
      loading = false;
    });
});

// An open Trio holds Pet objects frozen at click time; nothing above ties its
// lifetime to the candidate set, so a parent that is deleted or unstabled
// would keep rendering stale data indefinitely. Drop back to the pair table
// when either parent leaves the candidates — but only on a *settled* load
// (!$petsLoading): during an in-flight reload the list can briefly lack the
// pet, and that window always closes with `loading` true, so it can't be
// mistaken for a deletion (same guard as MyPets' detail overlay).
$effect(() => {
  const pair = breedingView.selectedPair;
  if (!pair || $petsLoading) return;
  const inCandidates = (id: number) => candidates.some((p) => p.id === id);
  if (!inCandidates(pair.male.id) || !inCandidates(pair.female.id)) {
    breedingView.selectedPair = null;
  }
});

onDestroy(() => {
  breedingView.selectedPair = null;
});
</script>

<div class="breed-view" data-testid="breed-view">
  <!-- Heading landmark for screen readers / heading-order checks. The visible
       title is dropped (it just repeats the nav tab), but the page still needs a
       heading — see commit d090655. -->
  <h2 class="sr-only">Breeding helper</h2>
  <PageHeader>
    {#snippet actions()}
      <div class="seg bv-species" role="group" aria-label="Species" data-testid="breed-species">
        {#each speciesOptions as opt (opt.key)}
          <button
            type="button"
            class="seg-btn species-btn"
            class:active={species === opt.key}
            aria-pressed={species === opt.key}
            data-species={opt.key}
            onclick={() => selectSpecies(opt.key)}
          >
            {getSpeciesEmoji(opt.raw)} {opt.label}
          </button>
        {/each}
      </div>

      {#if breedsForSpecies}
        <div data-testid="breed-offspring">
          <BreedSelector
            value={breedingView.offspringBreed}
            breeds={breedsForSpecies}
            label="Offspring breed"
            onChange={(v) => { breedingView.offspringBreed = v; }}
          />
        </div>
      {/if}

      {#if pool.length > 0}
        <div class="tb-objective" data-testid="breed-objective">
          <label class="plan-label" for="breed-objective-select">Breed for</label>
          <select
            id="breed-objective-select"
            class="objective-select"
            title={objective.description}
            value={objective.id}
            onchange={(e) => selectObjective((e.currentTarget as HTMLSelectElement).value)}
          >
            {#each objectives as opt (opt.id)}
              <option value={opt.id} title={opt.description}>{opt.label}</option>
            {/each}
          </select>
        </div>

        <div class="tb-spots" data-testid="breed-plan-controls">
          <span class="plan-label">Breed at once</span>
          <div class="stepper" role="group" aria-label="Breeding spots">
            <button
              type="button"
              class="step-btn"
              aria-label="Fewer breeding spots"
              disabled={breedingView.spots <= 0}
              onclick={() => setSpots(breedingView.spots - 1)}
            >−</button>
            <span class="spots-val" data-testid="spots-value">{breedingView.spots > 0 ? breedingView.spots : 'Off'}</span>
            <button
              type="button"
              class="step-btn"
              aria-label="More breeding spots"
              onclick={() => setSpots(breedingView.spots + 1)}
            >+</button>
          </div>
        </div>
      {/if}
    {/snippet}
  </PageHeader>

  {#if pool.length > 0}
    <div class="bv-pool">
      <BreedingPoolPanel
        {pool}
        benchedIds={breedingView.benchedIds}
        onToggle={toggleBench}
        onClearBench={() => clearBench(pool.map((p) => p.id))}
      />
    </div>
  {/if}

  <div class="bv-body">
    {#if errored}
      <StatusPane variant="error" title="Couldn't rank these pairs." body="Something went wrong computing scores. Switch species to retry." />
    {:else if loading && pairs.length === 0}
      <StatusPane variant="loading" body="Computing pair scores…" />
    {:else if pool.length === 0}
      <EmptyState
        icon="🐾"
        title="No stabled {capitalize(species)} pets"
        body="Breeding ranks pairs from your stabled pets. Stable some {capitalize(species)} pets in My Pets, then come back."
      />
    {:else if candidates.length === 0}
      <EmptyState
        icon="⏸️"
        title="Every {capitalize(species)} is benched"
        body="All your stabled {capitalize(species)} pets are benched. Return some from the Pool above to rank pairs."
      />
    {:else if pairs.length === 0}
      <EmptyState
        icon="💞"
        title="No pairs to rank"
        body="Breeding pairs a male with a female. You need at least one stabled male and one stabled female of this species."
      />
    {:else}
      <div class="bv-meta">
        {#if breedingView.spots > 0}
          {@const planSize = plans?.[0]?.pairs.length ?? 0}
          {planSize} {planSize === 1 ? 'pair' : 'pairs'} at once{planSize < breedingView.spots ? ' · most your pool allows' : ''} · suggested plans, best first · sort any column
        {:else}
          {pairs.length} {pairs.length === 1 ? 'pair' : 'pairs'} · ranked to
          <span class="objective-name" data-testid="breed-objective-hint">{objective.label.toLowerCase()}</span>
          <span class="objective-why">— {objective.description}</span>
        {/if}
      </div>
      <!-- Row-level bench is a ranking-mode convenience; hidden while planning
           so a stray click can't silently collapse several shown options. -->
      <BreedingPairTable results={pairs} {attrNames} {plans} onBench={breedingView.spots > 0 ? undefined : toggleBench} />
    {/if}
  </div>
</div>

{#if breedingView.selectedPair}
  <TrioView
    pair={breedingView.selectedPair}
    offspringBreed={breedingView.offspringBreed}
    onClose={() => { breedingView.selectedPair = null; }}
  />
{/if}

<style>
  .breed-view { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  /* Header controls (in PageHeader's actions slot). Chrome for .seg/.seg-btn
     comes from app.css. */
  .bv-species { flex-shrink: 0; }
  .species-btn { padding: var(--space-2xs) var(--space-lg); }
  .tb-objective { display: flex; align-items: center; gap: var(--space-xs); min-width: 0; }
  .objective-select {
    font: inherit; font-size: 12px; padding: var(--space-3xs) var(--space-xs);
    border: 1px solid var(--border-primary); border-radius: 6px;
    background: var(--bg-primary); color: var(--text-primary); cursor: pointer;
  }
  /* The strategy's trade-off belongs where there is room to read it — the
     labels alone ("Raise the floor") do not say what they cost. In the
     toolbar it truncated mid-word, so it lives on the results line instead
     and on the select as a tooltip. */
  .objective-name { font-weight: 600; color: var(--text-secondary); }
  .objective-why { color: var(--text-muted); }
  .tb-spots { display: flex; align-items: center; gap: var(--space-xs); }
  .plan-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); white-space: nowrap; }
  .stepper { display: inline-flex; align-items: center; border: 1px solid var(--border-primary); border-radius: 6px; overflow: hidden; }
  .step-btn { width: 26px; height: 24px; background: var(--bg-secondary); border: none; color: var(--text-primary); font-size: 15px; line-height: 1; cursor: pointer; }
  .step-btn:hover:not(:disabled) { background: var(--bg-tertiary); }
  .step-btn:disabled { color: var(--text-tertiary); cursor: default; }
  .spots-val { min-width: 32px; text-align: center; font-size: 13px; font-variant-numeric: tabular-nums; padding: 0 var(--space-2xs); }
  .bv-pool { margin: var(--space-sm) var(--space-2xl) 0; flex-shrink: 0; }
  .bv-body { flex: 1; min-height: 0; overflow: auto; padding: var(--space-sm) var(--space-2xl) var(--space-xl); display: flex; flex-direction: column; gap: var(--space-sm); }
  .bv-meta { font-size: 12px; color: var(--text-tertiary); }
</style>
