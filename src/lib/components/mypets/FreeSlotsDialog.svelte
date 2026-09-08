<script lang="ts">
/**
 * Free up slots — which animals to release, and what it costs.
 *
 * The game caps concurrent breeding, so a full stable has to give up a fixed
 * number of animals to start a round. That makes the question "which six, and
 * what do I lose?" rather than "what is expendable?".
 *
 * Two things this must not do, both learned the hard way (design doc §4a):
 *
 *  - **Never present the list as an unordered set.** Leave-one-out scores are
 *    not additive: where two animals are the only carriers of an allele, each
 *    reads as free because the other covers it, yet releasing both loses it.
 *    The order is the guarantee, so the UI numbers the steps.
 *  - **Never breed-scope the decision.** Releasing is irreversible against
 *    every breed you might later target; `safeCullSet` takes no breed filter,
 *    and this view must not offer one.
 *
 * And three things the score cannot see, which the dialog adds around it
 * (design doc §4c): enough of each sex for the pairs the slots are for, the
 * stable's best animal by phenotype, and — as a mode the player picks — the
 * negatives an animal takes with it.
 *
 * Releasing here means un-stabling, not deleting: the pet and its genome stay
 * in the library, it simply leaves the breeding pool. That is the reversible
 * reading of "make room", and it is what the copy promises.
 */
import { type SafeCullSet, safeCullSet } from '$lib/services/geneticQualityService.js';
import { Gender, type Pet } from '$lib/types/index.js';
import { focusTrap } from '$lib/utils/focusTrap.js';
import { MIN_POPULATION } from '$lib/utils/geneticQuality.js';

interface Props {
  /** Canonical species key — capability is only comparable within one. */
  species: string;
  /** The stabled animals of that species; the population releases are judged against. */
  pets: Pet[];
  /** Release the listed animals (un-stable them). Resolves when done. */
  onRelease: (ids: number[]) => Promise<void>;
  onClose: () => void;
}

const { species, pets, onRelease, onClose }: Props = $props();

/** The game's concurrent-breeding cap, and so the usual number of slots wanted. */
const DEFAULT_SLOTS = 6;

let slots = $state(DEFAULT_SLOTS);
/**
 * The most that can be released: the walk stops strictly above the floor.
 * `min`/`max` on the input are advisory only — `bind:value` will happily
 * hand over `0`, or `null` for a cleared field, and a target of `0` makes
 * the walk return an empty list that the UI would then misreport as "nothing
 * is releasable".
 */
const maxSlots = $derived(Math.max(1, pets.length - MIN_POPULATION));
const target = $derived(Math.min(maxSlots, Math.max(1, Math.floor(Number(slots) || 1))));
/** Keep the best animal by + Genes and by stats out of the list. */
let protectBest = $state(true);
/** What the release optimises: potential kept, or negatives shed. */
let mode = $state<'potential' | 'clean'>('potential');
let plan = $state<SafeCullSet | null>(null);
let loading = $state(true);
let failed = $state(false);
let releasing = $state(false);
let releaseFailed = $state(false);

/**
 * Identity of the request: the target, the options and the population it is
 * judged against. Same shape as BreedView's `candidateKey` — it makes the
 * effect's dependencies explicit instead of relying on which fields the body
 * happens to read.
 */
const requestKey = $derived(`${species}|${target}|${protectBest}|${mode}|${pets.map((p) => p.id).join(',')}`);

// The walk re-scores after every removal, so a different target is a
// different answer, not a prefix of one — any key change means a refetch.
$effect(() => {
  void requestKey;
  let live = true;
  loading = true;
  failed = false;
  safeCullSet({ species, pets, slots: target, protectBest, mode })
    .then((r) => {
      if (live) plan = r;
    })
    .catch(() => {
      if (live) failed = true;
    })
    .finally(() => {
      if (live) loading = false;
    });
  return () => {
    live = false;
  };
});

const releases = $derived(plan?.releases ?? []);
const shortfall = $derived(Math.max(0, target - releases.length));
/**
 * Animals the walk was never allowed to touch. A union, not a sum of the three
 * lists: a starred pet with no genome appears in two of them, and summing
 * lengths can reach the herd size while releasable animals remain — which
 * would tell the player everything is excluded and hide the real reason.
 */
const keptOut = $derived(
  new Set([
    ...(plan?.pinned ?? []).map((p) => p.id),
    ...(plan?.protectedBest ?? []).map((p) => p.id),
    ...(plan?.unscored ?? []).map((p) => p.id),
  ]).size,
);
const fmt = (n: number) => (n === 0 ? '0' : n.toFixed(1));
const names = (ps: Pet[]) => ps.map((p) => p.name || 'unnamed').join(', ');
const sexLabel = (g: Gender) => (g === Gender.MALE ? 'males' : 'females');
/** The sexes the floor is holding back, as the dialog names them. */
const heldSexes = $derived((plan?.atFloor ?? []).map(sexLabel).join(' or '));
const allFree = $derived(plan !== null && plan.totalCost === 0);

