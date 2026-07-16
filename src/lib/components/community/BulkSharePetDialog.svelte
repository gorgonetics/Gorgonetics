<script lang="ts">
/**
 * Confirm gate for sharing a multi-selection of pets to the community.
 *
 * This dialog only *confirms* — the actual upload runs as a background job
 * (`startBulkShare`), so the app stays interactive and progress surfaces in the
 * global, non-blocking BulkShareProgress widget. On confirm it hands the pets to
 * the parent and closes; it never blocks on the network itself.
 */
import { isPlaceholderConfig } from '$lib/firebase.js';
import type { Pet } from '$lib/types/index.js';
import { focusTrap } from '$lib/utils/focusTrap.js';

interface Props {
  pets: Pet[];
  onClose: () => void;
  /** Called when the user confirms; the parent starts the background job. */
  onConfirm: (pets: Pet[]) => void;
}

const { pets, onClose, onConfirm }: Props = $props();

const total = $derived(pets.length);

function handleConfirm() {
  if (isPlaceholderConfig || total === 0) return;
  onConfirm(pets);
}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div
  class="modal-backdrop"
  onclick={onClose}
  onkeydown={(e) => {
    if (e.key === 'Escape') onClose();
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
      if (e.key === 'Escape') onClose();
    }}
  >
    <div class="dialog-header">
      <h3>Share {total} {total === 1 ? 'pet' : 'pets'} to the community</h3>
      <button class="close-btn" onclick={onClose}>×</button>
    </div>

    <div class="dialog-body">
      {#if isPlaceholderConfig}
        <div class="banner banner-warn" data-testid="bulk-share-not-configured">
          The community catalogue isn't configured for this build of Gorgonetics yet, so
          uploads are disabled. See <code>docs/firebase-setup.md</code>.
        </div>
      {/if}

      <p class="dialog-desc">
        The genome and public fields (name, character, species, gender, breed, tags) of
        each selected pet will be uploaded to the public catalogue, where other players
        can import them. Uploads cannot be edited or deleted from within the app.
      </p>
      <ul class="confirm-notes">
        <li><strong>Notes stay local</strong> — bulk share never uploads the notes field.</li>
        <li>Pets already in the catalogue are detected and skipped automatically.</li>
        <li>Pets imported before genome-text was stored will be skipped (re-import to share).</li>
        <li>Sharing runs in the background — you can keep using the app and cancel any time.</li>
      </ul>
    </div>

    <div class="dialog-footer">
      <button class="btn btn-secondary" onclick={onClose}>Cancel</button>
      <button
        class="btn btn-primary"
        data-testid="bulk-share-confirm"
        onclick={handleConfirm}
        disabled={isPlaceholderConfig || total === 0}
      >
        Share {total} {total === 1 ? 'pet' : 'pets'}
      </button>
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
</style>
