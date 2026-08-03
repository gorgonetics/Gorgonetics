/**
 * Tooltip content for the rarity lens (#368, design §6).
 *
 * Shared by the per-pet grid and the Reference genome map so the two surfaces
 * cannot drift: the same locus must read the same way whichever one you hover.
 *
 * The colour is bucketed; this is not. It reports both alleles' **exact**
 * frequencies with the effect each produces, so the player can weigh scarce
 * against desirable themselves — which is where v1 quietly delivers the "rare
 * AND desirable" pairing the design otherwise defers to #369.
 */

import { EFFECT_COLORS } from '$lib/theme/gene-colors.js';
import { GeneType } from '$lib/types/index.js';
import { isNoEffect, parseEffect } from '$lib/utils/geneAnalysis.js';
import type { Allele, LocusTally } from '$lib/utils/geneFrequency.js';

/** Structural subset of `RarityLookup`, so this stays unit-testable with a stub. */
export interface RarityTooltipSource {
  measurable(geneId: string): boolean;
  tally(geneId: string): LocusTally;
  frequency(geneId: string, allele: Allele): number;
  carriers(geneId: string, allele: Allele): number;
}

export interface RarityTooltipContent {
  subtitle: string;
  /** Rendered via `{@html}` by GeneTooltip — every interpolated value is escaped. */
  lines: string[];
}

const MUTED = '#9ca3af';

/** The lines are injected as HTML, so DB/genome text must be escaped. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function armLine(label: string, frequency: number, carriers: number, effect: string): string {
  const parsed = parseEffect(effect);
  // Valence keeps its own colour and column. This is the one place the
  // attribute view's green/red and the rarity view's purple/orange coexist;
  // blending them would make "rare" and "good" one colour again, which the
  // hue choice exists to prevent.
  const colour = parsed ? (parsed.sign === '+' ? EFFECT_COLORS.positive : EFFECT_COLORS.negative) : MUTED;
  // Mark whichever arm is beneficial — both if both are, neither if neither.
  const mark = parsed?.sign === '+' ? ' ✦' : '';
  const effectText = isNoEffect(effect) ? 'no effect' : effect;
  return (
    `${label} <strong>${(frequency * 100).toFixed(1)}%</strong> ` +
    `<span style="color: ${colour}">${escapeHtml(effectText)}${mark}</span> ` +
    `<span style="color: ${MUTED}">· ${carriers} carrier${carriers === 1 ? '' : 's'}</span>`
  );
}

/**
 * Build the card for one locus.
 *
 * **Both arms, always** — not just on mixed cells. The two frequencies are what
 * the scale is built from, and showing both spares the reader inverting `1 − p`.
 *
 * **One decimal**: granularity is `1/(2N)`, ~1.7% at 30 pets, so more digits
 * would imply precision the sample does not have.
 *
 * **The pet count is the per-locus `knownPets`**, never the population size —
 * they differ wherever pets were studied at a lower Genetics level, and quoting
 * the population would misstate the evidence behind the colour.
 */
export function buildRarityTooltip(
  lookup: RarityTooltipSource | null,
  geneId: string,
  speciesLabel: string,
  effects: { dominant: string; recessive: string },
): RarityTooltipContent {
  if (!lookup) return { subtitle: '', lines: ['Analysing…'] };
  if (!lookup.measurable(geneId)) {
    return { subtitle: '', lines: ['Not enough data at this locus'] };
  }

  const t = lookup.tally(geneId);
  return {
    subtitle: `${t.knownPets} ${speciesLabel} studied at this locus`,
    lines: [
      armLine(
        'Dominant',
        lookup.frequency(geneId, GeneType.DOMINANT),
        lookup.carriers(geneId, GeneType.DOMINANT),
        effects.dominant,
      ),
      armLine(
        'Recessive',
        lookup.frequency(geneId, GeneType.RECESSIVE),
        lookup.carriers(geneId, GeneType.RECESSIVE),
        effects.recessive,
      ),
      `<span style="color: ${MUTED}">${t.pureD} pure D · ${t.mixed} mixed · ${t.pureR} pure R</span>`,
    ],
  };
}
