import { HORSE_BREEDS } from '$lib/types/index.js';

export function getSpeciesEmoji(species: string | undefined | null): string {
  const s = (species || '').toLowerCase();
  if (s.includes('bee') || s.includes('wasp')) return '🐝';
  if (s.includes('horse')) return '🐴';
  return '🐾';
}

/**
 * Selectable breeds per normalized species, for the breed filter on every
 * surface (My Pets, Community, Breed). Single source of truth so the surfaces
 * can't offer divergent breed sets.
 */
export const BREEDS_BY_SPECIES: Record<string, Record<string, string>> = {
  beewasp: { Bee: 'Bee', Wasp: 'Wasp' },
  horse: HORSE_BREEDS,
};
