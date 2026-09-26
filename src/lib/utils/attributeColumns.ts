/**
 * Attribute columns for the species-agnostic pet tables — My Pets and the
 * Community catalogue — so both lay out attributes the same way.
 *
 * One column per stored attribute, in wire order, labelled with the config's
 * display name (merged across the supported species). A cell is filled only
 * when the attribute applies to that row's species: Temperament for horses,
 * Ferocity for bees. Anything else reads as absent, never as a zero.
 */

import { getAllAttributeNames, getAllAttributes, getSupportedSpecies } from '$lib/services/configService.js';
import { ATTRIBUTE_KEYS } from '$lib/utils/sharedPet.js';
import { capitalize } from '$lib/utils/string.js';

export interface AttributeColumn {
  key: string;
  label: string;
}

export const ATTRIBUTE_COLUMNS: readonly AttributeColumn[] = (() => {
  const displayNames: Record<string, string> = {};
  for (const species of getSupportedSpecies()) {
    for (const [key, info] of Object.entries(getAllAttributes(species) as Record<string, { name?: string }>)) {
      displayNames[key] ??= info.name ?? capitalize(key);
    }
  }
  return ATTRIBUTE_KEYS.map((key) => ({ key, label: displayNames[key] ?? capitalize(key) }));
})();

// Which attributes apply to a species, cached per species string so a table
// does not recompute it for every cell.
const bySpecies = new Map<string, Set<string>>();

/** Whether `key` is one of `species`'s attributes. */
export function attributeApplies(species: string, key: string): boolean {
  let set = bySpecies.get(species);
  if (!set) {
    set = new Set(getAllAttributeNames(species).map((a) => a.toLowerCase()));
    bySpecies.set(species, set);
  }
  return set.has(key);
}
