<script lang="ts" module>
declare const __APP_VERSION__: string;
</script>

<script lang="ts">
import type { Update } from '@tauri-apps/plugin-updater';
import DetailOverlay from '$lib/components/shared/DetailOverlay.svelte';
import { detectPlatform, getDefaultGameFolder } from '$lib/services/gameImport.js';
import { settings, settingsActions } from '$lib/stores/settings.js';
import { isTauri } from '$lib/utils/environment.js';
import { getFontScale as _getFontScale, clampScale, MAX_SCALE, MIN_SCALE } from '$lib/utils/fontScale.js';
import { getThemePreference } from '$lib/utils/theme.js';

interface Props {
  onClose: () => void;
}

const { onClose }: Props = $props();

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'upToDate' | 'error';

let updateStatus = $state<UpdateStatus>('idle');
let updateVersion = $state('');
let updateNotes = $state('');
let downloadProgress = $state(0);
let errorMessage = $state('');
let pendingUpdate: Update | null = null;

const APP_VERSION: string = __APP_VERSION__;
const inTauri = isTauri();

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const modKey = /mac/i.test(navigator?.userAgent ?? '') ? '⌘' : 'Ctrl';
const currentScale = $derived(_getFontScale($settings));
const currentTheme = $derived(getThemePreference($settings));
const platformLabel = detectPlatform();
const gameFolderPlaceholder = getDefaultGameFolder(platformLabel);
const gameFolderValue = $derived($settings['import.gameFolderPath'] ?? '');

function setGameFolderPath(value: string) {
  settingsActions.update('import.gameFolderPath', value);
}

function setFontScale(scale: number) {
  settingsActions.update('display.fontScale', clampScale(scale));
}

function adjustFontScale(delta: number) {
  setFontScale(currentScale + delta);
}

function setTheme(value: string) {
  settingsActions.update('display.theme', value);
}

async function toggleSetting(key: string) {
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
    const { installUpdateWithBackup } = await import('$lib/services/updateService.js');
    await installUpdateWithBackup(pendingUpdate, (percent) => {
      downloadProgress = percent;
    });
  } catch (err) {
    errorMessage = toErrorMessage(err);
    updateStatus = 'error';
  }
}
</script>

