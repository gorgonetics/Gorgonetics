<script>
import { exportDatabase } from '$lib/services/backupService.js';
import { getTotalImageCount } from '$lib/services/imageService.js';

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

<div class="modal-backdrop" onclick={onClose}>
  <div class="export-dialog" onclick={(e) => e.stopPropagation()}>
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
    background: #ffffff;
    border-radius: 12px;
    max-width: 440px;
    width: 90%;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
    overflow: hidden;
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid #e5e7eb;
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
  }

  .dialog-desc {
    font-size: 14px;
    color: #6b7280;
    margin-bottom: 16px;
  }

  .checkbox-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 10px 0;
    cursor: pointer;
    border-bottom: 1px solid #f3f4f6;
  }

  .checkbox-row:last-of-type { border-bottom: none; }

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

  .dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 14px 20px;
    border-top: 1px solid #e5e7eb;
    background: #f9fafb;
  }
</style>
