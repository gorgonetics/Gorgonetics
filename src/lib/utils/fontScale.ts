/**
 * Shared font scale utilities.
 * Used by both +layout.svelte (global keyboard shortcuts) and SettingsModal (UI controls).
 */

export const MIN_SCALE = 75;
export const MAX_SCALE = 150;
export const STEP = 10;

export function getFontScale(settings: Record<string, unknown>): number {
  const val = settings['display.fontScale'];
  return typeof val === 'number' ? val : 100;
}

export function applyFontScale(scale: number): void {
  document.documentElement.style.fontSize = `${scale}%`;
}

export function clampScale(scale: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}
