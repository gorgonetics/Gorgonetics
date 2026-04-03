/**
 * Reactive settings store for Gorgonetics.
 * Loaded once at startup, updated synchronously when settings change.
 */

import { writable } from 'svelte/store';
import { getAllSettings, getDefaultSettings, setSetting } from '$lib/services/settingsService.js';

export const settings = writable<Record<string, unknown>>(getDefaultSettings());

export const settingsActions = {
  async load() {
    const all = await getAllSettings();
    settings.set(all);
  },

  async update(key: string, value: unknown) {
    await setSetting(key, value);
    settings.update((s) => ({ ...s, [key]: value }));
  },
};
