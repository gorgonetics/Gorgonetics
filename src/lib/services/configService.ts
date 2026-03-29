/**
 * Centralized attribute configuration for Gorgonetics.
 * Ported from Python: attribute_config.py
 *
 * All functions are synchronous — this is pure static configuration data.
 */

import type { AppearanceInfo, AttributeInfo } from '$lib/types/index.js';

// --- Core attribute order (matches game order) ---

const CORE_ATTRIBUTE_ORDER = ['toughness', 'ruggedness', 'enthusiasm', 'friendliness', 'intelligence', 'virility'];

// --- Core attributes shared by all species ---

const CORE_ATTRIBUTES: Record<string, { name: string; icon: string; default: number; description: string }> = {
  intelligence: {
    name: 'Intelligence',
    icon: '🧠',
    default: 50,
    description: 'Mental capacity and problem-solving ability',
  },
  toughness: {
    name: 'Toughness',
    icon: '💪',
    default: 50,
    description: 'Physical durability and resistance to damage',
  },
  friendliness: {
    name: 'Friendliness',
    icon: '😊',
    default: 50,
    description: 'Social disposition and approachability',
  },
  ruggedness: {
    name: 'Ruggedness',
    icon: '🏔️',
    default: 50,
    description: 'Ability to withstand harsh conditions',
  },
  enthusiasm: {
    name: 'Enthusiasm',
    icon: '✨',
    default: 50,
    description: 'Energy level and eagerness to engage',
  },
  virility: {
    name: 'Virility',
    icon: '💜',
    default: 50,
    description: 'Reproductive capability and vigor',
  },
};

// --- Species-specific additional attributes ---

const SPECIES_ATTRIBUTES: Record<
  string,
  Record<string, { name: string; icon: string; default: number; description: string }>
> = {
  beewasp: {
    ferocity: {
      name: 'Ferocity',
      icon: '🔥',
      default: 50,
      description: 'Aggressive tendencies and combat intensity',
    },
  },
  horse: {
    temperament: {
      name: 'Temperament',
      icon: '🐎',
      default: 50,
      description: 'Behavioral disposition and emotional stability',
    },
  },
};

// --- Species appearance attributes ---

const SPECIES_APPEARANCE_ATTRIBUTES: Record<
  string,
  Record<string, { name: string; examples: string; color_indicator: string }>
> = {
  beewasp: {
    'body-color-hue': {
      name: 'Body Color Hue',
      examples: 'Color tone',
      color_indicator: 'linear-gradient(45deg, #ff6b6b, #4ecdc4, #45b7d1)',
    },
    'body-color-saturation': {
      name: 'Body Color Saturation',
      examples: 'Color intensity',
      color_indicator: 'linear-gradient(90deg, #f8f9fa, #ff6b6b)',
    },
    'body-color-intensity': {
      name: 'Body Color Intensity',
      examples: 'Brightness',
      color_indicator: 'linear-gradient(90deg, #343a40, #f8f9fa)',
    },
    'wing-color-hue': {
      name: 'Wing Color Hue',
      examples: 'Wing tone',
      color_indicator: 'linear-gradient(45deg, #ffd93d, #6bcf7f, #4d72aa)',
    },
    'wing-color-saturation': {
      name: 'Wing Color Saturation',
      examples: 'Wing intensity',
      color_indicator: 'linear-gradient(90deg, #e9ecef, #ffd93d)',
    },
    'wing-color-intensity': {
      name: 'Wing Color Intensity',
      examples: 'Wing brightness',
      color_indicator: 'linear-gradient(90deg, #495057, #fff3cd)',
    },
    'body-scale': { name: 'Body Scale', examples: 'Body size', color_indicator: '#8b5cf6' },
    'wing-scale': { name: 'Wing Scale', examples: 'Wing size', color_indicator: '#06b6d4' },
    'head-scale': { name: 'Head Scale', examples: 'Head size', color_indicator: '#f59e0b' },
    'tail-scale': { name: 'Tail Scale', examples: 'Tail size', color_indicator: '#84cc16' },
    'antenna-scale': { name: 'Antenna Scale', examples: 'Antenna size', color_indicator: '#ec4899' },
    'leg-deformity': { name: 'Leg Deformity', examples: 'Leg shape', color_indicator: '#ef4444' },
    'antenna-deformity': { name: 'Antenna Deformity', examples: 'Antenna shape', color_indicator: '#f97316' },
    particles: {
      name: 'Particles',
      examples: 'Special effects',
      color_indicator: 'radial-gradient(circle, #fbbf24, #f59e0b)',
    },
    'particle-location': {
      name: 'Particle Location',
      examples: 'Effect position',
      color_indicator: 'conic-gradient(#8b5cf6, #ec4899, #06b6d4, #8b5cf6)',
    },
    glow: {
      name: 'Glow',
      examples: 'Luminescence',
      color_indicator: 'radial-gradient(circle, #fef3c7, #f59e0b)',
    },
  },
  horse: {
    attributes: { name: 'Attributes', examples: 'Attributes effects (all breeds)', color_indicator: '#e74c3c' },
    aura: { name: 'Aura', examples: 'Aura effects', color_indicator: '#3498db' },
    coat: { name: 'Coat', examples: 'Coat effects (all breeds)', color_indicator: '#2ecc71' },
    'face-markings': { name: 'Face Markings', examples: 'Face Markings effects', color_indicator: '#f39c12' },
    hair: { name: 'Hair', examples: 'Hair effects', color_indicator: '#9b59b6' },
    horn: { name: 'Horn', examples: 'Horn effects (all breeds)', color_indicator: '#1abc9c' },
    'leg-markings': { name: 'Leg Markings', examples: 'Leg Markings effects', color_indicator: '#34495e' },
    magical: { name: 'Magical', examples: 'Magical effects', color_indicator: '#e67e22' },
    markings: { name: 'Markings', examples: 'Markings effects (all breeds)', color_indicator: '#16a085' },
    scale: { name: 'Scale', examples: 'Scale effects (all breeds)', color_indicator: '#2980b9' },
    selector: { name: 'Selector', examples: 'Selector effects (all breeds)', color_indicator: '#8e44ad' },
  },
};

