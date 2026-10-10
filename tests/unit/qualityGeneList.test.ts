import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import QualityGeneList from '$lib/components/gene/QualityGeneList.svelte';
import type { QualityRow } from '$lib/utils/qualityLens.js';

const rows: QualityRow[] = [
  { gene: '01A1', allele: 'R', benefits: ['Temperament +'], standing: 'sole', generic: true, value: 1 },
  { gene: '09B2', allele: 'D', benefits: ['Toughness +'], standing: 'lock', generic: false, value: 0.05 },
];
const base = { rows, share: 42, total: 1.05, inStable: true, meaningful: true, highlighted: null };

afterEach(cleanup);

describe('QualityGeneList', () => {
  it('lists each gene with what it gives and why it counts', () => {
    const { getByTestId } = render(QualityGeneList, { ...base, onSelect: () => {} });
    expect(getByTestId('quality-row-01A1')).toHaveTextContent('01A1 R');
    expect(getByTestId('quality-row-01A1')).toHaveTextContent('Only carrier');
    expect(getByTestId('quality-row-09B2')).toHaveTextContent('breed-locked');
    expect(getByTestId('quality-row-09B2')).toHaveTextContent('Only true breeder');
    expect(getByTestId('quality-gene-list')).toHaveTextContent("42% of the stable's total");
  });

  it('picks a gene with a real button, and marks the highlighted one', async () => {
    const onSelect = vi.fn();
    const { getByRole, getByTestId } = render(QualityGeneList, { ...base, highlighted: '09B2', onSelect });
    await fireEvent.click(getByRole('button', { name: 'Show 01A1 on the grid' }));
    expect(onSelect).toHaveBeenCalledWith('01A1');
    expect(getByTestId('quality-row-09B2')).toHaveClass('selected');
    expect(getByTestId('quality-show-09B2').getAttribute('aria-pressed')).toBe('true');
  });

  it('explains an empty list, and a pet outside the stable', () => {
    const { getByTestId } = render(QualityGeneList, { ...base, rows: [], inStable: false, onSelect: () => {} });
    expect(getByTestId('quality-none')).toHaveTextContent('every benefit allele it would bring');
  });
});
