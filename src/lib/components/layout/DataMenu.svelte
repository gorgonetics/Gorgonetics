<script>
import { onDestroy, tick } from 'svelte';
import { inspectBackup } from '$lib/services/backupService.js';
import { pickBackupFile, readBinaryFile } from '$lib/services/fileService.js';
import ExportDialog from './ExportDialog.svelte';
import ImportDialog from './ImportDialog.svelte';

let menuOpen = $state(false);
let showExport = $state(false);
let showImport = $state(false);
/** @type {import('$lib/types/index.js').GorgonExportMetadata | null} */
let importMetadata = $state(null);
/** @type {Uint8Array | null} */
let importFileData = $state(null);
/** @type {{ type: 'success' | 'error', message: string } | null} */
let status = $state(null);
let statusTimer = 0;

let focusedIndex = $state(-1);
let exportBtn = $state(null);
let importBtn = $state(null);
const menuItems = $derived([exportBtn, importBtn].filter(Boolean));

function toggleMenu() {
  menuOpen = !menuOpen;
  status = null;
  if (menuOpen) {
    focusedIndex = 0;
    tick().then(() => menuItems[0]?.focus());
  }
}

function closeMenu() {
  menuOpen = false;
  focusedIndex = -1;
}

function handleToggleKeydown(e) {
  if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
    if (!menuOpen) {
      e.preventDefault();
      menuOpen = true;
      status = null;
      focusedIndex = 0;
      tick().then(() => menuItems[0]?.focus());
    }
  }
}

function handleMenuKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeMenu();
    document.querySelector('.menu-toggle')?.focus();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    focusedIndex = (focusedIndex + 1) % menuItems.length;
    menuItems[focusedIndex]?.focus();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    focusedIndex = (focusedIndex - 1 + menuItems.length) % menuItems.length;
    menuItems[focusedIndex]?.focus();
  } else if (e.key === 'Home') {
    e.preventDefault();
    focusedIndex = 0;
    menuItems[0]?.focus();
  } else if (e.key === 'End') {
    e.preventDefault();
    focusedIndex = menuItems.length - 1;
    menuItems[focusedIndex]?.focus();
  }
}

function openExport() {
  closeMenu();
  showExport = true;
}

async function openImport() {
  closeMenu();
  try {
    const path = await pickBackupFile();
    if (!path) return;

    const data = await readBinaryFile(path);
    const metadata = await inspectBackup(data);
    importFileData = data;
    importMetadata = metadata;
    showImport = true;
  } catch (err) {
    status = { type: 'error', message: `Failed to read backup: ${err.message}` };
    clearStatusAfterDelay();
  }
}

function handleResult(result) {
  status = result;
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
  <button
    class="menu-toggle"
    onclick={toggleMenu}
    onkeydown={handleToggleKeydown}
    title="Data management"
    aria-haspopup="menu"
    aria-expanded={menuOpen}
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3"/>
      <path d="M3 5V19A9 3 0 0 0 21 19V5"/>
      <path d="M3 12A9 3 0 0 0 21 12"/>
    </svg>
  </button>

  {#if menuOpen}
    <div class="dropdown" role="menu" tabindex="-1" onkeydown={handleMenuKeydown}>
      <button
        class="dropdown-item"
        role="menuitem"
        tabindex={focusedIndex === 0 ? 0 : -1}
        onclick={openExport}
        bind:this={exportBtn}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Export Backup
      </button>
      <button
        class="dropdown-item"
        role="menuitem"
        tabindex={focusedIndex === 1 ? 0 : -1}
        onclick={openImport}
        bind:this={importBtn}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        Import Backup
      </button>
    </div>
  {/if}
</div>

{#if showExport}
  <ExportDialog onClose={() => { showExport = false; }} onResult={handleResult} />
{/if}

{#if showImport && importMetadata}
  <ImportDialog
    metadata={importMetadata}
    fileData={importFileData}
    onClose={() => { showImport = false; importMetadata = null; importFileData = null; }}
    onResult={handleResult}
  />
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
