/**
 * Temporary debug function for image upload.
 * Call from browser console: window.__debugImageUpload()
 */

import { isTauri } from '$lib/utils/environment.js';

export async function debugImageUpload() {
  const results: string[] = [];
  const log = (msg: string) => {
    results.push(msg);
    console.log(`[IMG DEBUG] ${msg}`);
  };

  log(`isTauri: ${isTauri()}`);

  if (!isTauri()) {
    log('Not in Tauri — cannot test filesystem operations');
    return results;
  }

  try {
    // Step 1: Pick a file
    log('Opening file picker...');
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      title: 'Debug: Pick an image',
    });
    log(`Picker result: ${JSON.stringify(selected)}`);
    if (!selected) {
      log('No file selected');
      return results;
    }
    const sourcePath = typeof selected === 'string' ? selected : selected[0];
    log(`Source path: ${sourcePath}`);

    // Step 2: Read the file
    log('Reading file...');
    const { readFile, writeFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    let fileData: Uint8Array;
    try {
      fileData = await readFile(sourcePath);
      log(`Read OK: ${fileData.byteLength} bytes`);
    } catch (err: unknown) {
      log(`readFile FAILED: ${err}`);
      return results;
    }

    // Step 3: Create directory
    const relDir = 'images/debug-test';
    log(`Creating directory: ${relDir}`);
    try {
      await mkdir(relDir, { baseDir: BaseDirectory.AppData, recursive: true });
      log('mkdir OK');
    } catch (err: unknown) {
      log(`mkdir FAILED: ${err}`);
      return results;
    }

    // Step 4: Write the file
    const filename = `debug-${Date.now()}.png`;
    const relPath = `${relDir}/${filename}`;
    log(`Writing to: ${relPath}`);
    try {
      await writeFile(relPath, fileData, { baseDir: BaseDirectory.AppData });
      log('writeFile OK');
    } catch (err: unknown) {
      log(`writeFile FAILED: ${err}`);
      return results;
    }

    // Step 5: Read it back
    log('Reading back...');
    try {
      const readBack = await readFile(relPath, { baseDir: BaseDirectory.AppData });
      log(`Read back OK: ${readBack.byteLength} bytes (match: ${readBack.byteLength === fileData.byteLength})`);
    } catch (err: unknown) {
      log(`readFile back FAILED: ${err}`);
      return results;
    }

    // Step 6: Create blob URL
    log('Creating blob URL...');
    const blob = new Blob([fileData], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    log(`Blob URL: ${url}`);

    log('ALL STEPS PASSED');
  } catch (err: unknown) {
    log(`UNEXPECTED ERROR: ${err}`);
  }

  return results;
}

// Expose globally for console access
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__debugImageUpload = debugImageUpload;
}
