import { normalizeSpecies } from '$lib/services/configService.js';
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

/**
 * A view's default species: the one with the most `pets` among `options`
 * (normalized keys). A player with 25 horses and 7 beewasps should land on
 * horses, not on the alphabetical first. Ties go to `options` order, and
 * with no pets at all the first option wins.
 *
 * Views derive this rather than assigning it at mount, because the pet list
 * lands well after mount and a mount-time pick would lock in the fallback.
 */
export function mostPopulatedSpecies(pets: readonly { species: string }[], options: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const p of pets) {
    const key = normalizeSpecies(p.species);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const key of options) {
    const count = counts.get(key) ?? 0;
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best || (options[0] ?? '');
}
