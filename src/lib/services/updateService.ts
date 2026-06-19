/**
 * Update install orchestration for the desktop auto-updater.
 *
 * The Tauri updater overwrites the install in place with no built-in rollback
 * (see docs/update-rollback.md). To give a failed update an escape hatch, this
 * splits the plugin's `download` and `install` steps and snapshots the current
 * install (via the `backup_before_update` Rust command) in the window between
 * them — #111. The startup path in src-tauri deletes that snapshot once the new
 * version launches successfully.
 */

import type { Update } from '@tauri-apps/plugin-updater';

/** Called with download completion percentage (0–100). */
export type ProgressCallback = (percent: number) => void;

/**
 * Download an update, back up the current install, then install and relaunch.
 *
 * The backup is best-effort: if it fails, the failure is logged and the install
 * proceeds. Blocking a user-requested update because the safety net could not be
 * written is worse than updating without it.
 */
export async function installUpdateWithBackup(update: Update, onProgress?: ProgressCallback): Promise<void> {
  let totalSize = 0;
  let downloaded = 0;
  await update.download((event) => {
    if (event.event === 'Started') {
      totalSize = event.data.contentLength ?? 0;
    } else if (event.event === 'Progress') {
      downloaded += event.data.chunkLength ?? 0;
      onProgress?.(totalSize > 0 ? Math.round((downloaded / totalSize) * 100) : 0);
    }
  });

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('backup_before_update', { toVersion: update.version });
  } catch (err) {
    console.warn('[updater] pre-update backup failed; continuing with install:', err);
  }

  await update.install();
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}
