import { Gender, HORSE_BREED_ABBREVIATIONS } from '$lib/types/index.js';
import { getCoreAttributeNames, getSpeciesAttributeNames, normalizeSpecies } from './configService.js';

export interface StructuredPetName {
  breed: string;
  gender: Gender;
  attributes: Record<string, number>;
  label: string | null;
}

/**
 * One species' structured-name rule.
 *
 * Attribute order matches FALLBACK_ATTRIBUTE_LIST filtered to the species:
 * species-specific attributes first, then core attributes.
 */
interface NameRule {
  attributeOrder: readonly string[];
  /** Full breed name for the first token, or `null` when it is not a known code. */
  breedOf(token: string): string | null;
}

const HORSE_BREED_LOOKUP: Record<string, string> = Object.fromEntries(
  Object.entries(HORSE_BREED_ABBREVIATIONS).map(([abbr, fullName]) => [abbr.toLowerCase(), fullName]),
);

const RULES: Record<string, NameRule> = {
  horse: {
    attributeOrder: [...getSpeciesAttributeNames('horse'), ...getCoreAttributeNames()],
    breedOf: (token) => HORSE_BREED_LOOKUP[token.toLowerCase()] ?? null,
  },
  // Beewasps have no breeds. The first token keeps the horse layout so one
  // naming habit works for both species, but its value is not read.
  beewasp: {
    attributeOrder: [...getSpeciesAttributeNames('beewasp'), ...getCoreAttributeNames()],
    breedOf: () => '',
  },
};

/**
 * Parse a structured pet name.
 *
 * Format: <breed_shortcode> <M|F> <attribute values...> [optional label...]
 *
 * For a beewasp the first token is required but ignored, and the breed comes
 * back as ''. Breed code and gender match case-insensitively.
 *
 * Returns null if the name does not match the expected format, or the
 * species has no rule.
 */
export function parseStructuredPetName(name: string, species: string): StructuredPetName | null {
  const rule = RULES[normalizeSpecies(species)];
  if (!rule) return null;
  const order = rule.attributeOrder;
  const minTokens = 2 + order.length; // breed + gender + attributes

  const tokens = name.trim().split(/\s+/);
  if (tokens.length < minTokens) return null;

  const breedName = rule.breedOf(tokens[0]);
  if (breedName === null) return null;

  const genderToken = tokens[1].toUpperCase();
  if (genderToken !== 'M' && genderToken !== 'F') return null;
  const gender: Gender = genderToken === 'M' ? Gender.MALE : Gender.FEMALE;

  const attributes: Record<string, number> = {};
  for (let i = 0; i < order.length; i++) {
    const token = tokens[2 + i];
    if (!/^\d+$/.test(token)) return null;
    const value = Number.parseInt(token, 10);
    if (value > 100) return null;
    attributes[order[i]] = value;
  }

  const labelTokens = tokens.slice(minTokens);
  const label = labelTokens.length > 0 ? labelTokens.join(' ') : null;

  return { breed: breedName, gender, attributes, label };
}
