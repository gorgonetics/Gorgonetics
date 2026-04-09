<script>
/* global __APP_VERSION__ */

import { settings, settingsActions } from '$lib/stores/settings.js';
import { isTauri } from '$lib/utils/environment.js';

let open = $state(false);

/** @type {'idle' | 'checking' | 'available' | 'downloading' | 'upToDate' | 'error'} */
let updateStatus = $state('idle');
let updateVersion = $state('');
let updateNotes = $state('');
let downloadProgress = $state(0);
let errorMessage = $state('');
let pendingUpdate = null;

const APP_VERSION = __APP_VERSION__;
const inTauri = isTauri();

function toErrorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

function toggle() {
  open = !open;
}

function close() {
  open = false;
}

async function toggleSetting(key) {
  const current = $settings[key];
  await settingsActions.update(key, !current);
}

async function checkForUpdates() {
  if (!inTauri || updateStatus === 'checking') return;
  updateStatus = 'checking';
  errorMessage = '';
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (update) {
      pendingUpdate = update;
      updateVersion = update.version;
      updateNotes = update.body ?? '';
      updateStatus = 'available';
    } else {
      updateStatus = 'upToDate';
    }
  } catch (err) {
    errorMessage = toErrorMessage(err);
    updateStatus = 'error';
  }
}

async function installUpdate() {
  if (!pendingUpdate || updateStatus === 'downloading') return;
  updateStatus = 'downloading';
  downloadProgress = 0;
  try {
    let totalSize = 0;
    let downloaded = 0;
    await pendingUpdate.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        totalSize = event.data.contentLength ?? 0;
      } else if (event.event === 'Progress') {
        downloaded += event.data.chunkLength ?? 0;
        downloadProgress = totalSize > 0 ? Math.round((downloaded / totalSize) * 100) : 0;
      }
    });
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (err) {
    errorMessage = toErrorMessage(err);
    updateStatus = 'error';
  }
}
</script>

<button class="settings-toggle" onclick={toggle} title="Settings">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
</button>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={close} onkeydown={(e) => { if (e.key === 'Escape') close(); }} role="presentation">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="dialog settings-dialog" role="dialog" aria-label="Settings" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => { if (e.key === 'Escape') close(); }}>
      <div class="dialog-header">
        <h3>Settings</h3>
        <button class="close-btn" onclick={close} aria-label="Close settings">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <div class="settings-section">
          <h4>Horse Visualization</h4>

          <label class="setting-row">
            <div class="setting-info">
              <span class="setting-name">Auto-select breed filter</span>
              <span class="setting-desc">When viewing a Horse pet, automatically filter genes to that pet's breed</span>
            </div>
            <button
              class="toggle"
              class:toggle-on={$settings['horse.autoSelectBreedFilter']}
              onclick={() => toggleSetting('horse.autoSelectBreedFilter')}
              role="switch"
              aria-label="Auto-select breed filter"
              aria-checked={$settings['horse.autoSelectBreedFilter']}
            >
              <span class="toggle-thumb"></span>
            </button>
          </label>
        </div>

        <div class="settings-section">
          <h4>Updates</h4>

          <div class="setting-row" style="cursor: default;">
            <div class="setting-info">
              <span class="setting-name">Current version</span>
              <span class="setting-desc">{APP_VERSION}</span>
            </div>
          </div>

          {#if !inTauri}
            <div class="setting-row">
              <span class="update-message muted">Update checking is only available in the desktop app.</span>
            </div>
          {:else if updateStatus === 'idle'}
            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-name">Check for new releases</span>
              </div>
              <button class="check-update-btn" onclick={checkForUpdates}>Check for updates</button>
            </div>
          {:else if updateStatus === 'checking'}
            <div class="setting-row">
              <span class="update-message">Checking for updates...</span>
            </div>
          {:else if updateStatus === 'upToDate'}
            <div class="setting-row">
              <div class="setting-info">
                <span class="update-message success">You're on the latest version.</span>
              </div>
              <button class="check-update-btn" onclick={checkForUpdates}>Check again</button>
            </div>
          {:else if updateStatus === 'available'}
            <div class="setting-row update-available">
              <div class="setting-info">
                <span class="setting-name">Version {updateVersion} available</span>
                {#if updateNotes}
                  <span class="setting-desc">{updateNotes}</span>
                {/if}
              </div>
              <button class="install-btn" onclick={installUpdate}>Install &amp; restart</button>
            </div>
          {:else if updateStatus === 'downloading'}
            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-name">Downloading update...</span>
                <div class="progress-bar">
                  <div class="progress-fill" style="width: {downloadProgress}%"></div>
                </div>
                <span class="setting-desc">{downloadProgress}%</span>
              </div>
            </div>
          {:else if updateStatus === 'error'}
            <div class="setting-row">
              <div class="setting-info">
                <span class="update-message error">Update failed: {errorMessage}</span>
              </div>
              <button class="check-update-btn" onclick={checkForUpdates}>Retry</button>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .settings-toggle {
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

  .settings-toggle:hover {
    background: #f3f4f6;
    color: #374151;
  }

  .settings-dialog {
    max-width: 480px;
  }

  .settings-section h4 {
    font-size: 12px;
    font-weight: 600;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 12px;
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 0;
    cursor: pointer;
  }

  .setting-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .setting-name {
    font-size: 14px;
    font-weight: 500;
    color: #111827;
  }

  .setting-desc {
    font-size: 12px;
    color: #6b7280;
    line-height: 1.4;
  }

  .toggle {
    position: relative;
    width: 44px;
    height: 24px;
    border: none;
    border-radius: 12px;
    background: #d1d5db;
    cursor: pointer;
    transition: background 0.2s;
    flex-shrink: 0;
    padding: 0;
  }

  .toggle-on {
    background: #3b82f6;
  }

  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
    transition: transform 0.2s;
  }

  .toggle-on .toggle-thumb {
    transform: translateX(20px);
  }

  .settings-section + .settings-section {
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid #e5e7eb;
  }

  .check-update-btn {
    padding: 6px 14px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    background: #ffffff;
    color: #374151;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s ease;
  }

  .check-update-btn:hover {
    background: #f9fafb;
    border-color: #9ca3af;
  }

  .install-btn {
    padding: 6px 14px;
    border: none;
    border-radius: 6px;
    background: #3b82f6;
    color: #ffffff;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s ease;
  }

  .install-btn:hover {
    background: #2563eb;
  }

  .update-message {
    font-size: 13px;
    color: #6b7280;
  }

  .update-message.muted {
    color: #9ca3af;
    font-style: italic;
  }

  .update-message.success {
    color: #059669;
  }

  .update-message.error {
    color: #dc2626;
  }

  .update-available {
    background: #eff6ff;
    border-radius: 8px;
    padding: 12px;
    margin: -4px 0;
  }

  .progress-bar {
    width: 100%;
    height: 6px;
    background: #e5e7eb;
    border-radius: 3px;
    overflow: hidden;
    margin-top: 6px;
  }

  .progress-fill {
    height: 100%;
    background: #3b82f6;
    border-radius: 3px;
    transition: width 0.2s ease;
  }
</style>
