import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Issue #92 slice: the export dialog warns when the image library is large
// enough that the in-memory zip build could fail on a low-memory machine.

vi.mock('$lib/utils/focusTrap.js', () => ({ focusTrap: () => ({}) }));

const getTotalImageCount = vi.fn();
vi.mock('$lib/services/imageService.js', () => ({
  getTotalImageCount: () => getTotalImageCount(),
}));

vi.mock('$lib/services/backupService.js', () => ({
  exportDatabase: vi.fn(),
}));

import ExportDialog from '$lib/components/layout/ExportDialog.svelte';

afterEach(() => {
  cleanup();
  getTotalImageCount.mockReset();
});

function renderDialog() {
  return render(ExportDialog, { onClose: vi.fn(), onResult: vi.fn() });
}

describe('ExportDialog image-size warning (#92)', () => {
  it('shows the warning when the image library is large and images are included', async () => {
    getTotalImageCount.mockResolvedValue(100);
    const { getByTestId } = renderDialog();

    await waitFor(() => {
      const warning = getByTestId('export-image-warning');
      expect(warning).toBeInTheDocument();
      expect(warning).toHaveTextContent(/100 images/);
      expect(warning).toHaveTextContent(/low-memory/i);
    });
  });

  it('does not warn for a typical-sized library', async () => {
    getTotalImageCount.mockResolvedValue(40);
    const { queryByTestId } = renderDialog();

    // Let the count effect resolve, then confirm no warning.
    await waitFor(() => expect(queryByTestId('share-genome-loading')).toBeNull());
    await Promise.resolve();
    expect(queryByTestId('export-image-warning')).toBeNull();
  });

  it('hides the warning when images are excluded, even with a large library', async () => {
    getTotalImageCount.mockResolvedValue(250);
    const { getByTestId, queryByTestId } = renderDialog();

    await waitFor(() => expect(getByTestId('export-image-warning')).toBeInTheDocument());

    // Uncheck "Pet images" (third checkbox) — the warning must disappear.
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    await fireEvent.click(checkboxes[2]);

    expect(queryByTestId('export-image-warning')).toBeNull();
  });
});
