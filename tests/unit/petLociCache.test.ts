import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAllPetLociCached, invalidatePetLociCache } from '$lib/services/petLociCache.js';
import { GeneType } from '$lib/types/index.js';
import * as petLoci from '$lib/utils/petLoci.js';

vi.mock('$lib/utils/petLoci.js', () => ({
  loadAllPetLoci: vi.fn(),
}));

const loadMock = vi.mocked(petLoci.loadAllPetLoci);

function lociMapFor(ids: readonly number[]): Map<number, petLoci.PetLoci> {
  return new Map(ids.map((id) => [id, new Map([['01A1', GeneType.DOMINANT]])]));
}

beforeEach(() => {
  invalidatePetLociCache();
  loadMock.mockReset();
  loadMock.mockImplementation(async (ids) => lociMapFor(ids));
});

describe('getAllPetLociCached — sorted-id keying (§7/§10)', () => {
  it('reordering the pet array does not trigger a re-read', async () => {
    await getAllPetLociCached([3, 1, 2]);
    await getAllPetLociCached([1, 2, 3]);
    expect(loadMock).toHaveBeenCalledTimes(1);
  });

  it('adding a pet does trigger a re-read', async () => {
    await getAllPetLociCached([1, 2, 3]);
    await getAllPetLociCached([1, 2, 3, 4]);
    expect(loadMock).toHaveBeenCalledTimes(2);
  });

  it('invalidation drops the cache', async () => {
    await getAllPetLociCached([1, 2]);
    invalidatePetLociCache();
    await getAllPetLociCached([1, 2]);
    expect(loadMock).toHaveBeenCalledTimes(2);
  });

  it('a failed load is evicted so the next call retries', async () => {
    loadMock.mockRejectedValueOnce(new Error('boom'));
    await expect(getAllPetLociCached([1])).rejects.toThrow('boom');
    const map = await getAllPetLociCached([1]);
    expect(map.has(1)).toBe(true);
    expect(loadMock).toHaveBeenCalledTimes(2);
  });

  it('holds a bounded number of populations', async () => {
    for (let i = 0; i < 6; i++) await getAllPetLociCached([i]);
    loadMock.mockClear();
    await getAllPetLociCached([0]); // evicted by now — re-reads
    expect(loadMock).toHaveBeenCalledTimes(1);
    await getAllPetLociCached([5]); // most recent — still cached
    expect(loadMock).toHaveBeenCalledTimes(1);
  });
});