// --- Species name mappings ---

const SPECIES_MAPPINGS: Record<string, string[]> = {
  beewasp: ['beewasp', 'bee', 'wasp'],
  horse: ['horse'],
};

// --- Public API ---

/**
 * Normalize a species name to its canonical form.
 */
export function normalizeSpecies(species: string): string {
  if (!species) return '';
  const lower = species.toLowerCase();
  for (const [normalized, variants] of Object.entries(SPECIES_MAPPINGS)) {
    for (const variant of variants) {
      if (lower.includes(variant)) return normalized;
    }
  }
  return '';
}

/**
 * Get ordered list of core attribute names.
 */
export function getCoreAttributeNames(): string[] {
  return CORE_ATTRIBUTE_ORDER.filter((attr) => attr in CORE_ATTRIBUTES);
}

/**
 * Get core attributes configuration.
 */
export function getCoreAttributes() {
  return { ...CORE_ATTRIBUTES };
}

/**
 * Get species-specific attribute names.
 */
export function getSpeciesAttributeNames(species: string): string[] {
  const normalized = normalizeSpecies(species);
  return normalized in SPECIES_ATTRIBUTES ? Object.keys(SPECIES_ATTRIBUTES[normalized]) : [];
}

/**
 * Get species-specific attributes configuration.
 */
export function getSpeciesAttributes(species: string) {
  const normalized = normalizeSpecies(species);
  return normalized in SPECIES_ATTRIBUTES ? { ...SPECIES_ATTRIBUTES[normalized] } : {};
}

/**
 * Get all attribute names for a species (core + species-specific).
 */
export function getAllAttributeNames(species: string): string[] {
  return [...getCoreAttributeNames(), ...getSpeciesAttributeNames(species)];
}

/**
 * Get all attributes for a species (core + species-specific).
 */
export function getAllAttributes(species: string) {
  return { ...CORE_ATTRIBUTES, ...getSpeciesAttributes(species) };
}

/**
 * Get default attribute values for a species.
 */
export function getDefaultValues(species: string): Record<string, number> {
  const allAttrs = getAllAttributes(species);
  const defaults: Record<string, number> = {};
  for (const [name, info] of Object.entries(allAttrs)) {
    defaults[name] = info.default;
  }
  return defaults;
}

/**
 * Get attribute display info for frontend use.
 * Returns the same shape as the old Python /api/attribute-config/{species} endpoint.
 */
