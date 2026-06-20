<script lang="ts">
import StatusBanner from '$lib/components/shared/StatusBanner.svelte';
import { isPlaceholderConfig } from '$lib/firebase.js';
import { type BulkUploadSummary, uploadPets } from '$lib/services/shareService.js';
import type { DialogResult, Pet } from '$lib/types/index.js';
import { errorMessage } from '$lib/utils/error.js';
import { focusTrap } from '$lib/utils/focusTrap.js';

interface Props {
  pets: Pet[];
  onClose: () => void;
  onResult: (result: DialogResult) => void;
}

const { pets, onClose, onResult }: Props = $props();

type Phase = 'confirm' | 'running' | 'done';
let phase = $state<Phase>('confirm');
let done = $state(0);
let summary = $state<BulkUploadSummary | null>(null);
let runError = $state('');
let cancelRequested = $state(false);

const total = $derived(pets.length);
const percent = $derived(total > 0 ? Math.round((done / total) * 100) : 0);

// Pets whose problems (skipped/failed) are worth listing back to the user.
const problems = $derived((summary?.items ?? []).filter((i) => i.status === 'skipped' || i.status === 'failed'));

async function handleShare() {
  if (isPlaceholderConfig || phase === 'running') return;
  phase = 'running';
  done = 0;
  runError = '';
  cancelRequested = false;
  try {
    // Notes are intentionally excluded from bulk shares: there's no per-pet
    // review step, so we never publish the local notes field. Per-pet sharing
    // remains the way to opt notes in.
    const petsToShare = pets.map((p) => ({ ...p, notes: '' }));
    summary = await uploadPets(petsToShare, {
      onProgress: (d) => {
        done = d;
      },
      shouldCancel: () => cancelRequested,
    });
    phase = 'done';
  } catch (err) {
    // uploadPets captures per-pet errors itself; reaching here means a
    // batch-wide failure (e.g. the genome loader threw unexpectedly).
    runError = errorMessage(err);
    phase = 'done';
  }
}

function finish() {
  if (summary) {
    const { created, alreadyShared, skipped, failed } = summary;
    const parts = [`${created} shared`];
    if (alreadyShared) parts.push(`${alreadyShared} already in catalogue`);
    if (skipped) parts.push(`${skipped} skipped`);
    if (failed) parts.push(`${failed} failed`);
    const msg = `Bulk share complete — ${parts.join(', ')}.`;
    onResult({ type: failed > 0 ? 'error' : created > 0 ? 'success' : 'info', message: msg });
  }
  onClose();
}

