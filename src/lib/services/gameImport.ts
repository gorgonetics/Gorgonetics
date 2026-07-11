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
import { errorMessage } from '$lib/utils/error.js';
import { sha256Hex } from '$lib/utils/hash.js';
import {
  filterImportedHashes,
  findPetGenomeTextByHash,
  hasImportedFile,
  recordImportedFile,
  uploadPet,
} from './petService.js';
import { getSetting } from './settingsService.js';
import type { BulkUploadSummary } from './shareService.js';

export type Platform = 'windows' | 'mac' | 'linux' | 'unknown';

const GAME_FOLDER_SETTING_KEY = 'import.gameFolderPath';

/**
 * Per-platform default for the game's gene-report folder, all
 * user-confirmed. Stored with a `~/` prefix for display; internally
 * resolved relative to the user's home via `BaseDirectory.Home` so
 * the Tauri fs scope can stay narrow. Forward slashes only — Tauri's
 * fs plugin normalizes them on Windows. The unknown-platform branch
 * (empty string) routes through `isPlaceholderPath` so the auto-scanner
 * surfaces a "not configured" result instead of guessing.
 */
const DEFAULT_GAME_FOLDERS: Record<Platform, string> = {
  windows: '~/AppData/LocalLow/Elder Game/Project Gorgon/Reports',
  mac: '~/Library/Application Support/unity.Elder Game.Project Gorgon/Reports',
  linux: '~/.config/unity3d/Elder Game/Project Gorgon/Reports',
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

const HOME_PREFIX = /^(~|\$HOME)(?:\/|$)/;

/**
 * Strip a leading `~/` or `$HOME/` so the remainder can be passed to
 * Tauri's fs plugin together with `{ baseDir: BaseDirectory.Home }`.
 * Capability scope is keyed off `$HOME/...` patterns; resolving the
 * absolute path on the JS side would defeat that scoping.
 *
 * Exported for unit testing — callers should not need to call this
 * directly; the auto-scan / watch helpers do it themselves.
 */
export function toRelativeHome(path: string): string {
  return path.replace(HOME_PREFIX, '');
}

export interface AutoScanResult {
  status: 'ok' | 'not_configured' | 'folder_missing' | 'error';
  message?: string;
  scanned: number;
  skipped: number;
  imported: number;
  /**
   * Files that matched an existing pet's content_hash and ran
   * `petService.uploadPet`'s in-place `kind: 'backfilled'` branch.
   * That covers two cases:
   *   1. legacy v13 rows with empty `genome_text` (filled);
   *   2. corrupt rows whose stored `genome_text` didn't hash to
   *      `content_hash` (repaired with the canonical text).
   * Either way the row was already present, so the count is
   * separate from `imported` to keep "fresh insert" accurate.
   */
  backfilled: number;
  failures: Array<{ file: string; reason: string }>;
  /**
   * Auto-share outcome for the freshly-imported pets, when the opt-in
   * `community.autoShareOnImport` setting is on. `null` when sharing was
   * skipped (disabled, not configured, or nothing new to share).
   */
  shared?: BulkUploadSummary | null;
}

function emptyResult(status: AutoScanResult['status'], message?: string): AutoScanResult {
  return { status, message, scanned: 0, skipped: 0, imported: 0, backfilled: 0, failures: [], shared: null };
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

  const folder = toRelativeHome(configured);
  const fs = await import('@tauri-apps/plugin-fs');
  const { BaseDirectory } = await import('@tauri-apps/api/path');
  const baseOpts = { baseDir: BaseDirectory.Home };

  let entries: Awaited<ReturnType<typeof fs.readDir>>;
  try {
    entries = await fs.readDir(folder, baseOpts);
  } catch (err) {
    const message = errorMessage(err);
    return emptyResult('folder_missing', `Game folder not readable: ${configured} (${message})`);
  }
  // Path joining via plain concat is acceptable — Tauri's fs plugin
  // normalizes both `/` and `\` on Windows.
  const txtFiles = entries
    .filter((e) => e.isFile && e.name.toLowerCase().endsWith('.txt'))
    .map((e) => ({ name: e.name, relPath: `${folder}/${e.name}`, displayPath: `${configured}/${e.name}` }));

  const result: AutoScanResult = {
    status: 'ok',
    scanned: 0,
    skipped: 0,
    imported: 0,
    backfilled: 0,
    failures: [],
    shared: null,
  };
  // Ids of fresh inserts this scan, for auto-share once the store is reloaded.
  const createdPetIds: number[] = [];

  // Read+hash in parallel chunks — the slow step on cold scans is disk
  // I/O, and SHA-256 of a small text file is negligible. SQL writes
  // (uploadPet, recordImportedFile) stay strictly serial because
  // uploadPet computes MAX(sort_order)+1 inside its transaction.
  const READ_CHUNK = 8;
  for (let i = 0; i < txtFiles.length; i += READ_CHUNK) {
    const chunk = txtFiles.slice(i, i + READ_CHUNK);
    const hashed = await Promise.all(
      chunk.map(async ({ name, relPath, displayPath }) => {
        try {
          const content = await fs.readTextFile(relPath, baseOpts);
          const hash = await sha256Hex(content);
          return { name, displayPath, content, hash } as const;
        } catch (err) {
          return { name, displayPath, error: errorMessage(err) } as const;
        }
      }),
    );

    for (const item of hashed) {
      result.scanned++;
      options?.onProgress?.(result.scanned, txtFiles.length);
      if ('error' in item) {
        result.failures.push({ file: item.name, reason: item.error ?? 'Unknown error' });
        continue;
      }
      if (await hasImportedFile(item.hash)) {
        // Already in the ledger — but TWO classes of unhealthy rows
        // need to fall through to `uploadPet`'s backfill/repair path:
        //   1. legacy v13 pets: in the ledger (from
        //      `backfillImportedFilesIfNeeded`) AND `genome_text = ''`.
        //   2. corrupt rows: `genome_text` non-empty but doesn't
        //      match the canonical file content (e.g. backup-restore
        //      drift; uploadPet now explicitly repairs these).
        //
        // The cheap discriminator is direct byte-equality with
        // `item.content`: a ledger hit means `sha256(item.content) ===
        // content_hash`, so for a healthy row `genome_text` is exactly
        // `item.content`. Any difference (empty OR mismatched) signals
        // a row that needs the upload-side repair. The slim
        // `findPetGenomeTextByHash` keeps the cost to a single-column
        // SELECT per ledger hit; no separate sha256 here because the
        // comparison is on already-computed text.
        const existingGenomeText = await findPetGenomeTextByHash(item.hash);
        if (existingGenomeText === null) {
          // No matching pet (ledger entry exists for a pet that was
          // since deleted). The skip preserves the immutable first-seen
          // source_path the ledger captures.
          result.skipped++;
          continue;
        }
        if (existingGenomeText === item.content) {
          // Healthy row — skip as before.
          result.skipped++;
          continue;
        }
        // Empty OR corrupt — fall through to uploadPet so its
        // `kind: 'backfilled'` branch can repair the row in place.
      }
      const upload = await uploadPet(item.content, { sourcePath: item.displayPath });
      if (upload.status === 'success') {
        if (upload.kind === 'backfilled') {
          result.backfilled++;
        } else {
          result.imported++;
          if (upload.pet_id != null) createdPetIds.push(upload.pet_id);
        }
      } else {
        // pets.content_hash matched but imported_files was missing the
        // row (e.g. pre-feature legacy not yet reached by backfill).
        // Record now so future scans skip it.
        await recordImportedFile(item.hash, item.displayPath);
        result.failures.push({ file: item.name, reason: upload.message });
      }
    }
  }

  // Refresh the in-memory pets store ourselves when the scan changed the DB,
  // so every caller doesn't have to remember the post-scan `loadPets()` chant
  // (#253). Dynamic import keeps this UI-store dependency out of the service's
  // static graph and off the non-Tauri path. Awaited so callers that await
  // autoScanGameFolder (e.g. PetList building its summary toast) observe the
  // fresh list rather than rendering against stale rows; a reload failure
  // surfaces via the store's own error state, so it must not reject the scan.
  if (result.imported > 0 || result.backfilled > 0) {
    const { appState } = await import('$lib/stores/pets.js');
    // loadPets() handles its own errors (surfaces via the store's error state)
    // and never rejects, so awaiting it bare is safe.
    await appState.loadPets();
  }

  // Auto-share the fresh inserts once the store reflects them. Dynamic import
  // keeps the shareService/store/firebase graph off this service's static deps
  // (same rationale as the loadPets import above). No-op unless the user opted
  // in; never throws — a failed share must not fail the scan. Covers every scan
  // caller, including AuthWrapper's background folder watcher.
  if (createdPetIds.length > 0) {
    const { autoShareImportedPets } = await import('./autoShare.js');
    result.shared = await autoShareImportedPets(createdPetIds);
  }

  return result;
}

/**
 * Count distinct content-hashes not present in the `imported_files` ledger.
 * Factored out of the folder I/O so the dedup logic is unit-testable against
 * the real ledger without mocking Tauri's fs. Duplicate files (identical
 * content) collapse to one pending entry, matching "pending pets" rather than
 * "pending files".
 */
export async function countUnimportedHashes(hashes: string[]): Promise<number> {
  const distinct = [...new Set(hashes)];
  if (distinct.length === 0) return 0;
  // One ledger query for the whole batch rather than a round-trip per hash.
  const imported = await filterImportedHashes(distinct);
  return distinct.filter((hash) => !imported.has(hash)).length;
}

/**
 * Read-only dry run of the early part of `autoScanGameFolder`: how many
 * genome files in the configured folder aren't in the ledger yet (i.e. would
 * be imported by a scan). Keying off the ledger — not the live pet rows —
 * means pets the user deliberately deleted stay skipped and aren't counted,
 * matching the scan's own skip semantics. Returns 0 (rather than throwing)
 * outside Tauri, when unconfigured, or when the folder isn't readable, so it's
 * safe to call as a best-effort badge refresh.
 */
export async function countPendingImports(): Promise<number> {
  if (!isTauri()) return 0;

  const configured = await getConfiguredGameFolder();
  if (isPlaceholderPath(configured)) return 0;

  const folder = toRelativeHome(configured);
  const fs = await import('@tauri-apps/plugin-fs');
  const { BaseDirectory } = await import('@tauri-apps/api/path');
  const baseOpts = { baseDir: BaseDirectory.Home };

  let entries: Awaited<ReturnType<typeof fs.readDir>>;
  try {
    entries = await fs.readDir(folder, baseOpts);
  } catch {
    return 0;
  }
  const txtFiles = entries.filter((e) => e.isFile && e.name.toLowerCase().endsWith('.txt'));

  // Read+hash in parallel chunks, same shape as autoScanGameFolder. Files that
  // can't be read are skipped (a scan would surface them as failures; for a
  // count they just don't contribute).
  const READ_CHUNK = 8;
  const hashes: string[] = [];
  for (let i = 0; i < txtFiles.length; i += READ_CHUNK) {
    const chunk = txtFiles.slice(i, i + READ_CHUNK);
    const chunkHashes = await Promise.all(
      chunk.map(async (e) => {
        try {
          const content = await fs.readTextFile(`${folder}/${e.name}`, baseOpts);
          return await sha256Hex(content);
        } catch {
          return null;
        }
      }),
    );
    for (const hash of chunkHashes) if (hash !== null) hashes.push(hash);
  }

  return countUnimportedHashes(hashes);
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

  const folder = toRelativeHome(configured);
  const { watch } = await import('@tauri-apps/plugin-fs');
  const { BaseDirectory } = await import('@tauri-apps/api/path');

  // Tauri's debounced `watch` (vs `watchImmediate`) coalesces bursts
  // for us via `delayMs` — no manual setTimeout debounce needed.
  let unwatch: Awaited<ReturnType<typeof watch>>;
  try {
    unwatch = await watch(folder, () => onChange(), {
      recursive: false,
      baseDir: BaseDirectory.Home,
      delayMs: options?.debounceMs ?? 500,
    });
  } catch {
    // Folder doesn't exist or isn't watchable — caller treats null as
    // "nothing to watch right now". A later path change re-arms.
    return null;
  }

  return async () => {
    await unwatch();
  };
}
