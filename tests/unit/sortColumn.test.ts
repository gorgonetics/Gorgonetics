import { describe, expect, it } from 'vitest';
import { type SortableColumn, sortByColumn } from '$lib/utils/sortColumn.js';

interface Row {
  name: string;
  score: number;
}

const rows: Row[] = [
  { name: 'Charlie', score: 2 },
  { name: 'alice', score: 10 },
  { name: 'Bob', score: 2 },
];

describe('sortByColumn — numeric', () => {
  const col: SortableColumn<Row> = { numeric: true, accessor: (r: Row) => r.score };

  it('sorts ascending by subtraction', () => {
    expect(sortByColumn(rows, col, 'asc').map((r) => r.score)).toEqual([2, 2, 10]);
  });

  it('sorts descending', () => {
    expect(sortByColumn(rows, col, 'desc').map((r) => r.score)).toEqual([10, 2, 2]);
  });
});

describe('sortByColumn — text', () => {
  const col: SortableColumn<Row> = { numeric: false, accessor: (r: Row) => r.name };

  it('sorts by localeCompare (case-insensitive ordering, not raw charCode)', () => {
    // A raw `<` comparison would put 'Charlie' before 'alice' (uppercase first);
    // localeCompare orders alphabetically regardless of case.
    expect(sortByColumn(rows, col, 'asc').map((r) => r.name)).toEqual(['alice', 'Bob', 'Charlie']);
  });

  it('reverses for descending', () => {
    expect(sortByColumn(rows, col, 'desc').map((r) => r.name)).toEqual(['Charlie', 'Bob', 'alice']);
  });
});

describe('sortByColumn — purity', () => {
  it('does not mutate the input array', () => {
    const input = [...rows];
    sortByColumn(input, { numeric: true as const, accessor: (r: Row) => r.score }, 'asc');
    expect(input).toEqual(rows);
  });
});
