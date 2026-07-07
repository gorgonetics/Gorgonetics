import { derived, writable } from 'svelte/store';
import type { Pet } from '$lib/types/index.js';

/**
 * Global in-space overlays that live over the main workspace — Settings and the
 * pet editor. These are full-view lenses (rendered via DetailOverlay), not
 * modal dialogs, matching the redesign's Library/Workspace IA where the pet
 * detail also lives in-space rather than in a popup.
 */
export const settingsOpen = writable(false);
export const editingPet = writable<Pet | null>(null);

/**
 * True while a root overlay (Settings or the pet editor) covers the workspace.
 * The TopBar gates destination navigation (tab buttons, history back, the
 * settings toggle) on this: switching the underlying destination while an
 * overlay covers it would desync the nav highlight from what's visible, and
 * a nav-dismiss would bypass the editor's unsaved-changes guard (#396).
 */
export const overlayOpen = derived(
  [settingsOpen, editingPet],
  ([$settingsOpen, $editingPet]) => $settingsOpen || $editingPet !== null,
);

export const uiActions = {
  openSettings: () => settingsOpen.set(true),
  closeSettings: () => settingsOpen.set(false),
  openEditor: (pet: Pet) => editingPet.set(pet),
  closeEditor: () => editingPet.set(null),
};
