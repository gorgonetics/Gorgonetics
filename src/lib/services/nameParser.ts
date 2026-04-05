import { Gender, HORSE_BREED_ABBREVIATIONS } from '$lib/types/index.js';
import { getCoreAttributeNames, getSpeciesAttributeNames, normalizeSpecies } from './configService.js';

export interface StructuredPetName {
  breed: string;
  gender: Gender;
  attributes: Record<string, number>;
  label: string | null;
}

/**
 * Attribute order matching FALLBACK_ATTRIBUTE_LIST filtered to Horse:
 * species-specific attributes first, then core attributes.
 */
const HORSE_ATTRIBUTE_ORDER = [...getSpeciesAttributeNames('horse'), ...getCoreAttributeNames()];

const MIN_TOKENS = 2 + HORSE_ATTRIBUTE_ORDER.length; // breed + gender + attributes

const BREED_LOOKUP: Record<string, string> = Object.fromEntries(
  Object.entries(HORSE_BREED_ABBREVIATIONS).map(([abbr, fullName]) => [abbr.toLowerCase(), fullName]),
);

/**
 * Parse a structured pet name for Horse species.
 *
 * Format: <breed_shortcode> <M|F> <attribute values...> [optional label...]
 *
 * Returns null if the name does not match the expected format.
 */
export function parseStructuredPetName(name: string, species: string): StructuredPetName | null {
  if (normalizeSpecies(species) !== 'horse') return null;

  const tokens = name.trim().split(/\s+/);
  if (tokens.length < MIN_TOKENS) return null;

  const breedName = BREED_LOOKUP[tokens[0].toLowerCase()];
  if (!breedName) return null;

  const genderToken = tokens[1].toUpperCase();
  if (genderToken !== 'M' && genderToken !== 'F') return null;
  const gender: Gender = genderToken === 'M' ? Gender.MALE : Gender.FEMALE;

  const attributes: Record<string, number> = {};
  for (let i = 0; i < HORSE_ATTRIBUTE_ORDER.length; i++) {
    const token = tokens[2 + i];
    if (!/^-?\d+$/.test(token)) return null;
    const value = Number.parseInt(token, 10);
    attributes[HORSE_ATTRIBUTE_ORDER[i]] = value;
  }

  const labelTokens = tokens.slice(MIN_TOKENS);
  const label = labelTokens.length > 0 ? labelTokens.join(' ') : null;

  return { breed: breedName, gender, attributes, label };
}
