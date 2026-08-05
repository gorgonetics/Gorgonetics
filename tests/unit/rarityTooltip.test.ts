import { describe, expect, it } from 'vitest';
import { GeneType } from '$lib/types/index.js';
import type { LocusTally } from '$lib/utils/geneFrequency.js';
import { buildRarityTooltip, escapeHtml, type RarityTooltipSource } from '$lib/utils/rarityTooltip.js';

/**
 * The rarity tooltip (#368, design §6).
 *
 * This util is shared by the per-pet grid and the genome map so a locus reads
 * the same way whichever surface you hover, and its lines are injected with
 * `{@html}` — so both the arithmetic and the escaping are load-bearing.
 */

const D = GeneType.DOMINANT;
const R = GeneType.RECESSIVE;

const tally = (knownPets: number, pureD: number, pureR: number, mixed: number): LocusTally => ({
  knownPets,
  pureD,
  pureR,
  mixed,
});

/**
 * Baseline stub. Frequencies and carriers are derived from the tally exactly as
 * `geneFrequency` derives them, so a fixture cannot describe a locus the real
 * service could never produce.
 */
function stub(tallies: Record<string, LocusTally>, minKnownAlleles = 4): RarityTooltipSource {
  const at = (geneId: string) => tallies[geneId] ?? tally(0, 0, 0, 0);
  return {
    measurable: (geneId) => 2 * at(geneId).knownPets >= minKnownAlleles,
    tally: at,
    frequency: (geneId, allele) => {
      const t = at(geneId);
      if (t.knownPets === 0) return 0;
      const copies = allele === D ? 2 * t.pureD + t.mixed : 2 * t.pureR + t.mixed;
      return copies / (2 * t.knownPets);
    },
    carriers: (geneId, allele) => {
      const t = at(geneId);
      return allele === D ? t.pureD + t.mixed : t.pureR + t.mixed;
    },
  };
}

const NEUTRAL_EFFECTS = { dominant: 'Virility-', recessive: 'Temperament+' };

/** Everything the card renders, as one string — the reader sees it that way. */
const flat = (content: { subtitle: string; lines: string[] }) => `${content.subtitle}\n${content.lines.join('\n')}`;

describe('buildRarityTooltip — both arms, always', () => {
  it('reports both alleles even on a pure cell, so the reader never inverts 1 − p', () => {
    // 8 pure D + 2 mixed of 10 → p_D = 0.9, p_R = 0.1.
    const content = buildRarityTooltip(stub({ '01A4': tally(10, 8, 0, 2) }), '01A4', 'Horses', NEUTRAL_EFFECTS);
    expect(content.lines[0]).toContain('Dominant');
    expect(content.lines[0]).toContain('90.0%');
    expect(content.lines[1]).toContain('Recessive');
    expect(content.lines[1]).toContain('10.0%');
  });

  it('quotes exact frequencies to one decimal — the sample cannot support more', () => {
    // 22 pets → granularity 1/44 ≈ 2.3%. 5 of 44 recessive copies = 11.36%.
    const content = buildRarityTooltip(stub({ '01A4': tally(22, 18, 1, 3) }), '01A4', 'Horses', NEUTRAL_EFFECTS);
    expect(content.lines[1]).toContain('11.4%');
    expect(content.lines[1]).not.toMatch(/\d\.\d\d%/);
  });

  it('sums to 100% across the two arms, as the scale requires', () => {
    const content = buildRarityTooltip(stub({ '01A4': tally(13, 6, 3, 4) }), '01A4', 'Horses', NEUTRAL_EFFECTS);
    const percentages = [...flat(content).matchAll(/(\d+\.\d)%/g)].map((m) => Number(m[1]));
    expect(percentages).toHaveLength(2);
    expect(percentages[0] + percentages[1]).toBeCloseTo(100, 1);
  });

  it('names the carrier count per arm, so a sole carrier is legible as one', () => {
    // The scenario the lens exists for: one mixed pet among 21 pure D.
    const content = buildRarityTooltip(stub({ '01A4': tally(22, 21, 0, 1) }), '01A4', 'Horses', NEUTRAL_EFFECTS);
    expect(content.lines[1]).toContain('1 carrier');
    expect(content.lines[1]).not.toContain('1 carriers');
    expect(content.lines[0]).toContain('22 carriers');
  });
});

