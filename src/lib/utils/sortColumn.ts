/**
 * Pure column sort for tabular views (`BreedingPairTable`).
 *
 * The comparator was inline in the component's `$derived` sort. The scoring
 * math behind the numeric columns is covered by `breedingService` tests, but
 * the string-vs-numeric branch — numeric columns subtract, text columns
 * `localeCompare` — had no coverage. Extracted as a generic, stable sort so
 * that branch can be tested directly.
 */

/**
 * A sortable column, discriminated on `numeric` so the accessor's return type
 * is tied to the comparison strategy (subtraction vs `localeCompare`).
 */
export type SortableColumn<T> =
  | { numeric: true; accessor: (r: T) => number }
  | { numeric: false; accessor: (r: T) => string };

/** Return a new array sorted by `column` in `dir`, leaving `rows` untouched. */
export function sortByColumn<T>(rows: T[], column: SortableColumn<T>, dir: 'asc' | 'desc'): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const cmp = column.numeric
      ? column.accessor(a) - column.accessor(b)
      : column.accessor(a).localeCompare(column.accessor(b));
    return cmp * sign;
  });
}
