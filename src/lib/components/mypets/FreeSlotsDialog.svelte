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
 * Releasing here means un-stabling, not deleting: the pet and its genome stay
 * in the library, it simply leaves the breeding pool. That is the reversible
 * reading of "make room", and it is what the copy promises.
 */
import { type SafeCullSet, safeCullSet } from '$lib/services/geneticQualityService.js';
import type { Pet } from '$lib/types/index.js';
import { focusTrap } from '$lib/utils/focusTrap.js';

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
let plan = $state<SafeCullSet | null>(null);
let loading = $state(true);
let failed = $state(false);
let releasing = $state(false);

// Recompute whenever the target changes. The walk re-scores after every
// removal, so a different target is a different answer, not a prefix of one.
$effect(() => {
  const want = slots;
  const ids = pets.map((p) => p.id).join(',');
  let live = true;
  loading = true;
  failed = false;
  safeCullSet({ species, pets, slots: want })
    .then((r) => {
      if (live) plan = r;
    })
    .catch(() => {
      if (live) failed = true;
    })
    .finally(() => {
      if (live) loading = false;
    });
  // `ids` is read so the effect re-runs when the population changes.
  void ids;
  return () => {
    live = false;
  };
});

const releases = $derived(plan?.releases ?? []);
const shortfall = $derived(Math.max(0, slots - releases.length));
const fmt = (n: number) => (n === 0 ? '0' : n.toFixed(1));

async function release() {
  if (releases.length === 0 || releasing) return;
  releasing = true;
  try {
    await onRelease(releases.map((r) => r.pet.id));
    onClose();
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
          max={Math.max(1, pets.length)}
          bind:value={slots}
          data-testid="free-slots-count"
        />
        <span class="slots-note">from {pets.length} stabled</span>
      </div>

      {#if failed}
        <p class="msg error" data-testid="free-slots-error">
          Couldn't work out a release order. Close and try again.
        </p>
      {:else if loading}
        <p class="msg" data-testid="free-slots-loading">Working out what you can afford to lose…</p>
      {:else if releases.length === 0}
        <p class="msg" data-testid="free-slots-none">
          Nothing can be released without losing breeding capability — every stabled animal holds
          something no other one does.
        </p>
      {:else}
        <p class="verdict" data-testid="free-slots-verdict">
          {#if plan?.allFree}
            Releasing these {releases.length} costs you <strong>nothing</strong> — everything they
            carry is available from an animal you keep.
          {:else}
            Releasing these {releases.length} costs <strong>{fmt(plan?.totalCost ?? 0)}</strong> of
            breeding capability. There is no cheaper set this size.
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
                  <span class="tag cost" title="Breeding capability lost at this point in the order">
                    costs {fmt(r.cost)}
                  </span>
                {:else}
                  <span class="tag free">free</span>
                {/if}
                {#if r.liabilityRemoved > 0}
                  <span class="tag good" title="Negative alleles that leave with this animal">
                    clears {fmt(r.liabilityRemoved)}
                  </span>
                {/if}
              </span>
            </li>
          {/each}
        </ol>

        {#if shortfall > 0}
          <p class="msg" data-testid="free-slots-shortfall">
            Only {releases.length} can be released — the rest of the stable is at the minimum needed
            to keep the score meaningful.
          </p>
        {/if}

        {#if plan?.next}
          <p class="msg subtle" data-testid="free-slots-next">
            One more would cost {fmt(plan.next.cost)} ({plan.next.pet.name || 'unnamed'}).
          </p>
        {/if}

        {#if plan && plan.pinned.length > 0}
          <p class="msg subtle" data-testid="free-slots-pinned">
            Kept regardless: {plan.pinned.map((p) => p.name || 'unnamed').join(', ')} — starred pets
            are never suggested.
          </p>
        {:else}
          <p class="msg subtle" data-testid="free-slots-nopins">
            Nothing is starred. Star the animal you ride and it will never be suggested here — the
            score only sees breeding value.
          </p>
        {/if}
      {/if}
    </div>

    <div class="dialog-footer">
      <span class="foot-note">Releasing un-stables them. Nothing is deleted.</span>
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
  .free-slots-dialog { max-width: 520px; }
  .slots-row { display: flex; align-items: center; gap: var(--space-sm); margin-bottom: var(--space-md); }
  .slots-row label { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
  .slots-row input { width: 5ch; font: inherit; padding: var(--space-3xs) var(--space-xs); border: 1px solid var(--border-primary); border-radius: 6px; background: var(--bg-primary); color: var(--text-primary); }
  .slots-note { font-size: 12px; color: var(--text-muted); }
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
  .tag { font-size: 11px; padding: 0 var(--space-xs); border-radius: 4px; background: var(--bg-tertiary); color: var(--text-muted); }
  .tag.free { color: var(--text-tertiary); }
  .tag.good { color: var(--success-text, var(--text-secondary)); }
  .tag.cost { color: var(--warning-text, var(--text-primary)); font-weight: 600; }
  .foot-note { flex: 1; font-size: 11px; color: var(--text-muted); }
</style>
