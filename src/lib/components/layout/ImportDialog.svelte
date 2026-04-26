<script>
import { importDatabase } from '$lib/services/backupService.js';
import { appState } from '$lib/stores/pets.js';
import { focusTrap } from '$lib/utils/focusTrap.js';

const { backup, onClose, onResult } = $props();
const metadata = $derived(backup?.metadata ?? null);

/** @type {'replace' | 'merge'} */
let mode = $state('replace');
let includeGenes = $state(true);
let includePets = $state(true);
let includeImages = $state(true);
let importing = $state(false);

const hasGenes = $derived(metadata?.contents?.genes ?? true);
const hasPets = $derived(metadata?.contents?.pets ?? true);
const hasImages = $derived(metadata?.contents?.images ?? false);
const isV1 = $derived((metadata?.format_version ?? 1) < 2);

async function handleImport() {
  importing = true;
  try {
    const result = await importDatabase(backup, {
      mode,
      includeGenes: includeGenes && hasGenes,
      includePets: includePets && hasPets,
      includeImages: includeImages && hasImages,
    });

    let parts = [];
    if (result.genes > 0) parts.push(`${result.genes} genes`);
    if (result.pets > 0) parts.push(`${result.pets} pets`);
    if (result.images > 0) parts.push(`${result.images} images`);
    let message = parts.length > 0 ? `Imported ${parts.join(', ')}.` : 'Nothing to import.';
    if (result.petsSkipped > 0) message += ` Skipped ${result.petsSkipped} duplicate pets.`;
    if (result.imagesSkipped > 0) message += ` Skipped ${result.imagesSkipped} existing images.`;

    onResult({ type: 'success', message });
    await appState.loadPets();
  } catch (err) {
    onResult({ type: 'error', message: `Import failed: ${err.message}` });
  }
  importing = false;
  onClose();
}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="modal-backdrop" onclick={onClose} onkeydown={(e) => { if (e.key === 'Escape') onClose(); }} role="presentation">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="dialog import-dialog" role="dialog" aria-label="Import Backup" aria-modal="true" tabindex="-1" use:focusTrap onclick={(e) => e.stopPropagation()} onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}>
    <div class="dialog-header">
      <h3>Import Backup</h3>
      <button class="close-btn" onclick={onClose}>×</button>
    </div>

    <div class="dialog-body">
      {#if isV1}
        <div class="format-badge legacy">Legacy format (v1 JSON)</div>
      {:else}
        <div class="format-badge">Archive format (v2)</div>
      {/if}

      <div class="backup-info">
        <div class="info-row">
          <span>App version:</span>
          <span>{metadata?.app_version ?? 'unknown'}</span>
        </div>
        <div class="info-row">
          <span>Created:</span>
          <span>{metadata?.exported_at ? new Date(metadata.exported_at).toLocaleDateString() : 'unknown'}</span>
        </div>
      </div>

      <p class="section-label">Import contents:</p>

      <label class="checkbox-row">
        <input type="checkbox" bind:checked={includeGenes} disabled={!hasGenes} />
        <div class="checkbox-info">
          <span class="checkbox-label">Gene definitions</span>
          <span class="checkbox-desc">
            {hasGenes ? `${metadata?.record_counts?.genes ?? '?'} records` : 'Not included in backup'}
          </span>
        </div>
      </label>

      <label class="checkbox-row">
        <input type="checkbox" bind:checked={includePets} disabled={!hasPets} />
        <div class="checkbox-info">
          <span class="checkbox-label">Pet data</span>
          <span class="checkbox-desc">
            {hasPets ? `${metadata?.record_counts?.pets ?? '?'} pets` : 'Not included in backup'}
          </span>
        </div>
      </label>

      <label class="checkbox-row">
        <input type="checkbox" bind:checked={includeImages} disabled={!hasImages} />
        <div class="checkbox-info">
          <span class="checkbox-label">Pet images</span>
          <span class="checkbox-desc">
            {hasImages ? `${metadata?.record_counts?.images ?? '?'} images` : 'Not included in backup'}
          </span>
        </div>
      </label>

      <p class="section-label">Import mode:</p>

      <div class="mode-selector">
        <label class="mode-option" class:active={mode === 'replace'}>
          <input type="radio" name="mode" value="replace" bind:group={mode} />
          <div class="mode-info">
            <span class="mode-label">Replace</span>
            <span class="mode-desc">Clear existing data and restore from backup</span>
          </div>
        </label>
        <label class="mode-option" class:active={mode === 'merge'}>
          <input type="radio" name="mode" value="merge" bind:group={mode} />
          <div class="mode-info">
            <span class="mode-label">Merge</span>
            <span class="mode-desc">Keep existing data, add new, skip duplicates</span>
          </div>
        </label>
      </div>

      {#if mode === 'replace'}
        <div class="warning">Selected data will be permanently replaced. This cannot be undone.</div>
      {/if}
    </div>

    <div class="dialog-footer">
      <button class="btn btn-secondary" onclick={onClose}>Cancel</button>
      <button
        class="btn"
        class:btn-danger={mode === 'replace'}
        class:btn-primary={mode === 'merge'}
        onclick={handleImport}
        disabled={importing || (!includeGenes && !includePets && !includeImages)}
      >
        {importing ? 'Importing...' : mode === 'replace' ? 'Replace Data' : 'Merge Data'}
      </button>
    </div>
  </div>
</div>

<style>
  .import-dialog {
    max-width: 480px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
  }

  .import-dialog .dialog-header { flex-shrink: 0; }
  .import-dialog .dialog-body { overflow-y: auto; }
  .import-dialog .dialog-footer { flex-shrink: 0; }

  .format-badge {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    background: var(--accent-soft);
    color: var(--accent-hover);
    margin-bottom: 12px;
  }

  .format-badge.legacy {
    background: var(--warning-bg);
    color: var(--warning-text);
  }

  .backup-info {
    margin-bottom: 16px;
    font-size: 13px;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
    color: var(--text-tertiary);
  }

  .info-row span:last-child {
    font-weight: 500;
    color: var(--text-secondary);
  }

  .section-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 8px;
    margin-top: 16px;
  }

  .mode-selector {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .mode-option {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border-primary);
    border-radius: 8px;
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .mode-option.active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .mode-option input[type="radio"] {
    margin-top: 2px;
    flex-shrink: 0;
  }

  .mode-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .mode-label {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .mode-desc {
    font-size: 12px;
    color: var(--text-tertiary);
  }

  .warning {
    margin-top: 12px;
    padding: 10px 12px;
    background: var(--error-bg);
    border: 1px solid var(--error-border);
    border-radius: 6px;
    font-size: 12px;
    color: var(--error-text);
  }
</style>
