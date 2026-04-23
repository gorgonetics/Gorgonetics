/**
 * Reactive sidebar UI preferences (collapsed + width), persisted to localStorage.
 * Kept out of settingsService because these are per-device view preferences
 * that shouldn't sync or participate in backups.
 */

const WIDTH_KEY = 'ui.sidebarWidth';
const COLLAPSED_KEY = 'ui.sidebarCollapsed';
const DEFAULT_WIDTH = 260;
export const MIN_WIDTH = 200;
export const MAX_WIDTH = 560;

function readNumber(key: string, fallback: number): number {
  if (typeof localStorage === 'undefined') return fallback;
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function readBoolean(key: string): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(key) === '1';
}

function clampWidth(w: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));
}

export const sidebar = $state({
  width: clampWidth(readNumber(WIDTH_KEY, DEFAULT_WIDTH)),
  collapsed: readBoolean(COLLAPSED_KEY),
});

/** Set width without persisting. Use during drag for cheap updates. */
export function setSidebarWidth(w: number): void {
  const next = clampWidth(w);
  if (sidebar.width === next) return;
  sidebar.width = next;
}

let lastPersistedWidth: number | null = null;

/** Persist the current width — call once at the end of a drag (or when committing via keyboard). */
export function commitSidebarWidth(): void {
  if (typeof localStorage === 'undefined') return;
  if (lastPersistedWidth === sidebar.width) return;
  localStorage.setItem(WIDTH_KEY, String(sidebar.width));
  lastPersistedWidth = sidebar.width;
}

export function toggleSidebar(): void {
  sidebar.collapsed = !sidebar.collapsed;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(COLLAPSED_KEY, sidebar.collapsed ? '1' : '0');
  }
}
