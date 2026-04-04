<script>
import { settings, settingsActions } from '$lib/stores/settings.js';

let open = $state(false);

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
</script>

<button class="settings-toggle" onclick={toggle} title="Settings">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
</button>

{#if open}
  <div class="modal-backdrop" onclick={close}>
    <div class="dialog settings-dialog" onclick={(e) => e.stopPropagation()}>
      <div class="dialog-header">
        <h3>Settings</h3>
        <button class="close-btn" onclick={close}>
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
              aria-checked={$settings['horse.autoSelectBreedFilter']}
            >
              <span class="toggle-thumb"></span>
            </button>
          </label>
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
</style>
