import { describe, expect, it } from 'vitest';
import {
  getAllAttributeNames,
  getAppearanceAttributeNames,
  getAppearanceConfig,
  getAttributeConfig,
  getAttributeMatcher,
  getCoreAttributeNames,
  getDatabaseColumns,
  getDefaultValues,
  getEffectOptions,
  getEffectOptionsForSpecies,
  getSupportedSpecies,
  isValidAppearanceAttribute,
  isValidAttribute,
  normalizeSpecies,
  validateAttributeDict,
} from '$lib/services/configService.js';

describe('normalizeSpecies', () => {
  it('normalizes "BeeWasp" to "beewasp"', () => {
    expect(normalizeSpecies('BeeWasp')).toBe('beewasp');
  });

  it('normalizes "Horse" to "horse"', () => {
    expect(normalizeSpecies('Horse')).toBe('horse');
  });

  it('normalizes partial matches', () => {
    expect(normalizeSpecies('bee')).toBe('beewasp');
    expect(normalizeSpecies('wasp')).toBe('beewasp');
  });

  it('returns empty string for unknown species', () => {
    expect(normalizeSpecies('dragon')).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeSpecies('')).toBe('');
  });
});

describe('getCoreAttributeNames', () => {
  it('returns 6 core attributes in game order', () => {
    const names = getCoreAttributeNames();
    expect(names).toHaveLength(6);
    expect(names).toContain('toughness');
    expect(names).toContain('intelligence');
    expect(names).toContain('virility');
  });
});

describe('getAllAttributeNames', () => {
  it('includes species-specific attributes for beewasp', () => {
    const names = getAllAttributeNames('beewasp');
    expect(names).toContain('ferocity');
    expect(names).not.toContain('temperament');
  });

  it('includes species-specific attributes for horse', () => {
    const names = getAllAttributeNames('horse');
    expect(names).toContain('temperament');
    expect(names).not.toContain('ferocity');
  });
});

describe('getDefaultValues', () => {
  it('returns 50 for all attributes', () => {
    const defaults = getDefaultValues('beewasp');
    expect(defaults.toughness).toBe(50);
    expect(defaults.ferocity).toBe(50);
  });
});

describe('getAttributeConfig', () => {
  it('returns species, attributes, and all_attribute_names', () => {
    const config = getAttributeConfig('beewasp');
    expect(config.species).toBe('beewasp');
    expect(config.attributes).toBeInstanceOf(Array);
    expect(config.all_attribute_names).toBeInstanceOf(Array);
    expect(config.core_attributes).toBeInstanceOf(Array);
    expect(config.species_attributes).toBeInstanceOf(Array);
  });

  it('attributes have key, name, icon, description', () => {
    const config = getAttributeConfig('horse');
    const attr = config.attributes[0];
    expect(attr).toHaveProperty('key');
    expect(attr).toHaveProperty('name');
    expect(attr).toHaveProperty('icon');
    expect(attr).toHaveProperty('description');
  });
});

describe('getEffectOptions', () => {
  it('includes None', () => {
    const options = getEffectOptions();
    expect(options).toContain('None');
  });

  it('includes positive and negative variants', () => {
    const options = getEffectOptions();
    expect(options).toContain('Toughness+');
    expect(options).toContain('Toughness-');
  });

  it('is sorted', () => {
    const options = getEffectOptions();
    const sorted = [...options].sort();
    expect(options).toEqual(sorted);
  });
});

describe('getEffectOptionsForSpecies', () => {
  it('includes species-specific effects for beewasp', () => {
    const options = getEffectOptionsForSpecies('beewasp');
    expect(options).toContain('Ferocity+');
    expect(options).not.toContain('Temperament+');
  });

  it('includes species-specific effects for horse', () => {
    const options = getEffectOptionsForSpecies('horse');
    expect(options).toContain('Temperament+');
    expect(options).not.toContain('Ferocity+');
  });
});

describe('getAppearanceConfig', () => {
  it('returns appearance attributes for beewasp', () => {
    const config = getAppearanceConfig('beewasp');
    expect(config.appearance_attributes.length).toBeGreaterThan(0);
    expect(config.appearance_attribute_names.length).toBeGreaterThan(0);
  });

  it('appearance attrs have key, name, examples, color_indicator', () => {
    const config = getAppearanceConfig('beewasp');
    const attr = config.appearance_attributes[0];
    expect(attr).toHaveProperty('key');
    expect(attr).toHaveProperty('name');
    expect(attr).toHaveProperty('examples');
    expect(attr).toHaveProperty('color_indicator');
  });
});

