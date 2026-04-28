/**
 * Auto-import service for Project Gorgon gene-report files.
 *
 * Scans a configured folder, computes a content hash for each .txt file,
 * and ingests files whose hash isn't already in the `imported_files` ledger.
 * The ledger is maintained by `petService.recordImportedFile`, which keeps
 * skip-state across pet deletions — a pet the user deleted on purpose
 * doesn't come back on the next scan.
 */

import { isTauri } from '$lib/utils/environment.js';
import { hasImportedFile, recordImportedFile, uploadPet } from './petService.js';
import { getSetting, setSetting } from './settingsService.js';

export type Platform = 'windows' | 'mac' | 'linux' | 'unknown';

const GAME_FOLDER_SETTING_KEY = 'import.gameFolderPath';

/**
 * Per-platform default for the game's gene-report folder, all
 * user-confirmed. Forward slashes only — Tauri's fs plugin normalizes
 * them on Windows. The auto-scanner still falls back through
 * `isPlaceholderPath` so the unknown-platform branch (empty string)
 * surfaces a "not configured" result instead of attempting a scan.
 * Users can override any default in Settings → Auto-import.
 */
const DEFAULT_GAME_FOLDERS: Record<Platform, string> = {
  windows: '$HOME/AppData/LocalLow/Elder Game/Project Gorgon/Reports',
  mac: '$HOME/Library/Application Support/unity.Elder Game.Project Gorgon/Reports',
  linux: '$HOME/.config/unity3d/Elder Game/Project Gorgon/Reports',
  unknown: '',
};

/**
 * Detect host platform from the webview's userAgent. Tauri runs in the
 * system webview, so the UA reflects the host OS.
 */
export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('mac')) return 'mac';
  if (ua.includes('linux') || ua.includes('x11')) return 'linux';
  return 'unknown';
}

/** Per-platform default, or '' if unknown. May be a `<TODO:` placeholder. */
export function getDefaultGameFolder(platform: Platform = detectPlatform()): string {
  return DEFAULT_GAME_FOLDERS[platform] ?? '';
}

/** True if the path is one of our placeholder strings (not real config). */
export function isPlaceholderPath(path: string): boolean {
  const trimmed = path.trim();
  return !trimmed || trimmed.startsWith('<TODO:');
}

/** Read user-configured folder, or platform default if unset. */
export async function getConfiguredGameFolder(): Promise<string> {
  const stored = (await getSetting<string>(GAME_FOLDER_SETTING_KEY)) ?? '';
  const trimmed = stored.trim();
  return trimmed || getDefaultGameFolder();
}

export function setConfiguredGameFolder(path: string): Promise<void> {
  return setSetting(GAME_FOLDER_SETTING_KEY, path);
}

/**
 * Expand a `~/` or `$HOME/` prefix to the real home directory. The Tauri
 * fs plugin doesn't substitute these — capability scope variables resolve
 * server-side, but the path passed into readDir/readTextFile is taken
 * literally — so the expansion has to happen here before the call.
 */
async function expandHomePath(path: string): Promise<string> {
  if (!path.startsWith('~/') && !path.startsWith('$HOME/') && path !== '~' && path !== '$HOME') {
    return path;
  }
  const { homeDir } = await import('@tauri-apps/api/path');
  const home = (await homeDir()).replace(/\/$/, '');
  if (path === '~' || path === '$HOME') return home;
  if (path.startsWith('~/')) return `${home}${path.slice(1)}`;
  return `${home}${path.slice('$HOME'.length)}`;
}

/**
 * SHA-256 of a string — matches the hash that `uploadPet` uses internally
 * so the dedup check is against the same key space.
 */
async function sha256(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface AutoScanResult {
  status: 'ok' | 'not_configured' | 'folder_missing' | 'error';
  message?: string;
  scanned: number;
  skipped: number;
  imported: number;
  failures: Array<{ file: string; reason: string }>;
}

function emptyResult(status: AutoScanResult['status'], message?: string): AutoScanResult {
  return { status, message, scanned: 0, skipped: 0, imported: 0, failures: [] };
}

/**
 * Scan the configured game folder and import any genome files we haven't
 * seen before. Reports per-file failures rather than aborting on the
 * first one — a single broken export shouldn't block the rest.
 */
export async function autoScanGameFolder(options?: {
  onProgress?: (current: number, total: number) => void;
}): Promise<AutoScanResult> {
  if (!isTauri()) return emptyResult('error', 'Auto-import is only available in the desktop app');

  const configured = await getConfiguredGameFolder();
  if (isPlaceholderPath(configured)) return emptyResult('not_configured');

  const folder = await expandHomePath(configured);
  const { readDir, readTextFile, exists } = await import('@tauri-apps/plugin-fs');

  if (!(await exists(folder))) {
    return emptyResult('folder_missing', `Game folder not found: ${folder}`);
  }

  const entries = await readDir(folder);
  const txtFiles = entries.filter((e) => e.isFile && e.name.toLowerCase().endsWith('.txt')).map((e) => e.name);

  const result: AutoScanResult = {
    status: 'ok',
    scanned: 0,
    skipped: 0,
    imported: 0,
    failures: [],
  };

  for (let i = 0; i < txtFiles.length; i++) {
    const fileName = txtFiles[i];
    options?.onProgress?.(i + 1, txtFiles.length);
    result.scanned++;
    // Path joining via plain concat is acceptable here — Tauri's fs
    // plugin normalizes both `/` and `\` separators on all platforms.
    const fullPath = `${folder}/${fileName}`;
    try {
      const content = await readTextFile(fullPath);
      const hash = await sha256(content);
      if (await hasImportedFile(hash)) {
        // Already in the ledger — first-seen source_path is intentionally
        // immutable, so don't rewrite it on skip.
        result.skipped++;
        continue;
      }
      const upload = await uploadPet(content, '', 'Male', undefined, fullPath);
      if (upload.status === 'success') {
        result.imported++;
      } else {
        // pets.content_hash matched but imported_files was missing the
        // row (e.g. pre-feature legacy that the backfill hasn't reached
        // yet). Record now so future scans skip it.
        await recordImportedFile(hash, fullPath);
        result.failures.push({ file: fileName, reason: upload.message });
      }
    } catch (err) {
      result.failures.push({
        file: fileName,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
