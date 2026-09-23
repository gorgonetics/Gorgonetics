<script lang="ts">
/**
 * Fill attributes from names — the catch-up for pets whose structured name
 * was never read (renamed after import, or imported before their species
 * had a rule). See `utils/nameAttributes.ts` for why the two groups differ:
 * unmeasured pets are filled in one step, disagreements are shown one by one
 * and change only on an explicit per-pet choice.
 */
import { appState, pets } from '$lib/stores/pets.js';
import { settings, settingsActions } from '$lib/stores/settings.js';
import { focusTrap } from '$lib/utils/focusTrap.js';
import { type KeptStoredValues, type NameBackfillPlan, planNameBackfill } from '$lib/utils/nameAttributes.js';
import { capitalize } from '$lib/utils/string.js';

interface Props {
  onClose: () => void;
}

const { onClose }: Props = $props();

const KEPT_KEY = 'names.keptStoredValues';
const kept = $derived(($settings[KEPT_KEY] ?? {}) as KeptStoredValues);

// Re-planned from the live list, so each write drops its pet out of the plan.
const plan: NameBackfillPlan = $derived(planNameBackfill($pets, kept));

/** Settle a disagreement for the stored values, until the pet is renamed. */
async function keepStored(petId: number, name: string): Promise<void> {
  await settingsActions.update(KEPT_KEY, { ...kept, [String(petId)]: name });
}

let busy = $state(false);
let error = $state('');
let filledCount = $state(0);

async function run(entries: NameBackfillPlan['fill']): Promise<void> {
  if (busy || entries.length === 0) return;
  busy = true;
  error = '';
  try {
    await appState.updatePets(entries.map(({ pet, updates }) => ({ petId: pet.id, data: { ...updates } })));
    filledCount += entries.length;
  } catch (err) {
    error = (err as Error).message || 'Some pets could not be updated.';
  } finally {
    busy = false;
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
    class="dialog name-backfill-dialog"
    role="dialog"
    aria-label="Fill attributes from names"
    aria-modal="true"
    tabindex="-1"
    use:focusTrap
    data-testid="name-backfill-dialog"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => {
      if (e.key === 'Escape') onClose();
    }}
  >
    <div class="dialog-header">
      <h3>Fill attributes from names</h3>
      <button type="button" class="close-btn" aria-label="Close" onclick={onClose}>✕</button>
    </div>

    <div class="dialog-body">
      {#if error}
        <p class="nb-error" role="alert">{error}</p>
      {/if}

      <section class="nb-section">
        {#if plan.fill.length > 0}
          <p data-testid="name-backfill-fill-count">
            {plan.fill.length} {plan.fill.length === 1 ? 'pet has' : 'pets have'} no recorded attributes, but a name that
            carries them.
          </p>
          <ul class="nb-names">
            {#each plan.fill as { pet } (pet.id)}
              <li>{pet.name}</li>
            {/each}
          </ul>
        {:else}
          <p class="nb-muted" data-testid="name-backfill-fill-none">
            {filledCount > 0
              ? `Filled ${filledCount} ${filledCount === 1 ? 'pet' : 'pets'}.`
              : 'No pet with unrecorded attributes has a structured name.'}
          </p>
        {/if}
      </section>

      {#if plan.conflicts.length > 0}
        <section class="nb-section" data-testid="name-backfill-conflicts">
          <h4>Stored values disagree with the name</h4>
          <p class="nb-muted">
            These pets already have recorded attributes. Either the values or the name may be out of date, so nothing
            changes unless you choose it.
          </p>
          <ul class="nb-conflicts">
            {#each plan.conflicts as entry (entry.pet.id)}
              <li class="nb-conflict" data-testid="name-backfill-conflict">
                <div class="nb-conflict-head">
                  <span class="nb-conflict-name">{entry.pet.name}</span>
                  <span class="nb-actions">
                    <button
                      type="button"
                      class="btn btn-secondary nb-use"
                      disabled={busy}
                      data-testid="name-backfill-keep"
                      onclick={() => keepStored(entry.pet.id, entry.pet.name)}
                    >Keep stored</button>
                    <button
                      type="button"
                      class="btn btn-secondary nb-use"
                      disabled={busy}
                      onclick={() => run([entry])}
                    >Use name values</button>
                  </span>
                </div>
                <span class="nb-diffs">
                  {#each entry.differences as d (d.attribute)}
                    <span class="nb-diff">{capitalize(d.attribute)} {d.stored ?? '—'} → {d.fromName}</span>
                  {/each}
                  {#each entry.fieldChanges as c (c.field)}
                    <span class="nb-diff nb-field">{capitalize(c.field)} {c.stored || 'not set'} → {c.fromName}</span>
                  {/each}
                </span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    </div>

    <div class="dialog-footer">
      <button type="button" class="btn btn-secondary" onclick={onClose}>Close</button>
      <button
        type="button"
        class="btn btn-primary"
        data-testid="name-backfill-fill"
        disabled={busy || plan.fill.length === 0}
        onclick={() => run(plan.fill)}
      >
        {busy ? 'Filling…' : `Fill ${plan.fill.length} ${plan.fill.length === 1 ? 'pet' : 'pets'}`}
      </button>
    </div>
  </div>
</div>

<style>
  .name-backfill-dialog {
    max-width: 560px;
  }

  .nb-section + .nb-section {
    margin-top: var(--space-xl);
    padding-top: var(--space-lg);
    border-top: 1px solid var(--border-primary);
  }

  .nb-section p {
    margin: 0 0 var(--space-sm);
    font-size: 13px;
    color: var(--text-secondary);
  }

  .nb-section h4 {
    margin: 0 0 var(--space-xs);
    font-size: 13px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .nb-muted {
    color: var(--text-tertiary) !important;
  }

  .nb-error {
    color: var(--error-text) !important;
  }

  .nb-names {
    margin: 0;
    padding-left: var(--space-xl);
    max-height: 160px;
    overflow-y: auto;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .nb-conflicts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .nb-conflict {
    display: flex;
    flex-direction: column;
    gap: var(--space-2xs);
    padding: var(--space-sm);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-md);
  }

  .nb-conflict-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
  }

  .nb-conflict-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }

  .nb-actions {
    display: inline-flex;
    gap: var(--space-xs);
    flex-shrink: 0;
  }

  .nb-field {
    color: var(--text-secondary);
    font-weight: 600;
  }

  .nb-use {
    flex-shrink: 0;
    font-size: 12px;
    padding: var(--space-3xs) var(--space-sm);
  }

  .nb-diffs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2xs) var(--space-md);
    font-size: 12px;
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
  }
</style>
