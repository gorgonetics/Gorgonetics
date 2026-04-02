/**
 * Detect whether the app is running inside a Tauri native shell.
 */
export function isTauri(): boolean {
  try {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  } catch {
    return false;
  }
}
