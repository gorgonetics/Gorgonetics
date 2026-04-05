// src/lib/services/nameParser.ts
import { HORSE_BREED_ABBREVIATIONS } from '$lib/types/index.js';
import { normalizeSpecies } from './configService.js';

export interface StructuredPetName {
  breed: string;
  gender: 'Male' | 'Female';
  attributes: Record<string, number>;
  label: string | null;
}

/**
 * Attribute order matching FALLBACK_ATTRIBUTE_LIST filtered to Horse.
 */
const HORSE_ATTRIBUTE_ORDER = [
  'temperament',
  'toughness',
  'ruggedness',
  'enthusiasm',
  'friendliness',
  'intelligence',
  'virility',
];

/**
 * Build a case-insensitive lookup from shortcode -> full breed name.
 */
const BREED_LOOKUP: Record<string, string> = Object.fromEntries(
  Object.entries(HORSE_BREED_ABBREVIATIONS).map(([abbr, fullName]) => [abbr.toLowerCase(), fullName]),
);

/**
 * Parse a structured pet name for Horse species.
 *
 * Format: <breed_shortcode> <M|F> <7 attribute values> [optional label...]
 *
 * Returns null if the name does not match the expected format.
 */
export function parseStructuredPetName(name: string, species: string): StructuredPetName | null {
  if (normalizeSpecies(species) !== 'horse') return null;

  const tokens = name.trim().split(/\s+/);
  if (tokens.length < 9) return null;

  // Token 1: breed shortcode
  const breedName = BREED_LOOKUP[tokens[0].toLowerCase()];
  if (!breedName) return null;

  // Token 2: gender
  const genderToken = tokens[1].toUpperCase();
  if (genderToken !== 'M' && genderToken !== 'F') return null;
  const gender: 'Male' | 'Female' = genderToken === 'M' ? 'Male' : 'Female';

  // Tokens 3-9: attribute values
  const attributes: Record<string, number> = {};
  for (let i = 0; i < HORSE_ATTRIBUTE_ORDER.length; i++) {
    const value = Number.parseInt(tokens[2 + i], 10);
    if (Number.isNaN(value)) return null;
    attributes[HORSE_ATTRIBUTE_ORDER[i]] = value;
  }

  // Remaining tokens: optional label
  const labelTokens = tokens.slice(9);
  const label = labelTokens.length > 0 ? labelTokens.join(' ') : null;

  return { breed: breedName, gender, attributes, label };
}