export function getAttributeConfig(species: string): {
  species: string;
  attributes: AttributeInfo[];
  all_attribute_names: string[];
  core_attributes: string[];
  species_attributes: string[];
} {
  const normalized = normalizeSpecies(species);
  const allAttrs = getAllAttributes(species);
  const attributes = Object.entries(allAttrs).map(([name, info]) => ({
    key: name.charAt(0).toUpperCase() + name.slice(1),
    name: info.name,
    icon: info.icon,
    description: info.description ?? '',
  }));

  return {
    species: normalized,
    attributes,
    all_attribute_names: getAllAttributeNames(species),
    core_attributes: getCoreAttributeNames(),
    species_attributes: getSpeciesAttributeNames(species),
  };
}

/**
 * Get all possible gene effect options.
 */
export function getEffectOptions(): string[] {
  const effects = ['None'];

  for (const info of Object.values(CORE_ATTRIBUTES)) {
    effects.push(`${info.name}+`, `${info.name}-`);
  }
  for (const speciesAttrs of Object.values(SPECIES_ATTRIBUTES)) {
    for (const info of Object.values(speciesAttrs)) {
      effects.push(`${info.name}+`, `${info.name}-`);
    }
  }

  return effects.sort();
}

/**
 * Get gene effect options for a specific species.
 */
export function getEffectOptionsForSpecies(species: string): string[] {
  const effects = ['None'];
  const allAttrs = getAllAttributes(species);

  for (const info of Object.values(allAttrs)) {
    effects.push(`${info.name}+`, `${info.name}-`);
  }

  return effects.sort();
}

/**
 * Get appearance attribute names for a species.
 */
export function getAppearanceAttributeNames(species: string): string[] {
  const normalized = normalizeSpecies(species);
  return normalized in SPECIES_APPEARANCE_ATTRIBUTES ? Object.keys(SPECIES_APPEARANCE_ATTRIBUTES[normalized]) : [];
}

/**
 * Get appearance attributes configuration for a species.
 */
export function getAppearanceAttributes(species: string) {
  const normalized = normalizeSpecies(species);
  return normalized in SPECIES_APPEARANCE_ATTRIBUTES ? { ...SPECIES_APPEARANCE_ATTRIBUTES[normalized] } : {};
}

/**
 * Get appearance display info for frontend use.
 * Returns the same shape as the old Python /api/appearance-config/{species} endpoint.
 */
export function getAppearanceConfig(species: string): {
  species: string;
  appearance_attributes: AppearanceInfo[];
  appearance_attribute_names: string[];
} {
  const normalized = normalizeSpecies(species);
  const attrs = getAppearanceAttributes(species);
  const appearance_attributes = Object.entries(attrs).map(([name, info]) => ({
    key: name.replace(/-/g, '_'),
    name: info.name,
    examples: info.examples,
    color_indicator: info.color_indicator ?? '#6b7280',
  }));

  return {
    species: normalized,
    appearance_attributes,
    appearance_attribute_names: getAppearanceAttributeNames(species),
  };
}

/**
 * Check if an attribute is valid for a species.
 */
export function isValidAttribute(attributeName: string, species: string): boolean {
  return getAllAttributeNames(species)
    .map((a) => a.toLowerCase())
    .includes(attributeName.toLowerCase());
}

/**
 * Check if an appearance attribute is valid for a species.
 */
export function isValidAppearanceAttribute(attributeName: string, species: string): boolean {
  return getAppearanceAttributeNames(species)
    .map((a) => a.toLowerCase())
    .includes(attributeName.toLowerCase());
}

/**
 * Get all supported species names.
 */
export function getSupportedSpecies(): string[] {
  return Object.keys(SPECIES_ATTRIBUTES);
}

/**
 * Get all possible database column names for attributes.
 */
export function getDatabaseColumns(): Set<string> {
  const columns = new Set(getCoreAttributeNames());
  for (const speciesAttrs of Object.values(SPECIES_ATTRIBUTES)) {
    for (const key of Object.keys(speciesAttrs)) {
      columns.add(key);
    }
  }
  return columns;
}

/**
 * Validate an attribute dictionary and return any errors.
 */
export function validateAttributeDict(attributes: Record<string, unknown>, species: string): Record<string, string> {
  const errors: Record<string, string> = {};
  const validAttrs = getAllAttributeNames(species).map((a) => a.toLowerCase());

  for (const [attrName, value] of Object.entries(attributes)) {
    if (!validAttrs.includes(attrName.toLowerCase())) {
      errors[attrName] = `Invalid attribute '${attrName}' for species '${species}'`;
      continue;
    }
    if (typeof value !== 'number' || Number.isNaN(value)) {
      errors[attrName] = `Attribute '${attrName}' must be a numeric value`;
    }
  }

  return errors;
}
