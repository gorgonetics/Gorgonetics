import { describe, expect, it } from 'vitest';
import { buildGenomeMapGrid } from '$lib/utils/genomeMapGrid.js';

describe('buildGenomeMapGrid', () => {
  it('groups ids into chromosome rows and block columns', () => {
    const grid = buildGenomeMapGrid(['01A1', '01A2', '01B1', '02A1']);
    expect(grid.sortedBlocks).toEqual(['A', 'B']);
    expect(grid.rows.map((r) => r.chromosome)).toEqual(['01', '02']);
    expect(grid.totalColumns).toBe(3); // A is 2 wide, B is 1
  });

  it('sizes each block by its WIDEST occurrence, so columns line up across rows', () => {
    // chr01 has three A genes, chr02 only one — the A block is 3 wide for both.
    const grid = buildGenomeMapGrid(['01A1', '01A2', '01A3', '02A1']);
    expect(grid.blockMaxGenes.get('A')).toBe(3);
    expect(grid.rows[1].cells[0]).toEqual(['02A1', null, null]);
  });

  it('orders blocks canonically, not lexicographically', () => {
    // Plain string sort would give AA before B; `compareBlockLetters` does not.
    const grid = buildGenomeMapGrid(['01B1', '01AA1', '01A1', '01Z1']);
    expect(grid.sortedBlocks).toEqual(['A', 'B', 'Z', 'AA']);
  });

  it('orders chromosomes numerically, not as strings', () => {
    const grid = buildGenomeMapGrid(['10A1', '02A1', '01A1']);
    expect(grid.rows.map((r) => r.chromosome)).toEqual(['01', '02', '10']);
  });

  it('places a locus in the same column on every row', () => {
    const grid = buildGenomeMapGrid(['01A1', '01A2', '02A1', '02A2']);
    expect(grid.rows[0].cells[0]).toEqual(['01A1', '01A2']);
    expect(grid.rows[1].cells[0]).toEqual(['02A1', '02A2']);
  });

  it('sorts within a block by position regardless of input order', () => {
    const grid = buildGenomeMapGrid(['01A3', '01A1', '01A2']);
    expect(grid.rows[0].cells[0]).toEqual(['01A1', '01A2', '01A3']);
  });

  it('drops ids that do not parse rather than throwing', () => {
    const grid = buildGenomeMapGrid(['01A1', 'nonsense', '', '01A2']);
    expect(grid.totalColumns).toBe(2);
    expect(grid.rows).toHaveLength(1);
  });

  it('returns an empty grid for no input', () => {
    const grid = buildGenomeMapGrid([]);
    expect(grid.rows).toEqual([]);
    expect(grid.totalColumns).toBe(0);
  });

  it('handles a full horse-shaped genome', () => {
    // 48 chromosomes x 12 blocks x 4 positions.
    const ids: string[] = [];
    for (let c = 1; c <= 48; c++) {
      for (let b = 0; b < 12; b++) {
        for (let p = 1; p <= 4; p++) {
          ids.push(`${String(c).padStart(2, '0')}${String.fromCharCode(65 + b)}${p}`);
        }
      }
    }
    const grid = buildGenomeMapGrid(ids);
    expect(grid.rows).toHaveLength(48);
    expect(grid.totalColumns).toBe(48);
    expect(grid.rows.every((r) => r.cells.every((b) => b.every((c) => c !== null)))).toBe(true);
  });
});
