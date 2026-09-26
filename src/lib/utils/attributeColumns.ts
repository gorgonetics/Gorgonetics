/**
 * Attribute columns for the species-agnostic pet tables — My Pets and the
 * Community catalogue — so both lay out attributes the same way.
 *
 * One column per stored attribute, labelled with the config's display name
 * (merged across the supported species). A cell is filled only when the
 * attribute applies to that row's species: Temperament for horses, Ferocity
 * for bees. Anything else reads as absent, never as a zero.
 *
 * In the order a structured pet name spells them (`nameParser`): each
 * species' own attribute, then the core attributes in their configured order.
 * Not the storage order in `ATTRIBUTE_KEYS`, which starts with Intelligence
 * and reads nothing like a name or the in-game stable.
 */

import {
  getAllAttributeNames,
  getAllAttributes,
  getCoreAttributeNames,
  getSpeciesAttributeNames,
  getSupportedSpecies,
} from '$lib/services/configService.js';
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
  const order: string[] = [];
  const add = (key: string) => {
    if (!order.includes(key)) order.push(key);
  };
  for (const species of getSupportedSpecies()) for (const key of getSpeciesAttributeNames(species)) add(key);
  for (const key of getCoreAttributeNames()) add(key);
  // A stored attribute the config does not place goes last, rather than out.
  for (const key of ATTRIBUTE_KEYS) add(key);
  const stored = new Set<string>(ATTRIBUTE_KEYS);
  return order.filter((key) => stored.has(key)).map((key) => ({ key, label: displayNames[key] ?? capitalize(key) }));
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
