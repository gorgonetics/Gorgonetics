<script>
import StatusBanner from '$lib/components/shared/StatusBanner.svelte';
import { getSharedPet } from '$lib/services/shareService.js';
import { clearSelection, communityView, importSelected, selectedSharedPet } from '$lib/stores/community.svelte.js';
import { errorMessage } from '$lib/utils/error.js';
import { formatShortDate } from '$lib/utils/timestamp.js';

const pet = $derived(selectedSharedPet());
const isImporting = $derived(communityView.importingHash === pet?.contentHash);

// The list view holds metadata-only SharedPets (no `genomeData`); the
// detail pane fetches the genome on demand. Tracked locally so the store
// doesn't need a parallel "full pet" cache layer.
let fullPet = $state(null);
let genomeLoading = $state(false);
let genomeError = $state(null);
let importStatus = $state(null);

// Non-reactive guard against duplicate fetches. We can't read `fullPet`
// inside the effect (assigning to it during the effect body would
// retrigger the effect before the in-flight `getSharedPet` resolves,
// firing a second fetch for the same hash), so we track the in-flight
// hash separately as a plain variable.
let loadedHash = '';

$effect(() => {
  const hash = pet?.contentHash;
  // Reset transient state whenever the selection changes — stale
  // "Imported …" banners would otherwise follow the user across rows.
  importStatus = null;
  genomeError = null;
  if (!hash) {
    fullPet = null;
    genomeLoading = false;
    loadedHash = '';
    return;
  }
  if (loadedHash === hash) return;

  loadedHash = hash;
  fullPet = null;
  genomeLoading = true;
  getSharedPet(hash)
    .then((p) => {
      // The user might have moved on while the fetch was in flight; only
      // accept the result if it still matches the current selection.
      if (loadedHash !== hash) return;
      if (!p?.genomeData) {
        genomeError = 'Genome data is missing for this pet — it may have been taken down.';
        return;
      }
      fullPet = p;
    })
    .catch((err) => {
      if (loadedHash !== hash) return;
      genomeError = errorMessage(err);
    })
    .finally(() => {
      if (loadedHash === hash) genomeLoading = false;
    });
});

async function handleImport() {
  if (!fullPet) return;
  // Capture the hash at click time — if the user selects another row
  // while the import is in flight, we don't want the result to land on
  // the new selection's detail pane.
  const importingHash = fullPet.contentHash;
  importStatus = null;
  const result = await importSelected(fullPet);
  if (pet?.contentHash === importingHash) {
    importStatus = result;
  }
}
</script>

{#if pet}
  <section class="detail" data-testid="community-detail">
    <header class="detail-header">
      <div>
        <h3 class="detail-name">{pet.name || '(unnamed)'}</h3>
        <p class="detail-meta">
          <span>{pet.species}</span>
          <span class="dot">·</span>
          <span>{pet.gender}</span>
          {#if pet.breed}
            <span class="dot">·</span>
            <span>{pet.breed}</span>
          {/if}
        </p>
      </div>
      <button class="close-btn" onclick={clearSelection} aria-label="Close detail">×</button>
    </header>

    <div class="detail-body">
      <dl class="meta-grid">
        <dt>Character</dt>
        <dd>{pet.character || '—'}</dd>

        <dt>Breeder</dt>
        <dd>{pet.breeder || '—'}</dd>

        <dt>Uploaded</dt>
        <dd>{formatShortDate(pet.uploadedAt)}</dd>

        <dt>Schema</dt>
        <dd>v{pet.schemaVersion} · app {pet.appVersion}</dd>

        <dt>Tags</dt>
        <dd>
          {#if pet.tags.length === 0}
            <span class="muted">none</span>
          {:else}
            {#each pet.tags as t (t)}
              <span class="tag-badge">{t}</span>
            {/each}
          {/if}
        </dd>
      </dl>

      {#if pet.notes}
        <div class="notes-block">
          <span class="block-label">Notes from the uploader</span>
          <pre class="notes">{pet.notes}</pre>
        </div>
      {/if}

      <div class="genome-block">
        <span class="block-label">Genome preview</span>
        {#if genomeLoading}
          <p class="muted" data-testid="community-genome-loading">Loading genome…</p>
        {:else if genomeError}
          <StatusBanner type="error" message={genomeError} />
        {:else if fullPet?.genomeData}
          <pre class="genome">{fullPet.genomeData}</pre>
        {/if}
      </div>

      {#if importStatus}
        <StatusBanner type={importStatus.status} message={importStatus.message} />
      {/if}
    </div>

    <footer class="detail-footer">
      <button
        class="btn btn-primary import-btn"
        data-testid="community-import"
        onclick={handleImport}
        disabled={isImporting || !fullPet}
        title={fullPet ? 'Import to my stable' : 'Waiting for genome to load…'}
      >
        {isImporting ? 'Importing…' : 'Import to my stable'}
      </button>
    </footer>
  </section>
{/if}

<style>
  .detail {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .detail-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-primary);
    flex-shrink: 0;
  }
  .detail-name {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: var(--text-primary);
  }
  .detail-meta {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--text-tertiary);
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .dot {
    color: var(--text-tertiary);
  }
  .detail-body {
    flex: 1;
    overflow: auto;
    padding: 12px 16px;
    min-height: 0;
  }
  .meta-grid {
    display: grid;
    grid-template-columns: 84px 1fr;
    gap: 6px 12px;
    margin: 0 0 16px;
    font-size: 13px;
  }
  .meta-grid dt {
    color: var(--text-tertiary);
    font-weight: 500;
  }
  .meta-grid dd {
    margin: 0;
    color: var(--text-primary);
    word-break: break-word;
  }
  .muted {
    color: var(--text-tertiary);
    font-style: italic;
  }
  .block-label {
    display: block;
    font-size: 11px;
    text-transform: uppercase;
    color: var(--text-tertiary);
    margin-bottom: 4px;
  }
  .notes-block,
  .genome-block {
    margin-top: 12px;
  }
  .notes,
  .genome {
    margin: 0;
    padding: 8px 10px;
    background: var(--bg-secondary);
    border-radius: 4px;
    font-size: 11px;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 220px;
    overflow: auto;
  }
  .detail-footer {
    padding: 12px 16px;
    border-top: 1px solid var(--border-primary);
    display: flex;
    justify-content: flex-end;
    flex-shrink: 0;
  }
  .import-btn {
    min-width: 160px;
  }
</style>
