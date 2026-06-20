import { describe, expect, it } from 'vitest';
import type { Pet } from '$lib/types/index.js';
import { computePetChanges, type PetEditDraft } from '$lib/utils/petChanges.js';

// Stored pet fixture — only the fields the diff reads.
const pet = (over: Record<string, unknown> = {}): Pet =>
  ({
    name: 'Bessie',
    gender: 'Female',
    breed: 'Standardbred',
    tags: ['foal'],
    intelligence: 50,
    toughness: 60,
    starred: false,
    stabled: false,
    is_pet_quality: false,
    ...over,
  }) as unknown as Pet;

// Draft mirroring the stored pet — overlay deltas per test.
const draft = (over: Partial<PetEditDraft> = {}): PetEditDraft =>
  ({
    name: 'Bessie',
    gender: 'Female',
    breed: 'Standardbred',
    attributes: { intelligence: 50, toughness: 60 },
    tags: ['foal'],
    starred: false,
    stabled: false,
    isPetQuality: false,
    ...over,
  }) as unknown as PetEditDraft;

describe('computePetChanges — no changes', () => {
  it('returns an empty object when nothing changed', () => {
    expect(computePetChanges(pet(), draft())).toEqual({});
  });
});

describe('computePetChanges — scalar fields', () => {
  it('trims name before comparing and persisting', () => {
    expect(computePetChanges(pet(), draft({ name: '  Bessie  ' }))).toEqual({});
    expect(computePetChanges(pet(), draft({ name: '  Bella  ' }))).toEqual({ name: 'Bella' });
  });

  it('detects gender change', () => {
    expect(computePetChanges(pet(), draft({ gender: 'Male' }))).toEqual({ gender: 'Male' });
  });

  it('trims breed and compares against the stored breed', () => {
    expect(computePetChanges(pet(), draft({ breed: '  Kurbone  ' }))).toEqual({ breed: 'Kurbone' });
  });

  it("compares breed against 'Mixed' default when the pet has no breed", () => {
    // Pet with falsy breed, draft left at the 'Mixed' default → no change.
    expect(computePetChanges(pet({ breed: '' }), draft({ breed: 'Mixed' }))).toEqual({});
    // Same pet, draft moved off the default → change.
    expect(computePetChanges(pet({ breed: '' }), draft({ breed: 'Bee' }))).toEqual({ breed: 'Bee' });
  });
});

describe('computePetChanges — attributes', () => {
  it('includes only changed attributes', () => {
    const result = computePetChanges(pet(), draft({ attributes: { intelligence: 55, toughness: 60 } }));
    expect(result).toEqual({ attributes: { intelligence: 55 } });
  });

  it('includes multiple changed attributes', () => {
    const result = computePetChanges(pet(), draft({ attributes: { intelligence: 55, toughness: 70 } }));
    expect(result).toEqual({ attributes: { intelligence: 55, toughness: 70 } });
  });

  it('omits attributes entirely when none changed', () => {
    expect(computePetChanges(pet(), draft())).not.toHaveProperty('attributes');
  });
});

describe('computePetChanges — tags', () => {
  it('detects a length change', () => {
    expect(computePetChanges(pet(), draft({ tags: ['foal', 'fast'] }))).toEqual({ tags: ['foal', 'fast'] });
    expect(computePetChanges(pet(), draft({ tags: [] }))).toEqual({ tags: [] });
  });

  it('detects per-index inequality at equal length', () => {
    expect(computePetChanges(pet(), draft({ tags: ['fast'] }))).toEqual({ tags: ['fast'] });
  });

  it('treats reordered tags as a change (positional comparison)', () => {
    const p = pet({ tags: ['a', 'b'] });
    expect(computePetChanges(p, draft({ tags: ['b', 'a'] }))).toEqual({ tags: ['b', 'a'] });
  });

  it('tolerates a missing tags array on the pet', () => {
    const { tags, ...noTags } = pet();
    expect(computePetChanges(noTags as unknown as Pet, draft({ tags: [] }))).toEqual({});
    expect(computePetChanges(noTags as unknown as Pet, draft({ tags: ['new'] }))).toEqual({ tags: ['new'] });
  });
});

describe('computePetChanges — boolean markers', () => {
  it('detects starred flip', () => {
    expect(computePetChanges(pet(), draft({ starred: true }))).toEqual({ starred: true });
  });

  it('detects stabled flip', () => {
    expect(computePetChanges(pet(), draft({ stabled: true }))).toEqual({ stabled: true });
  });

  it('detects is_pet_quality flip', () => {
    expect(computePetChanges(pet(), draft({ isPetQuality: true }))).toEqual({ is_pet_quality: true });
  });

  it('coerces truthy/falsy stored markers via !! before comparing', () => {
    // Stored marker is undefined (falsy); draft false → no change.
    expect(computePetChanges(pet({ starred: undefined }), draft({ starred: false }))).toEqual({});
    // Stored marker is a truthy non-boolean (1); draft true → no change.
    expect(computePetChanges(pet({ stabled: 1 }), draft({ stabled: true }))).toEqual({});
  });
});

describe('computePetChanges — combined', () => {
  it('assembles every changed field into one update object', () => {
    const result = computePetChanges(
      pet(),
      draft({
        name: 'Bella',
        gender: 'Male',
        breed: 'Kurbone',
        attributes: { intelligence: 99, toughness: 60 },
        tags: ['stud'],
        starred: true,
        stabled: true,
        isPetQuality: true,
      }),
    );
    expect(result).toEqual({
      name: 'Bella',
      gender: 'Male',
      breed: 'Kurbone',
      attributes: { intelligence: 99 },
      tags: ['stud'],
      starred: true,
      stabled: true,
      is_pet_quality: true,
    });
  });
});