function handleClose() {
  // Don't let a backdrop/Escape close abandon an in-flight run silently.
  if (phase === 'running') {
    cancelRequested = true;
    return;
  }
  if (phase === 'done') finish();
  else onClose();
}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div
  class="modal-backdrop"
  onclick={handleClose}
  onkeydown={(e) => {
    if (e.key === 'Escape') handleClose();
  }}
  role="presentation"
  data-testid="bulk-share-backdrop"
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="dialog bulk-share-dialog"
    role="dialog"
    aria-label="Share pets to community"
    aria-modal="true"
    tabindex="-1"
    use:focusTrap
    data-testid="bulk-share-dialog"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => {
      if (e.key === 'Escape') handleClose();
    }}
  >
    <div class="dialog-header">
      <h3>Share {total} {total === 1 ? 'pet' : 'pets'} to the community</h3>
      <button class="close-btn" onclick={handleClose}>×</button>
    </div>

    <div class="dialog-body">
      {#if isPlaceholderConfig}
        <div class="banner banner-warn" data-testid="bulk-share-not-configured">
          The community catalogue isn't configured for this build of Gorgonetics yet, so
          uploads are disabled. See <code>docs/firebase-setup.md</code>.
        </div>
      {/if}

      {#if phase === 'confirm'}
        <p class="dialog-desc">
          The genome and public fields (name, character, species, gender, breed, tags) of
          each selected pet will be uploaded to the public catalogue, where other players
          can import them. Uploads cannot be edited or deleted from within the app.
        </p>
        <ul class="confirm-notes">
          <li><strong>Notes stay local</strong> — bulk share never uploads the notes field.</li>
          <li>Pets already in the catalogue are detected and skipped automatically.</li>
          <li>Pets imported before genome-text was stored will be skipped (re-import to share).</li>
        </ul>
      {:else if phase === 'running'}
        <p class="dialog-desc">Sharing pets… you can cancel; pets already uploaded stay shared.</p>
        <div
          class="progress"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax={total}
          aria-valuenow={done}
          data-testid="bulk-share-progress"
        >
          <div class="progress-fill" style="width: {percent}%"></div>
        </div>
        <p class="progress-label">{done} / {total}{cancelRequested ? ' (finishing current…)' : ''}</p>
      {:else if phase === 'done'}
        {#if runError}
          <StatusBanner type="error" message={runError} />
        {/if}
        {#if summary}
          <div class="summary" data-testid="bulk-share-summary">
            <div class="summary-row"><span class="pill pill-ok">{summary.created}</span> shared</div>
            {#if summary.alreadyShared > 0}
              <div class="summary-row"><span class="pill">{summary.alreadyShared}</span> already in catalogue</div>
            {/if}
            {#if summary.skipped > 0}
              <div class="summary-row"><span class="pill pill-warn">{summary.skipped}</span> skipped</div>
            {/if}
            {#if summary.failed > 0}
              <div class="summary-row"><span class="pill pill-err">{summary.failed}</span> failed</div>
            {/if}
          </div>
          {#if problems.length > 0}
            <details class="problems">
              <summary>Details ({problems.length})</summary>
              <ul>
                {#each problems as p (p.petId)}
                  <li><strong>{p.petName}</strong> — {p.status}: {p.error}</li>
                {/each}
              </ul>
            </details>
          {/if}
        {/if}
      {/if}
    </div>

    <div class="dialog-footer">
      {#if phase === 'confirm'}
        <button class="btn btn-secondary" onclick={onClose}>Cancel</button>
        <button
          class="btn btn-primary"
          data-testid="bulk-share-confirm"
          onclick={handleShare}
          disabled={isPlaceholderConfig || total === 0}
        >
          Share {total} {total === 1 ? 'pet' : 'pets'}
        </button>
      {:else if phase === 'running'}
        <button class="btn btn-secondary" data-testid="bulk-share-cancel" onclick={() => { cancelRequested = true; }} disabled={cancelRequested}>
          {cancelRequested ? 'Cancelling…' : 'Cancel'}
        </button>
      {:else}
        <button class="btn btn-primary" data-testid="bulk-share-done" onclick={finish}>Done</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .bulk-share-dialog {
    max-width: 480px;
  }

  .dialog-desc {
    font-size: 14px;
    color: var(--text-tertiary);
    margin: 0 0 12px;
  }

  .confirm-notes {
    margin: 0 0 8px;
    padding-left: 18px;
    font-size: 13px;
    color: var(--text-secondary);
  }
  .confirm-notes li {
    margin-bottom: 4px;
  }

  .progress {
    height: 10px;
    background: var(--bg-tertiary);
    border-radius: 6px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.2s ease;
  }
  .progress-label {
    margin: 8px 0 0;
    font-size: 13px;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .summary {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 14px;
    margin-bottom: 12px;
  }
  .summary-row {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-secondary);
  }
  .pill {
    display: inline-flex;
    min-width: 22px;
    justify-content: center;
    padding: 1px 8px;
    border-radius: 10px;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .pill-ok {
    background: color-mix(in srgb, var(--gene-positive) 20%, transparent);
    color: var(--gene-positive);
  }
  .pill-warn {
    background: color-mix(in srgb, var(--warning-text, #d97706) 20%, transparent);
    color: var(--warning-text, #d97706);
  }
  .pill-err {
    background: color-mix(in srgb, var(--gene-negative) 20%, transparent);
    color: var(--gene-negative);
  }

  .problems {
    font-size: 13px;
    color: var(--text-secondary);
  }
  .problems summary {
    cursor: pointer;
    color: var(--text-tertiary);
  }
  .problems ul {
    margin: 8px 0 0;
    padding-left: 18px;
    max-height: 180px;
    overflow: auto;
  }
  .problems li {
    margin-bottom: 4px;
    word-break: break-word;
  }
</style>
