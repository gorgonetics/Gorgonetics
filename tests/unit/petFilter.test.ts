import { describe, expect, it } from 'vitest';
import type { GeneType, Pet } from '$lib/types/index.js';
import type { GeneCriterion } from '$lib/utils/geneCriteria.js';
import { filterPets, petMatchesFilters } from '$lib/utils/petFilter.js';
import type { PetLoci } from '$lib/utils/petLoci.js';

// Minimal pet fixtures — only the fields the filter reads.
const pet = (over: Partial<Pet> = {}): Pet =>
  ({
    name: 'Bessie',
    species: 'Horse',
    tags: [],
    starred: false,
    stabled: false,
    ...over,
  }) as unknown as Pet;

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

describe('petMatchesFilters — Library criteria (species / breed / pet-quality)', () => {
  it('matches normalized species; "" means all', () => {
    expect(petMatchesFilters(pet({ species: 'Horse' }), { ...noFilters, species: 'horse' })).toBe(true);
    expect(petMatchesFilters(pet({ species: 'BeeWasp' }), { ...noFilters, species: 'horse' })).toBe(false);
    expect(petMatchesFilters(pet({ species: 'BeeWasp' }), { ...noFilters, species: '' })).toBe(true);
  });

  it('matches breed exactly; "" means all', () => {
    expect(petMatchesFilters(pet({ breed: 'Standardbred' }), { ...noFilters, breed: 'Standardbred' })).toBe(true);
    expect(petMatchesFilters(pet({ breed: 'Kurbone' }), { ...noFilters, breed: 'Standardbred' })).toBe(false);
    expect(petMatchesFilters(pet({ breed: 'Kurbone' }), { ...noFilters, breed: '' })).toBe(true);
  });

  it('petQualityOnly requires is_pet_quality', () => {
    expect(petMatchesFilters(pet({ is_pet_quality: true }), { ...noFilters, petQualityOnly: true })).toBe(true);
    expect(petMatchesFilters(pet({ is_pet_quality: false }), { ...noFilters, petQualityOnly: true })).toBe(false);
  });

  it('matches gender exactly; "" means all', () => {
    expect(petMatchesFilters(pet({ gender: 'Male' }), { ...noFilters, gender: 'Male' })).toBe(true);
    expect(petMatchesFilters(pet({ gender: 'Female' }), { ...noFilters, gender: 'Male' })).toBe(false);
    expect(petMatchesFilters(pet({ gender: 'Female' }), { ...noFilters, gender: '' })).toBe(true);
  });

  it('combines new criteria with the existing ones (AND)', () => {
    const matching = pet({
      name: 'Dusty',
      species: 'Horse',
      breed: 'Standardbred',
      is_pet_quality: true,
      stabled: true,
    });
    const wrongBreed = pet({ name: 'Pip', species: 'Horse', breed: 'Kurbone', is_pet_quality: true, stabled: true });
    const result = filterPets([matching, wrongBreed], {
      ...noFilters,
      species: 'horse',
      breed: 'Standardbred',
      petQualityOnly: true,
      stabledOnly: true,
    });
    expect(result.map((p) => p.name)).toEqual(['Dusty']);
  });
});

describe('petMatchesFilters — gene filter (design §5c/§7/§8)', () => {
  const geneFilter = {
    species: 'horse',
    criteria: [{ kind: 'locus', geneId: '01A1', allow: ['R', 'x'] }] as GeneCriterion[],
  };
  const horse = (id: number) => pet({ id, species: 'Horse' } as Partial<Pet>);
  const lociMap = new Map<number, PetLoci>([
    [1, new Map([['01A1', 'R' as GeneType]])],
    [2, new Map([['01A1', 'D' as GeneType]])],
    [3, new Map([['01A1', '?' as GeneType]])],
    // 4 deliberately absent — not imported (§8).
  ]);

  it('applies criteria only when the loci map has loaded (§7 loading rule)', () => {
    expect(petMatchesFilters(horse(2), { ...noFilters, geneFilter })).toBe(true);
    expect(petMatchesFilters(horse(2), { ...noFilters, geneFilter }, lociMap)).toBe(false);
  });

  it('narrows to satisfying pets; ? and not-imported fail (§3/§8)', () => {
    const result = filterPets([horse(1), horse(2), horse(3), horse(4)], { ...noFilters, geneFilter }, lociMap);
    expect(result.map((p) => p.id)).toEqual([1]);
  });

  it('a pet of another species never evaluates against the criteria (§5c)', () => {
    const wasp = pet({ id: 1, species: 'Beewasp' } as Partial<Pet>);
    expect(petMatchesFilters(wasp, { ...noFilters, geneFilter }, lociMap)).toBe(false);
  });

  it('an empty criteria list filters nothing', () => {
    const none = { species: 'horse', criteria: [] };
    expect(petMatchesFilters(horse(4), { ...noFilters, geneFilter: none }, lociMap)).toBe(true);
  });

  it('composes with the other filters (AND)', () => {
    const starredMatch = pet({ id: 1, species: 'Horse', starred: true } as Partial<Pet>);
    const unstarredMatch = pet({ id: 5, species: 'Horse', starred: false } as Partial<Pet>);
    const map = new Map<number, PetLoci>([
      [1, new Map([['01A1', 'x' as GeneType]])],
      [5, new Map([['01A1', 'x' as GeneType]])],
    ]);
    const result = filterPets([starredMatch, unstarredMatch], { ...noFilters, starredOnly: true, geneFilter }, map);
    expect(result.map((p) => p.id)).toEqual([1]);
  });
});
