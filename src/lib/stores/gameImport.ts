/**
 * Shared state for the game-folder auto-import indicator (#295).
 *
 * `pendingImportCount` holds how many genome files in the configured folder
 * aren't imported yet, so the auto-scan button can show a badge. It's refreshed
 * from a few places (startup, the live folder watcher, after a manual scan, and
 * on folder-path change) — hence a store rather than per-component state.
 */

import { writable } from 'svelte/store';
import { countPendingImports } from '$lib/services/gameImport.js';

export const pendingImportCount = writable(0);

// Collapse overlapping refreshes (e.g. a watcher event landing mid-startup)
// into one in-flight scan; the trailing caller just sees the latest count.
let refreshing = false;

/**
 * Recompute the pending-import count, best-effort. Never throws — a failed
 * scan leaves the previous value in place rather than flipping the badge.
 */
export async function refreshPendingImportCount(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    pendingImportCount.set(await countPendingImports());
  } catch {
    // Best-effort indicator; keep the last known value.
  } finally {
    refreshing = false;
  }
}
