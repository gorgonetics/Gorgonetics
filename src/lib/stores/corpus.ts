import { writable } from 'svelte/store';

/**
 * Bumped when a community cache refresh commits. The Community rarity
 * baseline reads the cache, not the pets, so this is what tells a view that
 * is already showing it to load again — a refresh started in the Study tab
 * can finish after the player has moved to a rarity view.
 */
export const corpusRevision = writable(0);