describe('buildRarityTooltip — the pet count is per-locus, never the population size', () => {
  it('quotes knownPets at this locus, which differs from the population', () => {
    // A stable of 30 where only 22 were studied deep enough to reveal this gene.
    const content = buildRarityTooltip(stub({ '07C2': tally(22, 14, 5, 3) }), '07C2', 'Horses', NEUTRAL_EFFECTS);
    expect(content.subtitle).toBe('22 Horses studied at this locus');
  });

  it('gives neighbouring loci different counts from one baseline', () => {
    const lookup = stub({ '01A1': tally(30, 20, 5, 5), '01A2': tally(11, 8, 1, 2) });
    expect(buildRarityTooltip(lookup, '01A1', 'Horses', NEUTRAL_EFFECTS).subtitle).toContain('30 Horses');
    expect(buildRarityTooltip(lookup, '01A2', 'Horses', NEUTRAL_EFFECTS).subtitle).toContain('11 Horses');
  });

  it('reports the pure/mixed breakdown the frequencies were built from', () => {
    const content = buildRarityTooltip(stub({ '01A4': tally(22, 8, 11, 3) }), '01A4', 'Horses', NEUTRAL_EFFECTS);
    expect(content.lines[2]).toContain('8 pure D');
    expect(content.lines[2]).toContain('3 mixed');
    expect(content.lines[2]).toContain('11 pure R');
  });
});

describe('buildRarityTooltip — effect valence', () => {
  it('marks the beneficial arm and leaves the other unmarked', () => {
    const content = buildRarityTooltip(stub({ '01A4': tally(10, 8, 0, 2) }), '01A4', 'Horses', {
      dominant: 'Virility-',
      recessive: 'Temperament+',
    });
    expect(content.lines[0]).not.toContain('✦');
    expect(content.lines[1]).toContain('✦');
  });

  it('marks BOTH arms when both are positive — "which, if any" is the honest framing', () => {
    const content = buildRarityTooltip(stub({ '01A4': tally(10, 8, 0, 2) }), '01A4', 'Horses', {
      dominant: 'Toughness+',
      recessive: 'Temperament+',
    });
    expect(content.lines[0]).toContain('✦');
    expect(content.lines[1]).toContain('✦');
  });

  it('marks NEITHER arm when neither is positive', () => {
    const content = buildRarityTooltip(stub({ '01A4': tally(10, 8, 0, 2) }), '01A4', 'Horses', {
      dominant: 'Toughness-',
      recessive: 'Temperament-',
    });
    expect(flat(content)).not.toContain('✦');
  });

  it('keeps valence in its own colour, never blended into the rarity hue', () => {
    // The one place the attribute view's green/red and the rarity view's
    // purple/orange coexist. Blending them makes "rare" and "good" one colour
    // again, which the hue choice exists to prevent.
    const content = buildRarityTooltip(stub({ '01A4': tally(10, 8, 0, 2) }), '01A4', 'Horses', {
      dominant: 'Virility-',
      recessive: 'Temperament+',
    });
    expect(content.lines[0]).toContain('#f44336');
    expect(content.lines[1]).toContain('#4caf50');
    expect(flat(content)).not.toMatch(/--rarity-[dr]/);
  });

  it('falls back to the raw string with no marker when the effect will not parse', () => {
    const content = buildRarityTooltip(stub({ '01A4': tally(10, 8, 0, 2) }), '01A4', 'Horses', {
      dominant: 'Potential Toughness+',
      recessive: 'something odd',
    });
    expect(content.lines[0]).toContain('Potential Toughness+');
    expect(content.lines[1]).toContain('something odd');
    expect(flat(content)).not.toContain('✦');
  });

  it('renders a no-effect sentinel as "no effect" rather than echoing it', () => {
    const content = buildRarityTooltip(stub({ '01A4': tally(10, 8, 0, 2) }), '01A4', 'Horses', {
      dominant: 'No dominant effect',
      recessive: 'Temperament+',
    });
    expect(content.lines[0]).toContain('no effect');
    expect(content.lines[0]).not.toContain('No dominant effect');
  });

  it('treats an empty effect as no effect instead of printing a blank', () => {
    const content = buildRarityTooltip(stub({ '01A4': tally(10, 8, 0, 2) }), '01A4', 'Horses', {
      dominant: '',
      recessive: '',
    });
    expect(content.lines[0]).toContain('no effect');
    expect(content.lines[1]).toContain('no effect');
  });
});

