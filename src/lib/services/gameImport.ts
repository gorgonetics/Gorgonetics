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
import { sha256Hex } from '$lib/utils/hash.js';
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
 *
 * Mac is checked before Windows because the substring "win" appears
 * inside "darwin" — a naive `ua.includes('win')` misclassifies Mac
 * tooling/embedder UAs as Windows.
 */
export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac') || ua.includes('darwin')) return 'mac';
  if (ua.includes('windows nt') || ua.includes('win32') || ua.includes('win64')) return 'windows';
  if (ua.includes('linux') || ua.includes('x11')) return 'linux';
  return 'unknown';
}

/** Per-platform default, or '' if the host platform is unknown. */
export function getDefaultGameFolder(platform: Platform = detectPlatform()): string {
  return DEFAULT_GAME_FOLDERS[platform] ?? '';
}

/** True if the path is unset (only check that survives now that all platforms have real defaults). */
export function isPlaceholderPath(path: string): boolean {
  return !path.trim();
}

/** Read user-configured folder, or platform default if unset. */
export async function getConfiguredGameFolder(): Promise<string> {
  const stored = (await getSetting<string>(GAME_FOLDER_SETTING_KEY)) ?? '';
  return stored.trim() || getDefaultGameFolder();
}

export function setConfiguredGameFolder(path: string): Promise<void> {
  return setSetting(GAME_FOLDER_SETTING_KEY, path);
}

const HOME_PREFIX = /^(~|\$HOME)(?=$|\/)/;

/**
 * Expand a leading `~` or `$HOME` to the real home directory. Tauri's
 * fs plugin only resolves these as capability scope variables — the
 * path passed to readDir/readTextFile is taken literally — so the
 * expansion has to happen here before the call.
 */
async function expandHomePath(path: string): Promise<string> {
  if (!HOME_PREFIX.test(path)) return path;
  const { homeDir } = await import('@tauri-apps/api/path');
  const home = (await homeDir()).replace(/\/$/, '');
  return path.replace(HOME_PREFIX, home);
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
  const fs = await import('@tauri-apps/plugin-fs');
  const { readTextFile } = fs;

  let entries: Awaited<ReturnType<typeof fs.readDir>>;
  try {
    entries = await fs.readDir(folder);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return emptyResult('folder_missing', `Game folder not readable: ${folder} (${message})`);
  }
  // Path joining via plain concat is acceptable — Tauri's fs plugin
  // normalizes both `/` and `\` on Windows.
  const txtFiles = entries
    .filter((e) => e.isFile && e.name.toLowerCase().endsWith('.txt'))
    .map((e) => ({ name: e.name, fullPath: `${folder}/${e.name}` }));

  const result: AutoScanResult = {
    status: 'ok',
    scanned: 0,
    skipped: 0,
    imported: 0,
    failures: [],
  };

  // Read+hash in parallel chunks — the slow step on cold scans is disk
  // I/O, and SHA-256 of a small text file is negligible. SQL writes
  // (uploadPet, recordImportedFile) stay strictly serial because
  // uploadPet computes MAX(sort_order)+1 inside its transaction.
  const READ_CHUNK = 8;
  for (let i = 0; i < txtFiles.length; i += READ_CHUNK) {
    const chunk = txtFiles.slice(i, i + READ_CHUNK);
    const hashed = await Promise.all(
      chunk.map(async ({ name, fullPath }) => {
        try {
          const content = await readTextFile(fullPath);
          const hash = await sha256Hex(content);
          return { name, fullPath, content, hash } as const;
        } catch (err) {
          return { name, fullPath, error: err instanceof Error ? err.message : String(err) } as const;
        }
      }),
    );

    for (const item of hashed) {
      result.scanned++;
      options?.onProgress?.(result.scanned, txtFiles.length);
      if ('error' in item) {
        result.failures.push({ file: item.name, reason: item.error });
        continue;
      }
      if (await hasImportedFile(item.hash)) {
        // Already in the ledger — first-seen source_path is intentionally
        // immutable, so don't rewrite it on skip.
        result.skipped++;
        continue;
      }
      const upload = await uploadPet(item.content, { sourcePath: item.fullPath });
      if (upload.status === 'success') {
        result.imported++;
      } else {
        // pets.content_hash matched but imported_files was missing the
        // row (e.g. pre-feature legacy not yet reached by backfill).
        // Record now so future scans skip it.
        await recordImportedFile(item.hash, item.fullPath);
        result.failures.push({ file: item.name, reason: upload.message });
      }
    }
  }

  return result;
}

/**
 * Watch the configured game folder for changes and invoke `onChange`
 * when a `.txt` event fires (debounced). Returns a stop function, or
 * `null` if there's nothing to watch (non-Tauri host, unconfigured
 * placeholder, missing folder). The caller is expected to call the
 * returned stop function when the watcher should be torn down.
 *
 * Debounce protects against editors that "save = write twice" — Unity
 * builds aren't editors, but we still want a quiet window so we don't
 * scan a half-written file.
 */
export async function watchGameFolder(
  onChange: () => void,
  options?: { debounceMs?: number },
): Promise<(() => Promise<void>) | null> {
  if (!isTauri()) return null;

  const configured = await getConfiguredGameFolder();
  if (isPlaceholderPath(configured)) return null;

  const folder = await expandHomePath(configured);
  const { watch } = await import('@tauri-apps/plugin-fs');

  const debounceMs = options?.debounceMs ?? 500;
  let timer: ReturnType<typeof setTimeout> | null = null;

  let unwatch: Awaited<ReturnType<typeof watch>>;
  try {
    unwatch = await watch(
      folder,
      () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          onChange();
        }, debounceMs);
      },
      { recursive: false },
    );
  } catch {
    // Folder doesn't exist or isn't watchable — caller treats null as
    // "nothing to watch right now". A later path change re-arms.
    return null;
  }

  return async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    await unwatch();
  };
}
