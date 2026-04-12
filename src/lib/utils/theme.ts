/**
 * Theme utilities for applying light/dark mode.
 * Manages the data-theme attribute on the document root.
 */

export type ThemePreference = 'light' | 'dark' | 'system';

/** Resolve a preference to the actual theme to apply. */
export function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference === 'system') {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return preference;
}

/** Apply the resolved theme to the document root. */
export function applyTheme(preference: ThemePreference): void {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(preference);
  document.documentElement.setAttribute('data-theme', resolved);
}

/** Get the current theme preference from settings. */
export function getThemePreference(settings: Record<string, unknown>): ThemePreference {
  const val = settings['display.theme'];
  if (val === 'light' || val === 'dark' || val === 'system') return val;
  return 'system';
}
