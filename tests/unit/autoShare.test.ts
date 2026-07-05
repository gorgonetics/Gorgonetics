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
    pets: makeStore<Array<{ id: number }>>([]),
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

describe('autoShareImportedPets', () => {
  beforeEach(() => {
    uploadPetsMock.mockReset();
    h.placeholder = false;
    h.settings.set({ [AUTO_SHARE_ON_IMPORT]: true });
    h.pets.set([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('shares the matching imported pets when enabled, with notes stripped', async () => {
    uploadPetsMock.mockResolvedValue(summary({ created: 2 }));
    const result = await autoShareImportedPets([1, 3]);

    expect(uploadPetsMock).toHaveBeenCalledTimes(1);
    // Notes are cleared before publishing (auto-share has no per-pet review).
    expect(uploadPetsMock.mock.calls[0][0]).toEqual([
      { id: 1, notes: '' },
      { id: 3, notes: '' },
    ]);
    expect(result).toEqual(summary({ created: 2 }));
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
