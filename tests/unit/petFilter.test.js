import { describe, expect, it } from 'vitest';
import { filterPets, petMatchesFilters } from '$lib/utils/petFilter.js';

// Minimal pet fixtures — only the fields the filter reads.
const pet = (over = {}) => ({
  name: 'Bessie',
  species: 'Horse',
  tags: [],
  starred: false,
  stabled: false,
  ...over,
});

const noFilters = { query: '', tags: [], starredOnly: false, stabledOnly: false };

describe('petMatchesFilters — search', () => {
  it('matches name case-insensitively', () => {
    expect(petMatchesFilters(pet({ name: 'Bessie' }), { ...noFilters, query: 'bess' })).toBe(true);
  });

  it('matches species case-insensitively', () => {
    expect(petMatchesFilters(pet({ species: 'Beewasp' }), { ...noFilters, query: 'BEE' })).toBe(true);
  });

  it('rejects when neither name nor species matches', () => {
    expect(petMatchesFilters(pet({ name: 'Bessie', species: 'Horse' }), { ...noFilters, query: 'wasp' })).toBe(false);
  });

  it('tolerates missing name/species', () => {
    expect(petMatchesFilters(pet({ name: '', species: '' }), { ...noFilters, query: 'x' })).toBe(false);
    expect(petMatchesFilters(pet({ name: '', species: '' }), noFilters)).toBe(true);
  });
});

describe('petMatchesFilters — tags', () => {
  it('requires ALL selected tags to be present (AND semantics)', () => {
    const p = pet({ tags: ['foal', 'fast'] });
    expect(petMatchesFilters(p, { ...noFilters, tags: ['foal'] })).toBe(true);
    expect(petMatchesFilters(p, { ...noFilters, tags: ['foal', 'fast'] })).toBe(true);
    expect(petMatchesFilters(p, { ...noFilters, tags: ['foal', 'slow'] })).toBe(false);
  });

  it('treats a tagless pet as failing any tag filter', () => {
    expect(petMatchesFilters(pet({ tags: undefined }), { ...noFilters, tags: ['foal'] })).toBe(false);
  });
});

describe('petMatchesFilters — starred / stabled gates', () => {
  it('hides non-starred pets when starredOnly is on', () => {
    expect(petMatchesFilters(pet({ starred: false }), { ...noFilters, starredOnly: true })).toBe(false);
    expect(petMatchesFilters(pet({ starred: true }), { ...noFilters, starredOnly: true })).toBe(true);
  });

  it('hides non-stabled pets when stabledOnly is on', () => {
    expect(petMatchesFilters(pet({ stabled: false }), { ...noFilters, stabledOnly: true })).toBe(false);
    expect(petMatchesFilters(pet({ stabled: true }), { ...noFilters, stabledOnly: true })).toBe(true);
  });
});

describe('petMatchesFilters — combined', () => {
  it('requires every active filter to pass', () => {
    const p = pet({ name: 'Bessie', tags: ['foal'], starred: true, stabled: true });
    expect(petMatchesFilters(p, { query: 'bess', tags: ['foal'], starredOnly: true, stabledOnly: true })).toBe(true);
    // One failing condition (wrong tag) fails the whole predicate.
    expect(petMatchesFilters(p, { query: 'bess', tags: ['adult'], starredOnly: true, stabledOnly: true })).toBe(false);
  });

  it('passes everything when no filters are active', () => {
    expect(petMatchesFilters(pet(), noFilters)).toBe(true);
  });
});

describe('filterPets', () => {
  it('returns matching pets in original order without mutating the input', () => {
    const pets = [
      pet({ name: 'Bessie', stabled: true }),
      pet({ name: 'Comet', stabled: false }),
      pet({ name: 'Daisy', stabled: true }),
    ];
    const input = [...pets];
    const result = filterPets(pets, { ...noFilters, stabledOnly: true });
    expect(result.map((p) => p.name)).toEqual(['Bessie', 'Daisy']);
    expect(pets).toEqual(input);
  });
});
