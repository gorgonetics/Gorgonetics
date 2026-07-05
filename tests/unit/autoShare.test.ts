import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mutable test state shared between the hoisted mock factories and the cases.
const h = vi.hoisted(() => {
  function makeStore<T>(initial: T) {
    let value = initial;
    return {
      store: {
        subscribe(run: (v: T) => void) {
          run(value);
          return () => {};
        },
      },
      set(v: T) {
        value = v;
      },
    };
  }
  return {
    placeholder: false,
    settings: makeStore<Record<string, unknown>>({}),
    pets: makeStore<Array<Record<string, unknown>>>([]),
  };
});

vi.mock('$lib/firebase.js', () => ({
  get isPlaceholderConfig() {
    return h.placeholder;
  },
}));

vi.mock('$lib/stores/settings.js', () => ({ settings: h.settings.store }));
vi.mock('$lib/stores/pets.js', () => ({ pets: h.pets.store }));
vi.mock('$lib/services/shareService.js', () => ({ uploadPets: vi.fn() }));

import { AUTO_SHARE_ON_IMPORT, autoShareImportedPets, summarizeAutoShare } from '$lib/services/autoShare.js';
import { uploadPets } from '$lib/services/shareService.js';

const uploadPetsMock = vi.mocked(uploadPets);

function summary(over: Partial<Record<string, number>> = {}) {
  return { created: 0, alreadyShared: 0, skipped: 0, failed: 0, items: [], ...over } as never;
}

// Structured Horse names (breed + M/F + 7 attribute values) parse into
// known-good attributes, so they clear the auto-share gate. Everything else
// (unstructured names, all BeeWasp) is held back for a reviewed manual share.
const STRUCTURED_1 = { id: 1, name: 'Sb M 50 50 50 50 50 50 50', species: 'Horse', notes: 'private-1' };
const STRUCTURED_3 = { id: 3, name: 'Sb F 60 60 60 60 60 60 60', species: 'Horse', notes: 'private-3' };
const UNSTRUCTURED_2 = { id: 2, name: 'Just A Name', species: 'Horse', notes: '' };

describe('autoShareImportedPets', () => {
  beforeEach(() => {
    uploadPetsMock.mockReset();
    h.placeholder = false;
    h.settings.set({ [AUTO_SHARE_ON_IMPORT]: true });
    h.pets.set([STRUCTURED_1, UNSTRUCTURED_2, STRUCTURED_3]);
  });

  it('shares gated (structured-name) imported pets with notes stripped', async () => {
    uploadPetsMock.mockResolvedValue(summary({ created: 2 }));
    const result = await autoShareImportedPets([1, 3]);

    expect(uploadPetsMock).toHaveBeenCalledTimes(1);
    // Both structured pets go, but notes are cleared (no per-pet review).
    expect(uploadPetsMock.mock.calls[0][0]).toEqual([
      { ...STRUCTURED_1, notes: '' },
      { ...STRUCTURED_3, notes: '' },
    ]);
    expect(result).toEqual(summary({ created: 2 }));
  });

  it('skips pets whose attributes are not known-good (unstructured name)', async () => {
    uploadPetsMock.mockResolvedValue(summary({ created: 1 }));
    const result = await autoShareImportedPets([1, 2]);

    expect(uploadPetsMock).toHaveBeenCalledTimes(1);
    // Only the structured pet 1 is published; the unstructured pet 2 is held back.
    expect(uploadPetsMock.mock.calls[0][0]).toEqual([{ ...STRUCTURED_1, notes: '' }]);
    expect(result).toEqual(summary({ created: 1 }));
  });

  it('returns null (no upload) when every requested pet fails the attribute gate', async () => {
    h.pets.set([UNSTRUCTURED_2, { id: 4, name: 'Buzz', species: 'BeeWasp', notes: '' }]);
    expect(await autoShareImportedPets([2, 4])).toBeNull();
    expect(uploadPetsMock).not.toHaveBeenCalled();
  });

  it('does nothing when the setting is off (default-safe)', async () => {
    h.settings.set({ [AUTO_SHARE_ON_IMPORT]: false });
    const result = await autoShareImportedPets([1, 2]);

    expect(uploadPetsMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('does nothing when the setting key is absent (unset = off)', async () => {
    h.settings.set({});
    expect(await autoShareImportedPets([1])).toBeNull();
    expect(uploadPetsMock).not.toHaveBeenCalled();
  });

  it('does not share when Firebase is not configured, even if enabled', async () => {
    h.placeholder = true;
    const result = await autoShareImportedPets([1, 2]);

    expect(uploadPetsMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('returns null for an empty id list without touching the store', async () => {
    expect(await autoShareImportedPets([])).toBeNull();
    expect(uploadPetsMock).not.toHaveBeenCalled();
  });

  it('returns null when no imported id is present in the store', async () => {
    expect(await autoShareImportedPets([99])).toBeNull();
    expect(uploadPetsMock).not.toHaveBeenCalled();
  });

  it('swallows an unexpected uploadPets rejection (import must not fail)', async () => {
    uploadPetsMock.mockRejectedValue(new Error('network down'));
    expect(await autoShareImportedPets([1])).toBeNull();
  });
});

describe('summarizeAutoShare', () => {
  it('returns null when nothing notable happened', () => {
    expect(summarizeAutoShare(null)).toBeNull();
    expect(summarizeAutoShare(summary())).toBeNull();
  });

  it('summarizes created / already-shared / failed counts', () => {
    expect(summarizeAutoShare(summary({ created: 2, alreadyShared: 1, failed: 1 }))).toBe(
      '2 shared to community, 1 already shared, 1 failed to share',
    );
  });
});
