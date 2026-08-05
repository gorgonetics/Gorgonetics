export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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
