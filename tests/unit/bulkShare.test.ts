import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pet } from '$lib/types/index.js';

const h = vi.hoisted(() => ({ placeholder: false }));

vi.mock('$lib/firebase.js', () => ({
  get isPlaceholderConfig() {
    return h.placeholder;
  },
}));
vi.mock('$lib/services/shareService.js', () => ({ uploadPets: vi.fn() }));

import { uploadPets } from '$lib/services/shareService.js';
import {
  bulkShareJob,
  bulkSharePercent,
  cancelBulkShare,
  dismissBulkShare,
  startBulkShare,
} from '$lib/stores/bulkShare.svelte.js';

const uploadPetsMock = vi.mocked(uploadPets);
const pet = (id: number, notes = `note-${id}`) => ({ id, name: `Pet ${id}`, notes }) as unknown as Pet;
const summary = (over = {}) => ({ created: 0, alreadyShared: 0, skipped: 0, failed: 0, items: [], ...over }) as never;

function resetJob() {
  bulkShareJob.status = 'idle';
  bulkShareJob.total = 0;
  bulkShareJob.done = 0;
  bulkShareJob.summary = null;
  bulkShareJob.error = null;
}

describe('bulkShare store', () => {
  beforeEach(() => {
    uploadPetsMock.mockReset();
    uploadPetsMock.mockResolvedValue(summary({ created: 1 }));
    h.placeholder = false;
    resetJob();
  });

  it('starts a background job: running synchronously, then done with summary', async () => {
    uploadPetsMock.mockImplementation(async (pets, opts) => {
      opts?.onProgress?.(pets.length, pets.length);
      return summary({ created: pets.length });
    });

    startBulkShare([pet(1), pet(2)]);
    // Synchronously running before the upload promise settles.
    expect(bulkShareJob.status).toBe('running');
    expect(bulkShareJob.total).toBe(2);

    await vi.waitFor(() => expect(bulkShareJob.status).toBe('done'));
    expect(bulkShareJob.done).toBe(2);
    expect(bulkShareJob.summary).toEqual(summary({ created: 2 }));
  });

  it('strips notes and passes throttle options', async () => {
    startBulkShare([pet(1, 'secret'), pet(2, 'also secret')]);
    await vi.waitFor(() => expect(bulkShareJob.status).toBe('done'));

    const [petsArg, opts] = uploadPetsMock.mock.calls[0];
    expect(petsArg.every((p) => p.notes === '')).toBe(true);
    expect(opts?.interRequestDelayMs).toBeGreaterThan(0);
    expect(opts?.maxQuotaRetries).toBeGreaterThan(0);
  });

  it('is a no-op when Firebase is not configured', () => {
    h.placeholder = true;
    startBulkShare([pet(1)]);
    expect(bulkShareJob.status).toBe('idle');
    expect(uploadPetsMock).not.toHaveBeenCalled();
  });

  it('is a no-op for an empty list', () => {
    startBulkShare([]);
    expect(bulkShareJob.status).toBe('idle');
    expect(uploadPetsMock).not.toHaveBeenCalled();
  });

  it('ignores a second start while one is already running', async () => {
    let release!: () => void;
    uploadPetsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(summary());
        }),
    );
    startBulkShare([pet(1)]);
    startBulkShare([pet(2)]); // should be ignored
    expect(uploadPetsMock).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => expect(bulkShareJob.status).toBe('done'));
  });

  it('cancel sets shouldCancel true for the running job', async () => {
    let captured: (() => boolean) | undefined;
    uploadPetsMock.mockImplementation(async (_pets, opts) => {
      captured = opts?.shouldCancel;
      return summary();
    });
    startBulkShare([pet(1)]);
    await vi.waitFor(() => expect(captured).toBeDefined());
    cancelBulkShare();
    expect(captured?.()).toBe(true);
  });

  it('records a batch-wide failure', async () => {
    uploadPetsMock.mockRejectedValue(new Error('loader exploded'));
    startBulkShare([pet(1)]);
    await vi.waitFor(() => expect(bulkShareJob.status).toBe('done'));
    expect(bulkShareJob.error).toBe('loader exploded');
  });

  it('dismiss resets a finished job, but not a running one', async () => {
    let release!: () => void;
    uploadPetsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(summary());
        }),
    );
    startBulkShare([pet(1)]);
    dismissBulkShare(); // running → ignored
    expect(bulkShareJob.status).toBe('running');
    release();
    await vi.waitFor(() => expect(bulkShareJob.status).toBe('done'));
    dismissBulkShare();
    expect(bulkShareJob.status).toBe('idle');
    expect(bulkShareJob.summary).toBeNull();
  });

  it('bulkSharePercent reflects progress', () => {
    bulkShareJob.total = 4;
    bulkShareJob.done = 1;
    expect(bulkSharePercent()).toBe(25);
    bulkShareJob.total = 0;
    expect(bulkSharePercent()).toBe(0);
  });
});