<DetailOverlay onBack={onClose} ariaLabel="Settings" testid="settings-view" backTestid="settings-back">
  {#snippet title()}Settings{/snippet}
  {#snippet children()}
    <div class="settings-scroll">
      <div class="settings-inner">
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
              aria-checked={!!$settings['horse.autoSelectBreedFilter']}
            >
              <span class="toggle-thumb"></span>
            </button>
          </label>
        </div>

        <div class="settings-section">
          <h4>Display</h4>

          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-name">Font scale</span>
              <span class="setting-desc">Adjust with {modKey}+/- or use these controls</span>
            </div>
            <div class="scale-controls">
              <button
                class="scale-btn"
                onclick={() => adjustFontScale(-10)}
                disabled={currentScale <= MIN_SCALE}
                aria-label="Decrease font size"
              >−</button>
              <span class="scale-value">{currentScale}%</span>
              <button
                class="scale-btn"
                onclick={() => adjustFontScale(10)}
                disabled={currentScale >= MAX_SCALE}
                aria-label="Increase font size"
              >+</button>
              <button
                class="scale-reset-btn"
                onclick={() => setFontScale(100)}
                disabled={currentScale === 100}
              >Reset</button>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-name">Theme</span>
              <span class="setting-desc">Choose light, dark, or match your system</span>
            </div>
            <div class="seg theme-selector" role="group" aria-label="Theme">
              <button
                class="seg-btn theme-btn"
                class:active={currentTheme === 'light'}
                onclick={() => setTheme('light')}
                aria-label="Light theme"
              >☀️ Light</button>
              <button
                class="seg-btn theme-btn"
                class:active={currentTheme === 'dark'}
                onclick={() => setTheme('dark')}
                aria-label="Dark theme"
              >🌙 Dark</button>
              <button
                class="seg-btn theme-btn"
                class:active={currentTheme === 'system'}
                onclick={() => setTheme('system')}
                aria-label="System theme"
              >💻 System</button>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h4>Auto-import</h4>

          <div class="setting-row" style="cursor: default;">
            <div class="setting-info">
              <span class="setting-name">Game folder</span>
              <span class="setting-desc">Folder where Project Gorgon writes pet gene reports. New files appear automatically as the game writes them; the 🔄 button on the pet list runs a manual scan on demand.</span>
            </div>
          </div>

          <div class="setting-row" style="cursor: default;">
            <input
              class="text-input text-input--mono"
              type="text"
              placeholder={gameFolderPlaceholder}
              value={gameFolderValue}
              oninput={(e) => setGameFolderPath(e.currentTarget.value)}
              aria-label="Game folder path"
            />
          </div>

          <div class="setting-row" style="cursor: default;">
            <span class="update-message muted">
              Detected platform: {platformLabel}. Leave blank to use the default shown above.
            </span>
          </div>
        </div>

        <div class="settings-section">
          <h4>Community</h4>

          <label class="setting-row">
            <div class="setting-info">
              <span class="setting-name">Auto-share pets on import</span>
              <span class="setting-desc">Automatically publish newly imported pets to the public community catalogue. Off by default — leave it off to keep imports private.</span>
            </div>
            <button
              class="toggle"
              class:toggle-on={$settings['community.autoShareOnImport']}
              onclick={() => toggleSetting('community.autoShareOnImport')}
              role="switch"
              aria-label="Auto-share pets on import"
              aria-checked={!!$settings['community.autoShareOnImport']}
              data-testid="setting-auto-share"
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
  {/snippet}
</DetailOverlay>

<style>
  .settings-scroll {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
  }

  .settings-inner {
    max-width: 640px;
    margin: 0 auto;
    padding: 20px;
  }

  .settings-section h4 {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 8px;
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 8px 0;
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
    color: var(--text-primary);
  }

  .setting-desc {
    font-size: 12px;
    color: var(--text-tertiary);
    line-height: 1.4;
  }

  .toggle {
    position: relative;
    width: 44px;
    height: 24px;
    border: none;
    border-radius: 12px;
    background: var(--toggle-off);
    cursor: pointer;
    transition: background 0.2s;
    flex-shrink: 0;
    padding: 0;
  }

  .toggle-on {
    background: var(--toggle-on);
  }

  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--toggle-thumb);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
    transition: transform 0.2s;
  }

  .toggle-on .toggle-thumb {
    transform: translateX(20px);
  }

  .settings-section + .settings-section {
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid var(--border-primary);
  }

  .scale-controls {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .scale-btn {
    width: 28px;
    height: 28px;
    border: 1px solid var(--border-secondary);
    border-radius: 6px;
    background: var(--bg-primary);
    color: var(--text-secondary);
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .scale-btn:hover:not(:disabled) {
    background: var(--bg-secondary);
    border-color: var(--text-muted);
  }

  .scale-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .scale-value {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    min-width: 40px;
    text-align: center;
  }

  .scale-reset-btn {
    padding: 4px 10px;
    border: 1px solid var(--border-secondary);
    border-radius: 6px;
    background: var(--bg-primary);
    color: var(--text-tertiary);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .scale-reset-btn:hover:not(:disabled) {
    background: var(--bg-secondary);
    border-color: var(--text-muted);
  }

  .scale-reset-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* Chrome comes from the shared .seg/.seg-btn (app.css). `.theme-btn` stays
     as the e2e hook (theme.spec). */
  .theme-selector {
    flex-shrink: 0;
  }

  .theme-btn {
    padding: 5px 12px;
  }

  .check-update-btn {
    padding: 6px 14px;
    border: 1px solid var(--border-secondary);
    border-radius: 6px;
    background: var(--bg-primary);
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s ease;
  }

  .check-update-btn:hover {
    background: var(--bg-secondary);
    border-color: var(--text-muted);
  }

  .install-btn {
    padding: 6px 14px;
    border: none;
    border-radius: 6px;
    background: var(--accent);
    color: var(--bg-primary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s ease;
  }

  .install-btn:hover {
    background: var(--accent-hover);
  }

  .update-message {
    font-size: 13px;
    color: var(--text-tertiary);
  }

  .update-message.muted {
    color: var(--text-muted);
    font-style: italic;
  }

  .update-message.success {
    color: var(--success-text);
  }

  .update-message.error {
    color: var(--error-text);
  }

  .update-available {
    background: var(--bg-selected);
    border-radius: 8px;
    padding: 12px;
    margin: -4px 0;
  }

  .progress-bar {
    width: 100%;
    height: 6px;
    background: var(--border-primary);
    border-radius: 3px;
    overflow: hidden;
    margin-top: 6px;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 3px;
    transition: width 0.2s ease;
  }
</style>
