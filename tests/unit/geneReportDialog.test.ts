import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The send path cannot run in e2e (Firestore traffic is blocked there), so
// this suite drives the dialog with the service mocked: preview, note,
// send, the "Reported" state and partial failure.

vi.mock('$lib/firebase.js', () => ({ isPlaceholderConfig: false }));
vi.mock('$lib/utils/focusTrap.js', () => ({ focusTrap: () => ({}) }));

const findReportableChanges = vi.fn();
const submitGeneReports = vi.fn();
vi.mock('$lib/services/geneReportService.js', () => ({
  MAX_NOTE_LENGTH: 1000,
  findReportableChanges: (s: string, c: string) => findReportableChanges(s, c),
  submitGeneReports: (changes: unknown, note: string) => submitGeneReports(changes, note),
}));

import GeneReportDialog from '$lib/components/gene/GeneReportDialog.svelte';
import type { ReportableChange } from '$lib/services/geneReportService.js';

afterEach(() => {
  cleanup();
  findReportableChanges.mockReset();
  submitGeneReports.mockReset();
});

function change(gene: string, alreadySent = false): ReportableChange {
  return {
    report: {
      species: 'horse',
      gene,
      bundledDominant: 'Toughness+',
      bundledRecessive: 'None',
      proposedDominant: 'Ruggedness+',
      proposedRecessive: 'None',
      templateBundleHash: 'c'.repeat(64),
      appVersion: '0.10.3',
      schemaVersion: 1,
    },
    docId: gene.padEnd(64, 'f'),
    alreadySent,
  };
}

function renderDialog() {
  const onClose = vi.fn();
  const onResult = vi.fn();
  const view = render(GeneReportDialog, { species: 'horse', chromosome: 'chr26', onClose, onResult });
  return { ...view, onClose, onResult };
}

describe('GeneReportDialog', () => {
  it('previews every field that is sent', async () => {
    findReportableChanges.mockResolvedValue([change('26B3')]);
    const { getByTestId } = renderDialog();

    await waitFor(() => expect(getByTestId('gene-report-preview')).toBeInTheDocument());
    expect(findReportableChanges).toHaveBeenCalledWith('horse', 'chr26');
    expect(getByTestId('gene-report-preview')).toHaveTextContent('26B3');
    expect(getByTestId('gene-report-preview')).toHaveTextContent('Toughness+ → Ruggedness+');
    const fields = getByTestId('gene-report-fields');
    for (const text of ['horse', 'cccccccccccc', '0.10.3', 'Schema version', 'set by the server']) {
      expect(fields).toHaveTextContent(text);
    }
    expect(getByTestId('gene-report-send')).toHaveTextContent('Send 1 report(s)');
  });

  it('sends the pending changes with the trimmed note, then closes', async () => {
    const pending = change('26B3');
    findReportableChanges.mockResolvedValue([pending, change('26B4', true)]);
    submitGeneReports.mockResolvedValue({ sent: 1, duplicates: 0, failed: 0 });
    const { getByTestId, onClose, onResult } = renderDialog();

    await waitFor(() => expect(getByTestId('gene-report-send')).toBeEnabled());
    await fireEvent.input(getByTestId('gene-report-note'), { target: { value: '  bred twice  ' } });
    await fireEvent.click(getByTestId('gene-report-send'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(submitGeneReports).toHaveBeenCalledWith([pending], 'bred twice');
    expect(onResult).toHaveBeenCalledWith({ type: 'success', message: expect.stringContaining('Sent 1') });
  });

  it('shows sent changes as Reported and disables Send when nothing is pending', async () => {
    findReportableChanges.mockResolvedValue([change('26B3', true)]);
    const { getByTestId, queryByTestId } = renderDialog();

    await waitFor(() => expect(getByTestId('gene-report-sent')).toHaveTextContent('Reported'));
    expect(getByTestId('gene-report-send')).toBeDisabled();
    expect(queryByTestId('gene-report-note')).toBeNull();
  });

  it('caps the note at the rules limit', async () => {
    findReportableChanges.mockResolvedValue([change('26B3')]);
    const { getByTestId } = renderDialog();
    await waitFor(() => expect(getByTestId('gene-report-note')).toBeInTheDocument());
    expect(getByTestId('gene-report-note')).toHaveAttribute('maxlength', '1000');
  });

  it('stays open and shows the error when some reports fail', async () => {
    findReportableChanges.mockResolvedValue([change('26B3')]);
    submitGeneReports.mockResolvedValue({ sent: 0, duplicates: 0, failed: 1, error: 'unavailable' });
    const { getByTestId, onClose } = renderDialog();

    await waitFor(() => expect(getByTestId('gene-report-send')).toBeEnabled());
    await fireEvent.click(getByTestId('gene-report-send'));

    await waitFor(() => expect(getByTestId('gene-report-error')).toHaveTextContent('unavailable'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says so when nothing differs from the bundled data', async () => {
    findReportableChanges.mockResolvedValue([]);
    const { getByTestId } = renderDialog();
    await waitFor(() => expect(getByTestId('gene-report-empty')).toBeInTheDocument());
    expect(getByTestId('gene-report-send')).toBeDisabled();
  });
});
