import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Issue #254: the list path omits `genome_text`, so the pet handed to the
// share dialog usually lacks it. The dialog must lazy-fetch by id before
// it can share. These tests drive that path with `genome_text` absent on
// the prop (the production list scenario) and control the fetch result.

vi.mock('$lib/firebase.js', () => ({ isPlaceholderConfig: false }));
vi.mock('$lib/utils/focusTrap.js', () => ({ focusTrap: () => ({}) }));

const getPetGenomeText = vi.fn();
vi.mock('$lib/services/petService.js', () => ({
  getPetGenomeText: (id) => getPetGenomeText(id),
}));

const uploadPet = vi.fn();
vi.mock('$lib/services/shareService.js', () => ({
  uploadPet: (pet) => uploadPet(pet),
  sanitizeTags: (tags) => tags ?? [],
}));

import SharePetDialog from '$lib/components/community/SharePetDialog.svelte';

afterEach(() => {
  cleanup();
  getPetGenomeText.mockReset();
  uploadPet.mockReset();
});

// A pet as it arrives from the list path: full metadata, NO genome_text.
function listPet(overrides = {}) {
  return {
    id: 7,
    name: 'Buzz',
    species: 'BeeWasp',
    gender: 'Female',
    breed: '',
    breeder: 'Player',
    content_hash: 'hash-7',
    notes: '',
    tags: ['fast'],
    ...overrides,
  };
}

describe('SharePetDialog lazy genome fetch', () => {
  it('disables Share while loading, then enables it once raw text resolves', async () => {
    let resolveText;
    getPetGenomeText.mockReturnValue(
      new Promise((r) => {
        resolveText = r;
      }),
    );

    const { getByTestId } = render(SharePetDialog, {
      pet: listPet(),
      onClose: vi.fn(),
      onResult: vi.fn(),
    });

    // Loading state: button disabled, loading banner shown.
    expect(getByTestId('share-confirm')).toBeDisabled();
    expect(getByTestId('share-genome-loading')).toBeTruthy();
    expect(getPetGenomeText).toHaveBeenCalledWith(7);

    resolveText('RAW-GENOME-TEXT');
    await waitFor(() => expect(getByTestId('share-confirm')).toBeEnabled());
  });

  it('passes the lazily-fetched genome_text into uploadPet', async () => {
    getPetGenomeText.mockResolvedValue('RAW-GENOME-TEXT');
    uploadPet.mockResolvedValue({ status: 'created' });
    const onResult = vi.fn();
    const onClose = vi.fn();

    const { getByTestId } = render(SharePetDialog, { pet: listPet(), onClose, onResult });
    await waitFor(() => expect(getByTestId('share-confirm')).toBeEnabled());

    await fireEvent.click(getByTestId('share-confirm'));

    await waitFor(() => expect(uploadPet).toHaveBeenCalledTimes(1));
    const shared = uploadPet.mock.calls[0][0];
    expect(shared.genome_text).toBe('RAW-GENOME-TEXT');
    expect(shared.content_hash).toBe('hash-7');
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('shows the legacy banner and keeps Share disabled when the row has no raw text', async () => {
    getPetGenomeText.mockResolvedValue('');

    const { getByTestId, queryByTestId } = render(SharePetDialog, {
      pet: listPet(),
      onClose: vi.fn(),
      onResult: vi.fn(),
    });

    await waitFor(() => expect(getByTestId('share-no-raw-genome')).toBeTruthy());
    expect(getByTestId('share-confirm')).toBeDisabled();
    expect(queryByTestId('share-genome-error')).toBeNull();
    expect(uploadPet).not.toHaveBeenCalled();
  });

  it('uses genome_text from the prop without fetching when it is already present', async () => {
    uploadPet.mockResolvedValue({ status: 'created' });
    const onResult = vi.fn();

    const { getByTestId } = render(SharePetDialog, {
      pet: listPet({ genome_text: 'PROP-GENOME-TEXT' }),
      onClose: vi.fn(),
      onResult,
    });

    // No lazy fetch, no loading state — Share is immediately available.
    expect(getPetGenomeText).not.toHaveBeenCalled();
    expect(getByTestId('share-confirm')).toBeEnabled();

    await fireEvent.click(getByTestId('share-confirm'));
    await waitFor(() => expect(uploadPet).toHaveBeenCalledTimes(1));
    expect(uploadPet.mock.calls[0][0].genome_text).toBe('PROP-GENOME-TEXT');
  });

  it('discards a stale in-flight fetch when the key is cleared before it resolves', async () => {
    // keyedResource must invalidate the previous key's fetch when the key
    // goes null/undefined — otherwise a late resolution repopulates state
    // the dialog has already cleared.
    let resolveText;
    getPetGenomeText.mockReturnValue(
      new Promise((r) => {
        resolveText = r;
      }),
    );

    const { getByTestId, rerender } = render(SharePetDialog, {
      pet: listPet(),
      onClose: vi.fn(),
      onResult: vi.fn(),
    });
    expect(getByTestId('share-genome-loading')).toBeTruthy();

    // Re-point the dialog at a pet without an id (key becomes undefined).
    await rerender({ pet: listPet({ id: undefined }), onClose: vi.fn(), onResult: vi.fn() });

    // The original fetch resolves late — its result must be ignored.
    resolveText('STALE-GENOME-TEXT');
    await Promise.resolve();
    await waitFor(() => expect(getByTestId('share-confirm')).toBeDisabled());
    expect(uploadPet).not.toHaveBeenCalled();
  });

  it('shows a distinct error banner (not the legacy banner) when the fetch fails', async () => {
    // A transient DB read failure must not masquerade as a legacy pet that
    // needs re-importing — it gets its own retryable error state.
    getPetGenomeText.mockRejectedValue(new Error('database is locked'));

    const { getByTestId, queryByTestId } = render(SharePetDialog, {
      pet: listPet(),
      onClose: vi.fn(),
      onResult: vi.fn(),
    });

    await waitFor(() => expect(getByTestId('share-genome-error')).toBeTruthy());
    expect(getByTestId('share-genome-error')).toHaveTextContent(/database is locked/);
    expect(queryByTestId('share-no-raw-genome')).toBeNull();
    expect(getByTestId('share-confirm')).toBeDisabled();
    expect(uploadPet).not.toHaveBeenCalled();
  });
});
