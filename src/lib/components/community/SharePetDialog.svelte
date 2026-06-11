<script>
import StatusBanner from '$lib/components/shared/StatusBanner.svelte';
import { isPlaceholderConfig } from '$lib/firebase.js';
import { getPetGenomeText } from '$lib/services/petService.js';
import { sanitizeTags, uploadPet } from '$lib/services/shareService.js';
import { errorMessage } from '$lib/utils/error.js';
import { focusTrap } from '$lib/utils/focusTrap.js';
import { keyedResource } from '$lib/utils/keyedResource.svelte.js';

const { pet, onClose, onResult } = $props();

let includeNotes = $state(false);
let sharing = $state(false);
let shareError = $state('');

// The list path (`getAllPets`) omits `genome_text` for payload size
// (issue #254), so `selectedPet` — and therefore the `pet` prop here —
// usually lacks it. When it's already present (e.g. a full-row fetch
// path), use it directly and skip the lazy load; otherwise lazy-load by
// id through the shared keyed resource, which handles the loading flag,
// rejects a stale result if the dialog is re-pointed at another pet, and
// surfaces a real fetch error (vs. a legacy empty row) distinctly.
// `value` is the raw text ('' for legacy v13 rows, null for a missing id).
const propHasGenome = $derived(typeof pet?.genome_text === 'string');
const genome = keyedResource(
  () => (propHasGenome ? undefined : pet?.id),
  (id) => getPetGenomeText(id),
);
// Single source of truth for the raw text: prefer the prop, fall back to
// the lazily-loaded value.
const genomeText = $derived(propHasGenome ? pet.genome_text : genome.value);

const previewTags = $derived(sanitizeTags(pet?.tags ?? []));
const hasNotes = $derived(typeof pet?.notes === 'string' && pet.notes.trim().length > 0);
const genomeLoading = $derived(!propHasGenome && genome.loading);
const genomeError = $derived(!propHasGenome && genome.error ? errorMessage(genome.error) : '');
// Legacy pets imported before migration v13 don't have the raw genome
// text on file, so we can't recompute the hash-matching upload payload
// for them. They can be shared after the user re-imports the file.
const hasRawGenome = $derived(typeof genomeText === 'string' && genomeText.length > 0);

