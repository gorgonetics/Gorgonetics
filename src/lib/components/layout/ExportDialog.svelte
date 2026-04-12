<script>
import { exportDatabase } from '$lib/services/backupService.js';
import { getTotalImageCount } from '$lib/services/imageService.js';
import { focusTrap } from '$lib/utils/focusTrap.js';

const { onClose, onResult } = $props();

let includeGenes = $state(true);
let includePets = $state(true);
let includeImages = $state(true);
let imageCount = $state(0);
let exporting = $state(false);

$effect(() => {
  getTotalImageCount().then((count) => {
    imageCount = count;
  });
});

async function handleExport() {
  exporting = true;
  try {
    const result = await exportDatabase({ includeGenes, includePets, includeImages });
    if (result.saved) {
      onResult({
        type: 'success',
        message: `Exported ${result.genes} genes, ${result.pets} pets, ${result.images} images.`,
      });
    }
  } catch (err) {
    onResult({ type: 'error', message: `Export failed: ${err.message}` });
  }
  exporting = false;
  onClose();
}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="modal-backdrop" onclick={onClose} onkeydown={(e) => { if (e.key === 'Escape') onClose(); }} role="presentation">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="dialog export-dialog" role="dialog" aria-label="Export Backup" aria-modal="true" tabindex="-1" use:focusTrap onclick={(e) => e.stopPropagation()} onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}>
    <div class="dialog-header">
      <h3>Export Backup</h3>
      <button class="close-btn" onclick={onClose}>×</button>
    </div>

    <div class="dialog-body">
      <p class="dialog-desc">Choose what to include in the backup:</p>

      <label class="checkbox-row">
        <input type="checkbox" bind:checked={includeGenes} />
        <div class="checkbox-info">
          <span class="checkbox-label">Gene definitions</span>
          <span class="checkbox-desc">Effect data for all chromosomes</span>
        </div>
      </label>

      <label class="checkbox-row">
        <input type="checkbox" bind:checked={includePets} />
        <div class="checkbox-info">
          <span class="checkbox-label">Pet data</span>
          <span class="checkbox-desc">Genome, attributes, and metadata</span>
        </div>
      </label>

      <label class="checkbox-row">
        <input type="checkbox" bind:checked={includeImages} disabled={imageCount === 0} />
        <div class="checkbox-info">
          <span class="checkbox-label">Pet images</span>
          <span class="checkbox-desc">
            {imageCount === 0 ? 'No images uploaded yet' : `${imageCount} image${imageCount > 1 ? 's' : ''}`}
          </span>
        </div>
      </label>
    </div>

    <div class="dialog-footer">
      <button class="btn btn-secondary" onclick={onClose}>Cancel</button>
      <button
        class="btn btn-primary"
        onclick={handleExport}
        disabled={exporting || (!includeGenes && !includePets && !includeImages)}
      >
        {exporting ? 'Exporting...' : 'Export'}
      </button>
    </div>
  </div>
</div>

<style>
  .export-dialog {
    max-width: 440px;
  }

  .dialog-desc {
    font-size: 14px;
    color: var(--text-tertiary);
    margin-bottom: 16px;
  }

  .checkbox-row {
    padding: 10px 0;
    border-bottom: 1px solid var(--bg-tertiary);
  }

  .checkbox-row:last-of-type {
    border-bottom: none;
  }
</style>
