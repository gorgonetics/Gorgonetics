import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The send path cannot run in e2e (Firestore traffic is blocked there), so
// this suite drives the dialog with the service mocked: preview, note,
// send, the "Reported" state, partial failure and closing during a send.

vi.mock('$lib/firebase.js', () => ({ isPlaceholderConfig: false }));
vi.mock('$lib/utils/focusTrap.js', () => ({ focusTrap: () => ({}) }));

const submitGeneReports = vi.fn();
vi.mock('$lib/services/geneReportService.js', () => ({
  MAX_NOTE_LENGTH: 1000,
  submitGeneReports: (changes: unknown, note: string) => submitGeneReports(changes, note),
}));

import GeneReportDialog from '$lib/components/gene/GeneReportDialog.svelte';
import type { ReportableChange } from '$lib/services/geneReportService.js';

afterEach(() => {
  cleanup();
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

function renderDialog(changes: ReportableChange[]) {
  const onClose = vi.fn();
  const onResult = vi.fn();
  const view = render(GeneReportDialog, { species: 'horse', chromosome: 'chr26', changes, onClose, onResult });
  return { ...view, onClose, onResult };
}

describe('GeneReportDialog', () => {
  it('previews every field that is sent', () => {
    const { getByTestId } = renderDialog([change('26B3')]);

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
    submitGeneReports.mockResolvedValue({ sent: 1, duplicates: 0, failed: 0, recorded: [pending.docId] });
    const { getByTestId, onClose, onResult } = renderDialog([pending, change('26B4', true)]);

    await fireEvent.input(getByTestId('gene-report-note'), { target: { value: '  bred twice  ' } });
    await fireEvent.click(getByTestId('gene-report-send'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(submitGeneReports).toHaveBeenCalledWith([pending], 'bred twice');
    expect(onResult).toHaveBeenCalledWith({ type: 'success', message: expect.stringContaining('Sent 1') });
  });

  it('shows sent changes as Reported and disables Send when nothing is pending', () => {
    const { getByTestId, queryByTestId } = renderDialog([change('26B3', true)]);

    expect(getByTestId('gene-report-sent')).toHaveTextContent('Reported');
    expect(getByTestId('gene-report-send')).toBeDisabled();
    expect(queryByTestId('gene-report-note')).toBeNull();
  });

  it('caps the note at the rules limit', () => {
    const { getByTestId } = renderDialog([change('26B3')]);
    expect(getByTestId('gene-report-note')).toHaveAttribute('maxlength', '1000');
  });

  it('on a partial failure, stays open, marks the sent ones and keeps the rest pending', async () => {
    const a = change('26B3');
    const b = change('26B4');
    submitGeneReports.mockResolvedValue({
      sent: 1,
      duplicates: 0,
      failed: 1,
      error: 'unavailable',
      recorded: [a.docId],
    });
    const { getByTestId, getAllByTestId, onClose } = renderDialog([a, b]);

    await fireEvent.click(getByTestId('gene-report-send'));

    await waitFor(() => expect(getByTestId('gene-report-error')).toHaveTextContent('1 report(s) sent'));
    expect(getByTestId('gene-report-error')).toHaveTextContent('unavailable');
    expect(getAllByTestId('gene-report-sent')).toHaveLength(1);
    expect(getByTestId('gene-report-send')).toHaveTextContent('Send 1 report(s)');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cannot be closed while sending', async () => {
    let finish!: (value: unknown) => void;
    submitGeneReports.mockReturnValue(
      new Promise((r) => {
        finish = r;
      }),
    );
    const { getByTestId, getByLabelText, onClose } = renderDialog([change('26B3')]);

    await fireEvent.click(getByTestId('gene-report-send'));
    await fireEvent.keyDown(getByTestId('gene-report-backdrop'), { key: 'Escape' });
    await fireEvent.click(getByTestId('gene-report-backdrop'));
    expect(getByLabelText('Close')).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();

    finish({ sent: 1, duplicates: 0, failed: 0, recorded: [change('26B3').docId] });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('says so when nothing differs from the bundled data', () => {
    const { getByTestId } = renderDialog([]);
    expect(getByTestId('gene-report-empty')).toBeInTheDocument();
    expect(getByTestId('gene-report-send')).toBeDisabled();
  });
});
