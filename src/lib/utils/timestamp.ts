export function now(): string {
  return new Date().toISOString();
}

/** Display-friendly "May 14, 2026" for the user's locale. Empty for invalid dates. */
export function formatShortDate(d: Date): string {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