async function release() {
  if (releases.length === 0 || releasing) return;
  releasing = true;
  releaseFailed = false;
  try {
    await onRelease(releases.map((r) => r.pet.id));
    onClose();
  } catch {
    // Some animals may already have been released; the caller reloads either
    // way, so keep the dialog open and say so rather than closing on a lie.
    releaseFailed = true;
  } finally {
    releasing = false;
  }
}
</script>

<div
  class="modal-backdrop"
  onclick={onClose}
  onkeydown={(e) => {
    if (e.key === 'Escape') onClose();
  }}
  role="presentation"
>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="dialog free-slots-dialog"
    role="dialog"
    aria-label="Free up breeding slots"
    aria-modal="true"
    tabindex="-1"
    use:focusTrap
    data-testid="free-slots-dialog"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => {
      if (e.key === 'Escape') onClose();
    }}
  >
    <div class="dialog-header">
      <h3>Free up slots</h3>
      <button type="button" class="close-btn" aria-label="Close" onclick={onClose}>✕</button>
    </div>

    <div class="dialog-body">
      <div class="slots-row">
        <label for="free-slots-count">Slots to free</label>
        <input
          id="free-slots-count"
          type="number"
          min="1"
          max={maxSlots}
          bind:value={slots}
          data-testid="free-slots-count"
        />
        <span class="slots-note">from {pets.length} stabled</span>
      </div>
      <div class="options-row">
        <label class="mode">
          <span>Release by</span>
          <select bind:value={mode} data-testid="free-slots-mode" title="Potential: lose the least breeding capability. Clean: let liability-heavy animals go first, even at some cost to potential.">
            <option value="potential">least potential lost</option>
            <option value="clean">most negatives cleared</option>
          </select>
        </label>
        <label class="protect">
          <input type="checkbox" bind:checked={protectBest} data-testid="free-slots-protect" />
          <span>Keep my best by + Genes and by stats</span>
        </label>
      </div>

      {#if failed}
        <p class="msg error" data-testid="free-slots-error">
          Couldn't work out a release order. Close and try again.
        </p>
      {:else if loading}
        <p class="msg" data-testid="free-slots-loading">Working out what you can afford to lose…</p>
      {:else if releases.length === 0}
        <!-- With a target set the walk always prices something if it can, so
             an empty list means every animal is excluded or the sex floor
             holds — never that the genetics forbid it. Say which. -->
        <p class="msg" data-testid="free-slots-none">
          {#if plan && keptOut >= pets.length}
            Every stabled animal is starred, protected as your best, or has no genome to score, so nothing can be suggested.
          {:else if plan && plan.atFloor.length > 0}
            Releasing any more {heldSexes} would leave too few to breed the pairs these slots are for.
          {:else}
            Nothing can be released without dropping below the minimum stable the score needs.
          {/if}
        </p>
      {:else}
        <p class="verdict" data-testid="free-slots-verdict">
          {#if allFree}
            Releasing these {releases.length} costs <strong>nothing</strong> — every beneficial allele they carry
            is also held by an animal you keep.
          {:else if mode === 'clean'}
            Releasing these {releases.length} costs <strong>{fmt(plan?.totalCost ?? 0)}</strong> slot-units of
            breeding capability — more than the cheapest order, in exchange for the negatives they take.
          {:else}
            Releasing these {releases.length} costs <strong>{fmt(plan?.totalCost ?? 0)}</strong> slot-units of
            breeding capability, the cheapest order found.
          {/if}
          {#if (plan?.totalCleared ?? 0) > 0}
            They take <strong>{fmt(plan?.totalCleared ?? 0)}</strong> of negative alleles with them.
          {/if}
        </p>

        <!-- Numbered, because the order is load-bearing: each step's cost is
             measured against what remained, so releasing a subset out of
             sequence can cost more than the total shown. -->
        <ol class="release-list" data-testid="free-slots-list">
          {#each releases as r, i (r.pet.id)}
            <li class:costly={r.cost > 0}>
              <span class="step">{i + 1}</span>
              <span class="who">{r.pet.name || 'Unnamed'}</span>
              <span class="tags">
                {#if r.cost > 0}
                  <span class="tag cost" title="Breeding capability lost at this point in the order, in slot-units: 0.5 is the only carrier of a beneficial allele, 1 the only animal that breeds it true">
                    costs {fmt(r.cost)}
                  </span>
                {:else}
                  <span class="tag free" title="Every beneficial allele it carries is held by an animal you keep">free</span>
                {/if}
                {#if r.liabilityRemoved > 0}
                  <span class="tag good" title="Negative-allele capability that leaves with it, in the same slot-units: 0.5 is the only carrier of a negative, 1 the only animal that breeds it true">
                    clears {fmt(r.liabilityRemoved)}
                  </span>
                {/if}
              </span>
            </li>
          {/each}
        </ol>

        {#if plan}
          <p class="msg subtle" data-testid="free-slots-after">
            Left afterwards: {plan.after.males} {plan.after.males === 1 ? 'male' : 'males'}, {plan.after.females}
            {plan.after.females === 1 ? 'female' : 'females'} — up to {plan.after.pairs} {plan.after.pairs === 1 ? 'pair' : 'pairs'}.
            {#if plan.atFloor.length > 0}
              No more {heldSexes} are suggested, so the pairs stay possible.
            {/if}
          </p>
        {/if}

        {#if shortfall > 0}
          <p class="msg" data-testid="free-slots-shortfall">
            Only {releases.length} can be released.
            {#if plan && plan.atFloor.length > 0}
              Releasing more would leave too few {heldSexes} to breed the pairs these slots are for.
            {:else if plan && keptOut > 0}
              Starred, protected and unscored animals are excluded, which leaves too few to reach {target}.
            {:else}
              The rest of the stable is at the minimum needed to keep the score meaningful.
            {/if}
          </p>
        {/if}

        {#if plan?.next}
          <p class="msg subtle" data-testid="free-slots-next">
            One more would cost {fmt(plan.next.cost)} ({plan.next.pet.name || 'unnamed'}).
          </p>
        {/if}

        {#if plan && plan.protectedBest.length > 0}
          <p class="msg subtle" data-testid="free-slots-best">
            Kept as your best: {names(plan.protectedBest)}. The score only sees what an animal can pass on, not
            what it is.
          </p>
        {/if}

        {#if plan && plan.unscored.length > 0}
          <p class="msg subtle" data-testid="free-slots-unscored">
            Not scored, so never suggested: {names(plan.unscored)} — no genome has been imported for them.
          </p>
        {/if}

        {#if plan && plan.pinned.length > 0}
          <p class="msg subtle" data-testid="free-slots-pinned">
            Kept regardless: {names(plan.pinned)} — starred pets are never suggested.
          </p>
        {:else}
          <p class="msg subtle" data-testid="free-slots-nopins">
            Nothing is starred. Star the animal you ride and it will never be suggested here — the
            score only sees breeding value.
          </p>
        {/if}

        <p class="msg subtle" data-testid="free-slots-scope">
          Only alleles with an attribute effect are priced. Coat, marking and breed-selector genes are not,
          so a "free" release can still be the last of a look.
        </p>
      {/if}
    </div>

    <div class="dialog-footer">
      {#if releaseFailed}
        <span class="foot-note error" data-testid="free-slots-release-error">
          Release failed part way. The roster shows what did go through.
        </span>
      {:else}
        <span class="foot-note">Releasing un-stables them. Nothing is deleted.</span>
      {/if}
      <button type="button" class="btn ghost" onclick={onClose}>Cancel</button>
      <button
        type="button"
        class="btn primary"
        data-testid="free-slots-confirm"
        disabled={releases.length === 0 || releasing}
        onclick={release}
      >
        {releasing ? 'Releasing…' : `Release these ${releases.length}`}
      </button>
    </div>
  </div>
</div>

<style>
  .free-slots-dialog { max-width: 540px; }
  .slots-row { display: flex; align-items: center; gap: var(--space-sm); margin-bottom: var(--space-sm); }
  .slots-row label { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
  .slots-row input { width: 5ch; font: inherit; padding: var(--space-3xs) var(--space-xs); border: 1px solid var(--border-primary); border-radius: 6px; background: var(--bg-primary); color: var(--text-primary); }
  .slots-note { font-size: 12px; color: var(--text-muted); }
  .options-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-md); margin-bottom: var(--space-md); font-size: 12px; color: var(--text-secondary); }
  .options-row label { display: flex; align-items: center; gap: var(--space-xs); }
  .options-row select { font: inherit; font-size: 12px; padding: var(--space-3xs) var(--space-xs); border: 1px solid var(--border-primary); border-radius: 6px; background: var(--bg-primary); color: var(--text-primary); }
  .verdict { font-size: 13px; color: var(--text-secondary); margin-bottom: var(--space-md); }
  .msg { font-size: 13px; color: var(--text-tertiary); }
  .msg.subtle { font-size: 12px; color: var(--text-muted); margin-top: var(--space-sm); }
  .msg.error { color: var(--danger-text, var(--text-primary)); }
  .release-list { list-style: none; margin: 0; padding: 0; }
  .release-list li { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-xs) 0; border-bottom: 1px solid var(--bg-tertiary); }
  .release-list li:last-child { border-bottom: none; }
  /* The step number is not decoration: the order is what makes the total
     honest, so it reads as a sequence rather than a checklist. */
  .step { display: grid; place-items: center; width: 1.6em; height: 1.6em; border-radius: 50%; background: var(--bg-tertiary); color: var(--text-secondary); font-size: 11px; font-weight: 600; flex: none; }
  .who { flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tags { display: flex; gap: var(--space-xs); flex: none; }
  .tag { font-size: 11px; padding: 0 var(--space-xs); border-radius: 4px; background: var(--bg-tertiary); color: var(--text-muted); cursor: help; }
  .tag.free { color: var(--text-tertiary); }
  .tag.good { color: var(--success-text, var(--text-secondary)); }
  .tag.cost { color: var(--warning-text, var(--text-primary)); font-weight: 600; }
  .foot-note { flex: 1; font-size: 11px; color: var(--text-muted); }
  .foot-note.error { color: var(--danger-text, var(--text-primary)); font-weight: 600; }
</style>
