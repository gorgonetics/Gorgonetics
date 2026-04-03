/**
 * Single source of truth for gene appearance colors.
 * Used by both the gene grid (via CSS custom properties) and the stats table (via configService).
 *
 * To change a color: update it here — both views update automatically.
 * CSS variables are injected in app.html as --gene-{key}.
 */

export const EFFECT_COLORS = {
  positive: '#4caf50',
  negative: '#f44336',
  neutral: '#95a5a6',
} as const;

/**
 * BeeWasp appearance colors.
 * Keys use the short CSS var names (--gene-{key}).
 * The configService maps these to the full appearance category names.
 */
export const BEEWASP_APPEARANCE_COLORS: Record<string, string> = {
  'body-hue': '#ff9800',
  'body-saturation': '#ff6f00',
  'body-intensity': '#ffcc02',
  'wing-hue': '#2196f3',
  'wing-saturation': '#1976d2',
  'wing-intensity': '#0d47a1',
  'body-scale': '#9c27b0',
  'wing-scale': '#7b1fa2',
  'head-scale': '#8e24aa',
  'tail-scale': '#ab47bc',
  'antenna-scale': '#ba68c8',
  'leg-deformity': '#e91e63',
  'antenna-deformity': '#c2185b',
  particles: '#00bcd4',
  'particle-location': '#0097a7',
  glow: '#8bc34a',
  'appearance-neutral': '#95a5a6',
};

export const HORSE_APPEARANCE_COLORS: Record<string, string> = {
  scale: '#2980b9',
  attributes: '#e74c3c',
  selector: '#8e44ad',
  horn: '#1abc9c',
  aura: '#3498db',
  coat: '#2ecc71',
  'face-markings': '#f39c12',
  hair: '#9b59b6',
  'leg-markings': '#34495e',
  magical: '#e67e22',
  markings: '#16a085',
};

/**
 * Mapping from appearance config category names to CSS var keys.
 * Only needed where the names differ (BeeWasp color categories).
 */
const BEEWASP_CATEGORY_TO_CSS: Record<string, string> = {
  'body-color-hue': 'body-hue',
  'body-color-saturation': 'body-saturation',
  'body-color-intensity': 'body-intensity',
  'wing-color-hue': 'wing-hue',
  'wing-color-saturation': 'wing-saturation',
  'wing-color-intensity': 'wing-intensity',
};

/** Look up the color for a BeeWasp appearance category. */
export function getBeewaspAppearanceColor(category: string): string {
  const cssKey = BEEWASP_CATEGORY_TO_CSS[category] ?? category;
  return BEEWASP_APPEARANCE_COLORS[cssKey] ?? '#6b7280';
}

/** Look up the color for a Horse appearance category. */
export function getHorseAppearanceColor(category: string): string {
  return HORSE_APPEARANCE_COLORS[category] ?? '#6b7280';
}

/** All appearance colors keyed for CSS variable injection (--gene-{key}). */
export const ALL_GENE_COLORS: Record<string, string> = {
  ...BEEWASP_APPEARANCE_COLORS,
  ...HORSE_APPEARANCE_COLORS,
  ...EFFECT_COLORS,
};