async function handleShare() {
  // Belt-and-suspenders: the Share button is already disabled while the
  // config is a placeholder, the genome text is loading or errored, or the
  // pet lacks raw genome text (`hasRawGenome` is false in all those cases),
  // so this should never fire. The early return guards programmatic re-entry.
  if (isPlaceholderConfig || genomeLoading || !hasRawGenome) return;
  sharing = true;
  shareError = '';
  try {
    // Rebuild the upload payload: strip notes unless opted in, and attach the
    // lazily-loaded raw text (the list-path `pet` doesn't carry it). uploadPet
    // re-hashes genome_text against content_hash.
    const petToShare = { ...pet, notes: includeNotes ? pet.notes : '', genome_text: genomeText };
    const result = await uploadPet(petToShare);
    if (result.status === 'already-shared') {
      onResult({
        type: 'info',
        message: `"${pet.name}" was already in the community catalogue — nothing to do.`,
      });
    } else {
      onResult({ type: 'success', message: `Shared "${pet.name}" to the community.` });
    }
    onClose();
  } catch (err) {
    shareError = errorMessage(err);
  } finally {
    sharing = false;
  }
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
  data-testid="share-pet-backdrop"
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="dialog share-pet-dialog"
    role="dialog"
    aria-label="Share Pet to Community"
    aria-modal="true"
    tabindex="-1"
    use:focusTrap
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => {
      if (e.key === 'Escape') onClose();
    }}
  >
    <div class="dialog-header">
      <h3>Share "{pet?.name ?? 'Pet'}" to the community</h3>
      <button class="close-btn" onclick={onClose}>×</button>
    </div>

    <div class="dialog-body">
      {#if isPlaceholderConfig}
        <div class="banner banner-warn" data-testid="share-not-configured">
          The community catalogue isn't configured for this build of Gorgonetics yet, so
          uploads are disabled. See <code>docs/firebase-setup.md</code> for how to wire up a
          Firebase project, or wait for a release with sharing enabled.
        </div>
      {:else if genomeLoading}
        <div class="banner" data-testid="share-genome-loading">Loading genome…</div>
      {:else if genomeError}
        <div class="banner banner-warn" data-testid="share-genome-error">
          Couldn't read this pet's genome from the local database: {genomeError}. Close
          and reopen this dialog to try again.
        </div>
      {:else if !hasRawGenome}
        <div class="banner banner-warn" data-testid="share-no-raw-genome">
          This pet was imported with an older app version that didn't store the raw
          genome text needed for sharing. Re-import the same
          <code>Genes_*.txt</code> file from your game folder — the import path will
          recognise the existing pet and backfill the missing text without creating a
          duplicate.
        </div>
      {/if}

      <p class="dialog-desc">
        This pet's genome and the fields below will be uploaded to the public catalogue.
        Other players will be able to import it into their local stable.
        Uploads cannot be edited or deleted from within the app.
      </p>

      <dl class="preview-grid" data-testid="share-preview">
        <dt>Name</dt>
        <dd>{pet?.name ?? ''}</dd>

        <dt>Character</dt>
        <dd class="muted">{pet?.breeder || '(unknown)'}</dd>

        <dt>Species</dt>
        <dd>{pet?.species ?? ''}</dd>

        <dt>Gender</dt>
        <dd>{pet?.gender ?? ''}</dd>

        {#if pet?.breed}
          <dt>Breed</dt>
          <dd>{pet.breed}</dd>
        {/if}

        <dt>Tags</dt>
        <dd>
          {#if previewTags.length === 0}
            <span class="muted">none</span>
          {:else}
            {#each previewTags as t (t)}
              <span class="tag-badge">{t}</span>
            {/each}
          {/if}
        </dd>
      </dl>

      <label class="checkbox-row" class:disabled={!hasNotes}>
        <input type="checkbox" bind:checked={includeNotes} disabled={!hasNotes} />
        <div class="checkbox-info">
          <span class="checkbox-label">Include local notes</span>
          <span class="checkbox-desc">
            {#if !hasNotes}
              No notes on this pet to share.
            {:else if includeNotes}
              The notes field below will be uploaded as-is.
            {:else}
              Notes stay local. Tick this box only if you've reviewed them and want them
              public.
            {/if}
          </span>
        </div>
      </label>

      {#if hasNotes && includeNotes}
        <pre class="notes-preview" data-testid="share-notes-preview">{pet.notes}</pre>
      {/if}

      {#if shareError}
        <div data-testid="share-error">
          <StatusBanner type="error" message={shareError} />
        </div>
      {/if}
    </div>

    <div class="dialog-footer">
      <button class="btn btn-secondary" onclick={onClose} disabled={sharing}>Cancel</button>
      <button
        class="btn btn-primary"
        data-testid="share-confirm"
        onclick={handleShare}
        disabled={sharing || isPlaceholderConfig || genomeLoading || !hasRawGenome}
      >
        {sharing ? 'Sharing…' : genomeLoading ? 'Loading…' : 'Share to community'}
      </button>
    </div>
  </div>
</div>

<style>
  .share-pet-dialog {
    max-width: 480px;
  }

  .dialog-desc {
    font-size: 14px;
    color: var(--text-tertiary);
    margin: 0 0 12px;
  }

  .preview-grid {
    display: grid;
    grid-template-columns: 100px 1fr;
    gap: 6px 12px;
    margin: 0 0 16px;
    font-size: 14px;
  }

  .preview-grid dt {
    color: var(--text-tertiary);
    font-weight: 500;
  }

  .preview-grid dd {
    margin: 0;
    color: var(--text-primary);
    word-break: break-word;
  }

  .muted {
    color: var(--text-tertiary);
    font-style: italic;
  }

  .checkbox-row.disabled {
    opacity: 0.55;
  }

  .notes-preview {
    margin: 0 0 12px;
    padding: 8px 10px;
    max-height: 160px;
    overflow: auto;
    background: var(--surface-2, #1f1f1f);
    border-radius: 4px;
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-word;
  }

</style>
