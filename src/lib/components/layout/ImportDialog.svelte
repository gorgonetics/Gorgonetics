<script>
import { importDatabase } from '$lib/services/backupService.js';
import { appState } from '$lib/stores/pets.js';

const { metadata, fileData, onClose, onResult } = $props();

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
    const result = await importDatabase(fileData, {
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

<div class="modal-backdrop" onclick={onClose}>
  <div class="import-dialog" onclick={(e) => e.stopPropagation()}>
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
    background: #ffffff;
    border-radius: 12px;
    max-width: 480px;
    width: 90%;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
    overflow: hidden;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid #e5e7eb;
    flex-shrink: 0;
  }

  .dialog-header h3 {
    font-size: 16px;
    font-weight: 700;
    color: #111827;
  }

  .close-btn {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #6b7280;
    font-size: 18px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-btn:hover { background: #f3f4f6; }

  .dialog-body {
    padding: 16px 20px;
    overflow-y: auto;
  }

  .format-badge {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    background: #dbeafe;
    color: #1d4ed8;
    margin-bottom: 12px;
  }

  .format-badge.legacy {
    background: #fef3c7;
    color: #92400e;
  }

  .backup-info {
    margin-bottom: 16px;
    font-size: 13px;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
    color: #6b7280;
  }

  .info-row span:last-child {
    font-weight: 500;
    color: #374151;
  }

  .section-label {
    font-size: 12px;
    font-weight: 600;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 8px;
    margin-top: 16px;
  }

  .checkbox-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 8px 0;
    cursor: pointer;
  }

  .checkbox-row input[type="checkbox"] {
    margin-top: 2px;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  .checkbox-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .checkbox-label {
    font-size: 14px;
    font-weight: 500;
    color: #111827;
  }

  .checkbox-desc {
    font-size: 12px;
    color: #9ca3af;
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
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .mode-option.active {
    border-color: #3b82f6;
    background: #f0f7ff;
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
    color: #111827;
  }

  .mode-desc {
    font-size: 12px;
    color: #6b7280;
  }

  .warning {
    margin-top: 12px;
    padding: 10px 12px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 6px;
    font-size: 12px;
    color: #dc2626;
  }

  .dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 14px 20px;
    border-top: 1px solid #e5e7eb;
    background: #f9fafb;
    flex-shrink: 0;
  }
</style>
