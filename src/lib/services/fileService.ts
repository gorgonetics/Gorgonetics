/**
 * File system service for Gorgonetics.
 * Uses Tauri's native dialog and FS plugins in the app.
 * Falls back to browser APIs when running outside Tauri (tests).
 */

import { isTauri } from '$lib/utils/environment.js';

async function pickFile(title: string, filterName: string, extensions: string[]): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({
      multiple: false,
      filters: [{ name: filterName, extensions }],
      title,
    });
    return typeof result === 'string' ? result : null;
  }
  return null;
}

export function pickGenomeFile(): Promise<string | null> {
  return pickFile('Select Genome File', 'Genome Files', ['txt']);
}

export function pickBackupFile(): Promise<string | null> {
  return pickFile('Import Gorgonetics Backup', 'Backup Files', ['zip', 'json']);
}

export async function readBinaryFile(path: string): Promise<Uint8Array> {
  if (isTauri()) {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    return readFile(path);
  }
  throw new Error('Binary file reading not available outside Tauri');
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

  const blob = new Blob([data], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultFilename;
  a.click();
  URL.revokeObjectURL(url);
  return true;
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