describe('getAppearanceAttributeNames', () => {
  it('returns beewasp appearance attributes', () => {
    const names = getAppearanceAttributeNames('beewasp');
    expect(names).toContain('body-color-hue');
    expect(names).toContain('glow');
  });

  it('returns horse appearance attributes', () => {
    const names = getAppearanceAttributeNames('horse');
    expect(names).toContain('coat');
    expect(names).toContain('horn');
  });
});

describe('isValidAttribute', () => {
  it('validates core attributes', () => {
    expect(isValidAttribute('toughness', 'beewasp')).toBe(true);
  });

  it('validates species-specific attributes', () => {
    expect(isValidAttribute('ferocity', 'beewasp')).toBe(true);
    expect(isValidAttribute('ferocity', 'horse')).toBe(false);
  });

  it('rejects unknown attributes', () => {
    expect(isValidAttribute('magic', 'beewasp')).toBe(false);
  });
});

describe('isValidAppearanceAttribute', () => {
  it('validates beewasp appearance', () => {
    expect(isValidAppearanceAttribute('body-color-hue', 'beewasp')).toBe(true);
    expect(isValidAppearanceAttribute('coat', 'beewasp')).toBe(false);
  });

  it('validates horse appearance', () => {
    expect(isValidAppearanceAttribute('coat', 'horse')).toBe(true);
    expect(isValidAppearanceAttribute('glow', 'horse')).toBe(false);
  });
});

describe('getSupportedSpecies', () => {
  it('returns beewasp and horse', () => {
    const species = getSupportedSpecies();
    expect(species).toContain('beewasp');
    expect(species).toContain('horse');
  });
});

describe('getDatabaseColumns', () => {
  it('includes all core + species attributes', () => {
    const cols = getDatabaseColumns();
    expect(cols.has('toughness')).toBe(true);
    expect(cols.has('ferocity')).toBe(true);
    expect(cols.has('temperament')).toBe(true);
  });
});

describe('validateAttributeDict', () => {
  it('returns no errors for valid attributes', () => {
    const errors = validateAttributeDict({ toughness: 50 }, 'beewasp');
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it('returns error for invalid attribute name', () => {
    const errors = validateAttributeDict({ magic: 50 }, 'beewasp');
    expect(errors.magic).toBeDefined();
  });

  it('returns error for non-numeric value', () => {
    const errors = validateAttributeDict({ toughness: 'abc' }, 'beewasp');
    expect(errors.toughness).toBeDefined();
  });
});

describe('getAttributeMatcher', () => {
  it('returns the cached instance on repeat lookups', () => {
    const a = getAttributeMatcher('beewasp');
    const b = getAttributeMatcher('beewasp');
    expect(a).toBe(b);
  });

  it('keeps separate matchers per species', () => {
    const bee = getAttributeMatcher('beewasp');
    const horse = getAttributeMatcher('horse');
    expect(bee).not.toBe(horse);
    expect(bee.names).toContain('Ferocity');
    expect(bee.names).not.toContain('Temperament');
    expect(horse.names).toContain('Temperament');
    expect(horse.names).not.toContain('Ferocity');
  });

  it('finds the attribute named in a single-attribute effect', () => {
    const { regex } = getAttributeMatcher('beewasp');
    regex.lastIndex = 0;
    expect(regex.exec('Intelligence+')?.[0]).toBe('Intelligence');
    regex.lastIndex = 0;
    expect(regex.exec('Toughness-')?.[0]).toBe('Toughness');
  });

  it('returns all attributes named in a multi-attribute effect', () => {
    const { regex } = getAttributeMatcher('beewasp');
    regex.lastIndex = 0;
    const matches = 'Intelligence+ Toughness-'.match(regex);
    expect(matches).toEqual(['Intelligence', 'Toughness']);
  });

  it('returns null match for an empty / no-effect string', () => {
    const { regex } = getAttributeMatcher('beewasp');
    regex.lastIndex = 0;
    expect(regex.exec('')).toBeNull();
    regex.lastIndex = 0;
    expect(regex.exec('None')).toBeNull();
  });
});
