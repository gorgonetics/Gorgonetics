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
import TrioView from '$lib/components/breeding/TrioView.svelte';
import BreedSelector from '$lib/components/shared/BreedSelector.svelte';
import EmptyState from '$lib/components/shared/EmptyState.svelte';
import PageHeader from '$lib/components/shared/PageHeader.svelte';
import StatusPane from '$lib/components/shared/StatusPane.svelte';
import { rankBreedingPairs } from '$lib/services/breedingService.js';
import { getAllAttributeNames, getSupportedSpecies, normalizeSpecies } from '$lib/services/configService.js';
import { breedingView } from '$lib/stores/breeding.svelte.js';
// `loading` aliased: this component has its own ranking `loading` flag.
import { pets, loading as petsLoading } from '$lib/stores/pets.js';
import { type BreedingPairResult, HORSE_BREEDS } from '$lib/types/index.js';
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

// Breed across the stable: every stabled pet of the chosen species.
const candidates = $derived($pets.filter((p) => p.stabled && normalizeSpecies(p.species) === species));
// Identity of the candidate set (which stabled pets of this species exist).
// Lets us skip a re-rank when a `$pets` re-emit returns the same set with a new
// array reference (a background loadPets, an unrelated marker toggle, …).
const candidateKey = $derived(`${species}|${candidates.map((p) => p.id).join(',')}`);

let pairs = $state<BreedingPairResult[]>([]);
let loading = $state(false);
let errored = $state(false);
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
  <PageHeader
    icon="💞"
    title="Breeding helper"
    subtitle="Pick a species to rank the best male × female pairs across your stable, then inspect the offspring projection."
  />

  <div class="bv-species" role="group" aria-label="Species" data-testid="breed-species">
    {#each speciesOptions as opt (opt.key)}
      <button
        type="button"
        class="species-btn"
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
    <div class="bv-breed" data-testid="breed-offspring">
      <BreedSelector
        value={breedingView.offspringBreed}
        breeds={breedsForSpecies}
        label="Offspring breed"
        onChange={(v) => { breedingView.offspringBreed = v; }}
      />
    </div>
  {/if}

  <div class="bv-body">
    {#if errored}
      <StatusPane variant="error" title="Couldn't rank these pairs." body="Something went wrong computing scores. Switch species to retry." />
    {:else if loading && pairs.length === 0}
      <StatusPane variant="loading" body="Computing pair scores…" />
    {:else if candidates.length === 0}
      <EmptyState
        icon="🐾"
        title="No stabled {capitalize(species)} pets"
        body="Breeding ranks pairs from your stabled pets. Stable some {capitalize(species)} pets in My Pets, then come back."
      />
    {:else if pairs.length === 0}
      <EmptyState
        icon="💞"
        title="No pairs to rank"
        body="Breeding pairs a male with a female. You need at least one stabled male and one stabled female of this species."
      />
    {:else}
      <div class="bv-meta">{pairs.length} {pairs.length === 1 ? 'pair' : 'pairs'} · ranked by expected offspring quality</div>
      <BreedingPairTable results={pairs} {attrNames} />
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
  /* Segmented control, consistent with the My Pets species toggle (FilterBar). */
  .bv-species {
    display: inline-flex; align-self: flex-start; gap: 2px; flex-shrink: 0;
    margin: 0 20px 10px; padding: 2px; border-radius: 8px; background: var(--bg-tertiary);
  }
  .species-btn {
    border: none; background: transparent; color: var(--text-tertiary);
    font-size: 12px; font-weight: 600; padding: 5px 14px; border-radius: 6px; cursor: pointer;
  }
  .species-btn:hover { color: var(--text-secondary); }
  .species-btn.active {
    background: var(--bg-primary); color: var(--text-primary);
    box-shadow: var(--shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.06));
  }
  .bv-breed { margin: 0 20px 10px; flex-shrink: 0; }
  .bv-body { flex: 1; min-height: 0; overflow: auto; padding: 0 20px 16px; display: flex; flex-direction: column; gap: 8px; }
  .bv-meta { font-size: 12px; color: var(--text-tertiary); }
</style>
