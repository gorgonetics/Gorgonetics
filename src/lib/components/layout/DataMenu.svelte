<script>
import { onDestroy } from 'svelte';
import { exportDatabase, importDatabase } from '$lib/services/backupService.js';
import { pickJsonFile, readFileContent } from '$lib/services/fileService.js';
import { appState } from '$lib/stores/pets.js';

/** @type {boolean} */
let menuOpen = $state(false);
/** @type {'replace' | 'merge' | null} */
let confirmDialog = $state(null);
/** @type {{ type: 'success' | 'error', message: string } | null} */
let status = $state(null);
let statusTimer = 0;

function toggleMenu() {
  menuOpen = !menuOpen;
  status = null;
}

function closeMenu() {
  menuOpen = false;
}

async function handleExport() {
  closeMenu();
  try {
    const saved = await exportDatabase();
    if (saved) {
      status = { type: 'success', message: 'Backup exported successfully.' };
    }
  } catch (err) {
    status = { type: 'error', message: `Export failed: ${err.message}` };
  }
  clearStatusAfterDelay();
}

function handleImport(mode) {
  closeMenu();
  confirmDialog = mode;
}

function cancelConfirm() {
  confirmDialog = null;
}

async function confirmImport() {
  const mode = confirmDialog;
  confirmDialog = null;

  try {
    const path = await pickJsonFile();
    if (!path) return;

    const content = await readFileContent(path);
    const result = await importDatabase(content, mode);

    let message = `Imported ${result.pets} pets and ${result.genes} gene records.`;
    if (result.skipped > 0) {
      message += ` Skipped ${result.skipped} duplicate pets.`;
    }
    status = { type: 'success', message };

    // Store cache is stale after direct DB import
    await appState.loadPets();
  } catch (err) {
    status = { type: 'error', message: `Import failed: ${err.message}` };
  }
  clearStatusAfterDelay();
}

function clearStatusAfterDelay() {
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    status = null;
  }, 5000);
}

onDestroy(() => clearTimeout(statusTimer));

function handleClickOutside(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (menuOpen && !target.closest('.data-menu')) {
    closeMenu();
  }
}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="data-menu">
  <button class="menu-toggle" onclick={toggleMenu} title="Data management">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3"/>
      <path d="M3 5V19A9 3 0 0 0 21 19V5"/>
      <path d="M3 12A9 3 0 0 0 21 12"/>
    </svg>
  </button>

  {#if menuOpen}
    <div class="dropdown">
      <button class="dropdown-item" onclick={handleExport}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Export Data
      </button>
      <button class="dropdown-item" onclick={() => handleImport('replace')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        Import (Replace)
      </button>
      <button class="dropdown-item" onclick={() => handleImport('merge')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="18" cy="18" r="3"/>
          <circle cx="6" cy="6" r="3"/>
          <path d="M6 21V9a9 9 0 0 0 9 9"/>
        </svg>
        Import (Merge)
      </button>
    </div>
  {/if}
</div>

{#if confirmDialog}
  <div class="modal-backdrop" onclick={cancelConfirm}>
    <div class="confirm-dialog" onclick={(e) => e.stopPropagation()}>
      {#if confirmDialog === 'replace'}
        <h3>Replace all data?</h3>
        <p>This will <strong>delete all existing pets and gene data</strong> and replace it with the backup. This cannot be undone.</p>
      {:else}
        <h3>Merge backup data?</h3>
        <p>New pets will be added. Pets that already exist (same genome) will be skipped. Gene definitions will be updated from the backup.</p>
      {/if}
      <div class="confirm-actions">
        <button class="btn btn-secondary" onclick={cancelConfirm}>Cancel</button>
        <button class="btn" class:btn-danger={confirmDialog === 'replace'} class:btn-primary={confirmDialog !== 'replace'} onclick={confirmImport}>
          {confirmDialog === 'replace' ? 'Replace All Data' : 'Merge Data'}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if status}
  <div class="toast" class:toast-success={status.type === 'success'} class:toast-error={status.type === 'error'}>
    {status.message}
  </div>
{/if}

<style>
  .data-menu {
    position: relative;
  }

  .menu-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #6b7280;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .menu-toggle:hover {
    background: #f3f4f6;
    color: #374151;
  }

  .dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 6px;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    min-width: 180px;
    padding: 4px;
    z-index: 100;
  }

  .dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #374151;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;
  }

  .dropdown-item:hover {
    background: #f3f4f6;
  }

  .confirm-dialog {
    background: #ffffff;
    border-radius: 12px;
    padding: 24px;
    max-width: 420px;
    width: 90%;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
  }

  .confirm-dialog h3 {
    font-size: 16px;
    font-weight: 700;
    color: #111827;
    margin-bottom: 8px;
  }

  .confirm-dialog p {
    font-size: 14px;
    color: #6b7280;
    line-height: 1.5;
    margin-bottom: 20px;
  }

  .confirm-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .toast {
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    z-index: 300;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    animation: slideIn 0.2s ease;
  }

  .toast-success {
    background: #f0fdf4;
    color: #166534;
    border: 1px solid #bbf7d0;
  }

  .toast-error {
    background: #fef2f2;
    color: #991b1b;
    border: 1px solid #fecaca;
  }

  @keyframes slideIn {
    from { transform: translateY(10px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
</style>
