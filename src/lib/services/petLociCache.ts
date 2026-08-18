/**
 * Bounded cache over `loadAllPetLoci` for the gene value filter (#369).
 *
 * The roster predicate is pure and synchronous; the loci are loaded once
 * per pet set and injected (design §7). Keyed on the **sorted id set**,
 * not array identity — a background reload of the pet list produces a
 * fresh array with the same members, and re-reading `pet_genes` on every
 * store settle would defeat the point. Same precedent as
 * `frequencyService`, including the small bounded cache.
 */

import type { PetLoci } from '$lib/utils/petLoci.js';
import { loadAllPetLoci } from '$lib/utils/petLoci.js';

const MAX_CACHED = 4;
const cache = new Map<string, Promise<Map<number, PetLoci>>>();

function cacheKey(petIds: readonly number[]): string {
  return [...petIds].sort((a, b) => a - b).join(',');
}

/** Drop every cached loci map. Call when pets are added, edited or removed. */
export function invalidatePetLociCache(): void {
  cache.clear();
}

/**
 * The `pet_genes` projection for `petIds`, cached. Pets with no projected
 * rows are omitted from the map (`map.has(id)` is the not-imported check
 * — §8). A failed load is evicted so the next call retries instead of
 * caching the rejection.
 */
export function getAllPetLociCached(petIds: readonly number[]): Promise<Map<number, PetLoci>> {
  const key = cacheKey(petIds);
  const existing = cache.get(key);
  if (existing) return existing;
  const promise = loadAllPetLoci(petIds).catch((err) => {
    if (cache.get(key) === promise) cache.delete(key);
    throw err;
  });
  cache.set(key, promise);
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return promise;
}
