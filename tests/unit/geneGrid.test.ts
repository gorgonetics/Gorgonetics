import { cleanup, render } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import GeneGrid, { type GeneGridRowVM } from '$lib/components/shared/GeneGrid.svelte';

type Props = ComponentProps<typeof GeneGrid>;

const rows: GeneGridRowVM[] = [
  {
    chromosome: '01',
    cells: {
      A1: { tone: 'positive', zygosity: 'D', attribute: 'Speed', title: 'Gene 01A1' },
      A2: { tone: 'negative', zygosity: 'R', attribute: 'Toughness' },
      B1: { tone: 'neutral', zygosity: '?' },
    },
  },
  {
    chromosome: '02',
    cells: {
      A1: { tone: 'potential-positive', zygosity: 'x', attribute: 'Speed' },
    },
  },
];

const grid: Partial<Props> = {
  blocks: ['A', 'B'],
  positionsByBlock: { A: [1, 2], B: [1] },
  rows,
};

function mount(over: Partial<Props> = {}) {
  return render(GeneGrid, { ...grid, ...over } as unknown as Props);
}

const rowCells = (c: HTMLElement, chrIdx: number) => [
  ...c.querySelectorAll('tbody tr')[chrIdx].querySelectorAll('.gg-cell'),
];

afterEach(cleanup);

describe('GeneGrid', () => {
  it('renders one row per chromosome with its label', () => {
    const { container } = mount();
    const trs = container.querySelectorAll('tbody tr');
    expect(trs).toHaveLength(2);
    expect(container.querySelectorAll('.gg-chr')[0].textContent).toBe('01');
    expect(container.querySelectorAll('.gg-chr')[1].textContent).toBe('02');
  });

  it('renders the block/position column headers (block letter on position 1)', () => {
    const { container } = mount();
    const heads = [...container.querySelectorAll('.gg-pos-head')].map((h) => h.textContent);
    // A1→'A', A2→'', B1→'B'
    expect(heads).toEqual(['A', '', 'B']);
  });

  it('encodes tone and zygosity as classes, and exposes the attribute for filtering', () => {
    const { container } = mount();
    const a1 = container.querySelector('.gg-cell[data-attr="Speed"][data-zyg="D"]') as HTMLElement;
    expect(a1).not.toBeNull();
    expect(a1.classList.contains('tone-positive')).toBe(true);
    expect(a1.classList.contains('zyg-dom')).toBe(true);
    expect(a1.getAttribute('title')).toBe('Gene 01A1');

    const a2 = container.querySelector('.gg-cell[data-attr="Toughness"]') as HTMLElement;
    expect(a2.classList.contains('tone-negative')).toBe(true);
    expect(a2.classList.contains('zyg-rec')).toBe(true);
  });

  it('renders the unknown cell with the hatch class and a ? glyph', () => {
    const { container } = mount();
    const unk = container.querySelector('.gg-cell.zyg-unk') as HTMLElement;
    expect(unk).not.toBeNull();
    expect(unk.getAttribute('data-zyg')).toBe('?');
    expect(unk.querySelector('.gg-unk')?.textContent).toBe('?');
  });

  it('leaves absent block/position keys as empty cells (no .gg-cell)', () => {
    const { container } = mount();
    // Row 02 only has A1; A2 and B1 columns exist but render no cell.
    expect(rowCells(container, 1)).toHaveLength(1);
  });

  it('shows the legend by default and both encodings, hides it when showLegend is false', async () => {
    const { container, rerender } = mount();
    const legend = container.querySelector('[data-testid="gene-grid-legend"]');
    expect(legend).not.toBeNull();
    // 5 effect tones + 4 value samples.
    expect(legend?.querySelectorAll('.gg-leg-sq')).toHaveLength(9);
    await rerender({ ...grid, showLegend: false } as unknown as Props);
    expect(container.querySelector('[data-testid="gene-grid-legend"]')).toBeNull();
  });

  it('renders nothing in the body for an empty grid', () => {
    const { container } = render(GeneGrid, {
      blocks: [],
      positionsByBlock: {},
      rows: [],
    } as unknown as Props);
    expect(container.querySelector('.gg-table')).toBeNull();
  });
});
