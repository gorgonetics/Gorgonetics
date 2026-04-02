/**
 * File system service for Gorgonetics.
 * Uses Tauri's native dialog and FS plugins in the app.
 * Falls back to browser APIs when running outside Tauri (tests).
 */

function isTauri(): boolean {
  try {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  } catch {
    return false;
  }
}

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

export function pickJsonFile(): Promise<string | null> {
  return pickFile('Import Gorgonetics Backup', 'JSON Files', ['json']);
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
 * Open a native save dialog and write content to the selected path.
 */
export async function saveExportFile(defaultFilename: string, content: string): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({
      defaultPath: defaultFilename,
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
      title: 'Export Genes',
    });
    if (!path) return false;
    await writeTextFile(path, content);
    return true;
  }

  // Browser fallback — download via blob
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultFilename;
  a.click();
  URL.revokeObjectURL(url);
  return true;
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
