/**
 * File system service for Gorgonetics.
 * Uses Tauri's native dialog and FS plugins in the app.
 * Falls back to browser APIs when running outside Tauri (tests).
 */

import { isTauri } from '$lib/utils/environment.js';

export async function openFileDialog(
  title: string,
  filterName: string,
  extensions: string[],
  multiple: boolean,
): Promise<string[]> {
  if (!isTauri()) return [];
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({ multiple, filters: [{ name: filterName, extensions }], title });
  if (Array.isArray(result)) return result;
  if (typeof result === 'string') return [result];
  return [];
}

export function pickGenomeFiles(): Promise<string[]> {
  return openFileDialog('Select Genome Files', 'Genome Files', ['txt'], true);
}

export async function pickBackupFile(): Promise<string | null> {
  const files = await openFileDialog('Import Gorgonetics Backup', 'Backup Files', ['zip', 'json'], false);
  return files[0] ?? null;
}

export async function readBinaryFile(path: string): Promise<Uint8Array> {
  if (isTauri()) {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    return readFile(path);
  }
  throw new Error('Binary file reading not available outside Tauri');
}

/**
 * Run the OS "Save As" dialog for a backup archive and return the chosen
 * path (null if cancelled or not in Tauri). Used by the streaming export
 * path, where the zip is written natively by the `write_zip` command rather
 * than handed back through JS as a Uint8Array.
 */
export async function pickExportSavePath(defaultFilename: string): Promise<string | null> {
  if (!isTauri()) return null;
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({
    defaultPath: defaultFilename,
    filters: [{ name: 'Zip Archives', extensions: ['zip'] }],
    title: 'Export Gorgonetics Backup',
  });
  return path ?? null;
}

export async function saveExportBinaryFile(defaultFilename: string, data: Uint8Array): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({
      defaultPath: defaultFilename,
      filters: [{ name: 'Zip Archives', extensions: ['zip'] }],
      title: 'Export Gorgonetics Backup',
    });
    if (!path) return false;
    await writeFile(path, data);
    return true;
  }

  const blob = new Blob([data as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultFilename;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

/**
 * Save a text file via the OS save dialog (Tauri) or the browser's
 * `<a download>` mechanism (dev/test). Returns the chosen path on
 * success, or null if the user cancelled the Tauri dialog. In browser
 * mode, returns the default filename since the actual save location is
 * the browser's downloads folder and isn't observable from JS.
 */
export async function saveExportTextFile(
  defaultFilename: string,
  contents: string,
  filterName: string,
  extensions: string[],
  options: { title?: string; mimeType?: string } = {},
): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({
      defaultPath: defaultFilename,
      filters: [{ name: filterName, extensions }],
      title: options.title,
    });
    if (!path) return null;
    await writeTextFile(path, contents);
    return path;
  }

  const blob = new Blob([contents], { type: options.mimeType ?? 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultFilename;
  a.click();
  URL.revokeObjectURL(url);
  return defaultFilename;
}

/**
 * Read the text content of a file at the given path.
 */
export async function readFileContent(path: string): Promise<string> {
  if (isTauri()) {
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    return readTextFile(path);
  }
  throw new Error('File reading not available outside Tauri');
}

/**
 * Load a bundled resource file from the Tauri resources directory.
 * In non-Tauri context, fetches from the /assets/ path on the dev server.
 */
export async function loadBundledResource(resourcePath: string): Promise<string> {
  if (isTauri()) {
    const { resolveResource } = await import('@tauri-apps/api/path');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const fullPath = await resolveResource(resourcePath);
    return readTextFile(fullPath);
  }

  // Browser fallback — fetch from public assets
  // Map resource paths: "resources/assets/beewasp/file.json" -> "/assets/beewasp/file.json"
  const webPath = resourcePath.replace(/^resources\//, '/');
  const response = await fetch(webPath);
  if (!response.ok) throw new Error(`Failed to fetch ${webPath}: ${response.status}`);
  return response.text();
}

/**
 * List bundled resource files matching a pattern within a directory.
 */
export async function listBundledResources(dirPath: string): Promise<string[]> {
  if (isTauri()) {
    const { readDir } = await import('@tauri-apps/plugin-fs');
    const { resolveResource } = await import('@tauri-apps/api/path');
    const fullPath = await resolveResource(dirPath);
    const entries = await readDir(fullPath);
    return entries.filter((e) => e.isFile && e.name.endsWith('.json')).map((e) => `${dirPath}/${e.name}`);
  }

  // Browser fallback — use a manifest of known files
  // This is a static list matching the bundled assets
  const webDir = dirPath.replace(/^resources\//, '');
  if (webDir.includes('beewasp')) {
    return Array.from({ length: 10 }, (_, i) => `${dirPath}/beewasp_genes_chr${String(i + 1).padStart(2, '0')}.json`);
  } else if (webDir.includes('horse')) {
    return Array.from({ length: 48 }, (_, i) => `${dirPath}/horse_genes_chr${String(i + 1).padStart(2, '0')}.json`);
  }
  return [];
}
