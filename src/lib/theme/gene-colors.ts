/**
 * Canonical TypeScript exports for gene colors. The actual values live in
 * `gene-colors-data.json` (single source of truth) and are mirrored into
 * CSS custom properties at build time by `scripts/gen-gene-colors-css.mjs`,
 * which writes `gene-colors.generated.css`. The runtime app reads the same
 * JSON via these named exports — there is no second hand-maintained list
 * of colors anywhere.
 */

import data from './gene-colors-data.json';

export const EFFECT_COLORS = data.effects as Record<string, string>;
export const BEEWASP_APPEARANCE_COLORS: Record<string, string> = data.beewaspAppearance;
export const HORSE_APPEARANCE_COLORS: Record<string, string> = data.horseAppearance;

const BEEWASP_CATEGORY_TO_CSS: Record<string, string> = data.beewaspCategoryAlias;

/** Look up the color for a BeeWasp appearance category. */
export function getBeewaspAppearanceColor(category: string): string {
  const cssKey = BEEWASP_CATEGORY_TO_CSS[category] ?? category;
  return BEEWASP_APPEARANCE_COLORS[cssKey] ?? '#6b7280';
}

/** Look up the color for a Horse appearance category. */
export function getHorseAppearanceColor(category: string): string {
  return HORSE_APPEARANCE_COLORS[category] ?? '#6b7280';
}
