import { describe, expect, it } from 'vitest';
import { mostPopulatedSpecies } from '$lib/utils/species.js';

const pets = (...species: string[]) => species.map((s) => ({ species: s }));

describe('mostPopulatedSpecies', () => {
  it('picks the species with the most pets, whatever its spelling', () => {
    expect(mostPopulatedSpecies(pets('BeeWasp', 'Horse', 'horse'), ['beewasp', 'horse'])).toBe('horse');
  });

  it('breaks ties by option order', () => {
    expect(mostPopulatedSpecies(pets('Horse', 'BeeWasp'), ['beewasp', 'horse'])).toBe('beewasp');
    expect(mostPopulatedSpecies(pets('Horse', 'BeeWasp'), ['horse', 'beewasp'])).toBe('horse');
  });

  it('ignores species that are not options', () => {
    expect(mostPopulatedSpecies(pets('BeeWasp', 'BeeWasp', 'Horse'), ['horse'])).toBe('horse');
  });

  it('falls back to the first option, or to empty with no options', () => {
    expect(mostPopulatedSpecies([], ['beewasp', 'horse'])).toBe('beewasp');
    expect(mostPopulatedSpecies(pets('Horse'), [])).toBe('');
  });
});