describe('buildRarityTooltip — honest about missing evidence', () => {
  it('says "not enough data" for a locus below minKnown, never a 0% reading', () => {
    const content = buildRarityTooltip(stub({ '01A4': tally(1, 1, 0, 0) }), '01A4', 'Horses', NEUTRAL_EFFECTS);
    expect(content.lines).toEqual(['Not enough data at this locus']);
    expect(content.subtitle).toBe('');
    expect(flat(content)).not.toContain('%');
  });

  it('says "not enough data" for a locus no pet has a reading at', () => {
    const content = buildRarityTooltip(stub({}), '99Z9', 'Horses', NEUTRAL_EFFECTS);
    expect(content.lines).toEqual(['Not enough data at this locus']);
  });

  it('shows "Analysing…" while the baseline is still resolving', () => {
    // Distinct from "not enough data": the answer is coming, not absent.
    const content = buildRarityTooltip(null, '01A4', 'Horses', NEUTRAL_EFFECTS);
    expect(content.lines).toEqual(['Analysing…']);
  });

  it('reports a monomorphic locus as 100/0 rather than suppressing the absent arm', () => {
    const content = buildRarityTooltip(stub({ '01A4': tally(20, 20, 0, 0) }), '01A4', 'Horses', NEUTRAL_EFFECTS);
    expect(content.lines[0]).toContain('100.0%');
    expect(content.lines[1]).toContain('0.0%');
  });

  it('says "never seen" rather than "0 carriers" — that reading is acted on differently', () => {
    // An allele nobody owns cannot be bred for, only captured (#367). The words
    // carry that; the number does not.
    const content = buildRarityTooltip(stub({ '01A4': tally(20, 20, 0, 0) }), '01A4', 'Horses', NEUTRAL_EFFECTS);
    expect(content.lines[1]).toContain('never seen');
    expect(content.lines[1]).not.toContain('0 carriers');
    // The arm that IS carried still counts carriers.
    expect(content.lines[0]).toContain('20 carriers');
  });
});

describe('escapeHtml', () => {
  it('escapes every character that could break out of an injected line', () => {
    expect(escapeHtml(`<script>&"'`)).toBe('&lt;script&gt;&amp;&quot;&#39;');
  });

  it('escapes the ampersand first, so an entity is not double-decoded', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('leaves ordinary effect text untouched', () => {
    expect(escapeHtml('Temperament+')).toBe('Temperament+');
  });

  it('is applied to effect text on its way into a tooltip line', () => {
    // Effect strings come from the gene template DB, which the user can edit
    // through the Reference editor, and the lines are rendered with `{@html}`.
    const content = buildRarityTooltip(stub({ '01A4': tally(10, 8, 0, 2) }), '01A4', 'Horses', {
      dominant: '<img src=x onerror=alert(1)>',
      recessive: 'Temperament+',
    });
    expect(content.lines[0]).not.toContain('<img');
    expect(content.lines[0]).toContain('&lt;img');
  });
});
