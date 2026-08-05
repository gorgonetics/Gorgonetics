export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * `count` with a naively pluralised noun — "1 Horse", "12 Horses".
 *
 * Species names in this app are regular ("Horse", "BeeWasp"), so an `s` is right
 * for every one of them; anything irregular would need a real plural form passed
 * in rather than a smarter rule guessed at here.
 */
export function pluralise(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

/**
 * Escape text destined for a `{@html}` binding.
 *
 * Both gene tooltips build their lines as HTML strings, and the text they
 * interpolate comes from the gene template DB and from genome files — neither of
 * which is trusted markup. Ampersand first, or an escape would be re-escaped.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
