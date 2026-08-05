import { describe, expect, it } from 'vitest';
import {
  alleleCarriers,
  alleleFrequency,
  isMeasurable,
  type LocusTally,
  rarityBucket,
} from '$lib/utils/geneFrequency.js';
import {
  buildRarityTooltip,
  placeRarityTooltip,
  type RarityTooltipSource,
  rarityTooltipSize,
} from '$lib/utils/rarityTooltip.js';

/**
 * The rarity tooltip (#368, design §6).
 *
 * This util is shared by the per-pet grid and the genome map so a locus reads
 * the same way whichever surface you hover, and its lines are injected with
 * `{@html}` — so both the arithmetic and the escaping are load-bearing.
 */

const tally = (knownPets: number, pureD: number, pureR: number, mixed: number): LocusTally => ({
  knownPets,
  pureD,
  pureR,
  mixed,
});

/**
 * Baseline stub over hand-written tallies.
 *
 * Frequencies and carriers come from the **real** `geneFrequency` primitives, not
 * from arithmetic copied into the test: a fixture then cannot describe a locus the
 * service could never produce, and the two cannot drift apart.
 */
function stub(tallies: Record<string, LocusTally>): RarityTooltipSource {
  const at = (geneId: string) => tallies[geneId] ?? tally(0, 0, 0, 0);
  return {
    measurable: (geneId) => isMeasurable(at(geneId)),
    tally: at,
    frequency: (geneId, allele) => alleleFrequency(at(geneId), allele),
    carriers: (geneId, allele) => alleleCarriers(at(geneId), allele),
    bucketOf: (geneId, allele) => rarityBucket(at(geneId), allele),
  };
}

const NEUTRAL_EFFECTS = { dominant: 'Virility-', recessive: 'Temperament+' };

/** Everything the card renders, as one string — the reader sees it that way. */
const flat = (content: { subtitle: string; lines: string[] }) => `${content.subtitle}\n${content.lines.join('\n')}`;

describe('buildRarityTooltip — both arms, always', () => {
  it('reports both alleles even on a pure cell, so the reader never inverts 1 − p', () => {
    // 8 pure D + 2 mixed of 10 → p_D = 0.9, p_R = 0.1.
    const content = buildRarityTooltip(stub({ '01A4': tally(10, 8, 0, 2) }), '01A4', 'Horse', NEUTRAL_EFFECTS);
    expect(content.lines[0]).toContain('Dominant');
    expect(content.lines[0]).toContain('90.0%');
    expect(content.lines[1]).toContain('Recessive');
    expect(content.lines[1]).toContain('10.0%');
  });

  it('quotes exact frequencies to one decimal — the sample cannot support more', () => {
    // 22 pets → granularity 1/44 ≈ 2.3%. 5 of 44 recessive copies = 11.36%.
    const content = buildRarityTooltip(stub({ '01A4': tally(22, 18, 1, 3) }), '01A4', 'Horse', NEUTRAL_EFFECTS);
    expect(content.lines[1]).toContain('11.4%');
    expect(content.lines[1]).not.toMatch(/\d\.\d\d%/);
  });

  it('sums to 100% across the two arms, as the scale requires', () => {
    const content = buildRarityTooltip(stub({ '01A4': tally(13, 6, 3, 4) }), '01A4', 'Horse', NEUTRAL_EFFECTS);
    const percentages = [...flat(content).matchAll(/(\d+\.\d)%/g)].map((m) => Number(m[1]));
    expect(percentages).toHaveLength(2);
    expect(percentages[0] + percentages[1]).toBeCloseTo(100, 1);
  });

  it('names the carrier count per arm, so a sole carrier is legible as one', () => {
    // The scenario the lens exists for: one mixed pet among 21 pure D.
    const content = buildRarityTooltip(stub({ '01A4': tally(22, 21, 0, 1) }), '01A4', 'Horse', NEUTRAL_EFFECTS);
    expect(content.lines[1]).toContain('1 carrier');
    expect(content.lines[1]).not.toContain('1 carriers');
    expect(content.lines[0]).toContain('22 carriers');
  });
});

describe('buildRarityTooltip — the pet count is per-locus, never the population size', () => {
  it('quotes knownPets at this locus, which differs from the population', () => {
    // A stable of 30 where only 22 were studied deep enough to reveal this gene.
    const content = buildRarityTooltip(stub({ '07C2': tally(22, 14, 5, 3) }), '07C2', 'Horse', NEUTRAL_EFFECTS);
    expect(content.subtitle).toBe('22 Horses studied at this locus');
  });

  it('gives neighbouring loci different counts from one baseline', () => {
    const lookup = stub({ '01A1': tally(30, 20, 5, 5), '01A2': tally(11, 8, 1, 2) });
    expect(buildRarityTooltip(lookup, '01A1', 'Horse', NEUTRAL_EFFECTS).subtitle).toContain('30 Horses');
    expect(buildRarityTooltip(lookup, '01A2', 'Horse', NEUTRAL_EFFECTS).subtitle).toContain('11 Horses');
  });

  it('pluralises the species label against the count it quotes', () => {
    // Callers pass the singular (`capitalize(species)`), so the card has to do
    // this — otherwise every multi-pet baseline reads "12 Horse".
    const lookup = stub({ '01A1': tally(12, 12, 0, 0), '01A2': tally(1, 1, 0, 0) });
    expect(buildRarityTooltip(lookup, '01A1', 'Horse', NEUTRAL_EFFECTS).subtitle).toBe(
      '12 Horses studied at this locus',
    );
    // A one-pet locus is not measurable, so check the singular via a species
    // whose baseline is big enough to score but reads as one pet at this locus.
    expect(buildRarityTooltip(stub({ '01A1': tally(1, 1, 0, 0) }), '01A1', 'Horse', NEUTRAL_EFFECTS).lines).toEqual([
      'Not enough data at this locus',
    ]);
  });

  it('reports the pure/mixed breakdown the frequencies were built from', () => {
    const content = buildRarityTooltip(stub({ '01A4': tally(22, 8, 11, 3) }), '01A4', 'Horse', NEUTRAL_EFFECTS);
    expect(content.lines[2]).toContain('8 pure D');
    expect(content.lines[2]).toContain('3 mixed');
    expect(content.lines[2]).toContain('11 pure R');
  });
});

describe('buildRarityTooltip — effect valence', () => {
  it('marks the beneficial arm and leaves the other unmarked', () => {
    const content = buildRarityTooltip(stub({ '01A4': tally(10, 8, 0, 2) }), '01A4', 'Horse', {
      dominant: 'Virility-',
      recessive: 'Temperament+',
    });
    expect(content.lines[0]).not.toContain('✦');
    expect(content.lines[1]).toContain('✦');
  });

  it('marks BOTH arms when both are positive — "which, if any" is the honest framing', () => {
    const content = buildRarityTooltip(stub({ '01A4': tally(10, 8, 0, 2) }), '01A4', 'Horse', {
      dominant: 'Toughness+',
      recessive: 'Temperament+',
    });
    expect(content.lines[0]).toContain('✦');
    expect(content.lines[1]).toContain('✦');
  });

  it('marks NEITHER arm when neither is positive', () => {
    const content = buildRarityTooltip(stub({ '01A4': tally(10, 8, 0, 2) }), '01A4', 'Horse', {
      dominant: 'Toughness-',
      recessive: 'Temperament-',
    });
    expect(flat(content)).not.toContain('✦');
  });

  it('keeps valence in its own colour, never blended into the rarity hue', () => {
    // The one place the attribute view's green/red and the rarity view's
    // purple/orange coexist. Blending them makes "rare" and "good" one colour
    // again, which the hue choice exists to prevent.
    const content = buildRarityTooltip(stub({ '01A4': tally(10, 8, 0, 2) }), '01A4', 'Horse', {
      dominant: 'Virility-',
      recessive: 'Temperament+',
    });
    expect(content.lines[0]).toContain('#f44336');
    expect(content.lines[1]).toContain('#4caf50');
    expect(flat(content)).not.toMatch(/--rarity-[dr]/);
  });

  it('falls back to the raw string with no marker when the effect will not parse', () => {
    const content = buildRarityTooltip(stub({ '01A4': tally(10, 8, 0, 2) }), '01A4', 'Horse', {
      dominant: 'Potential Toughness+',
      recessive: 'something odd',
    });
    expect(content.lines[0]).toContain('Potential Toughness+');
    expect(content.lines[1]).toContain('something odd');
    expect(flat(content)).not.toContain('✦');
  });

  it('renders a no-effect sentinel as "no effect" rather than echoing it', () => {
    const content = buildRarityTooltip(stub({ '01A4': tally(10, 8, 0, 2) }), '01A4', 'Horse', {
      dominant: 'No dominant effect',
      recessive: 'Temperament+',
    });
    expect(content.lines[0]).toContain('no effect');
    expect(content.lines[0]).not.toContain('No dominant effect');
  });

  it('treats an empty effect as no effect instead of printing a blank', () => {
    const content = buildRarityTooltip(stub({ '01A4': tally(10, 8, 0, 2) }), '01A4', 'Horse', {
      dominant: '',
      recessive: '',
    });
    expect(content.lines[0]).toContain('no effect');
    expect(content.lines[1]).toContain('no effect');
  });
});

describe('buildRarityTooltip — honest about missing evidence', () => {
  it('says "not enough data" for a locus below minKnown, never a 0% reading', () => {
    const content = buildRarityTooltip(stub({ '01A4': tally(1, 1, 0, 0) }), '01A4', 'Horse', NEUTRAL_EFFECTS);
    expect(content.lines).toEqual(['Not enough data at this locus']);
    expect(content.subtitle).toBe('');
    expect(flat(content)).not.toContain('%');
  });

  it('says "not enough data" for a locus no pet has a reading at', () => {
    const content = buildRarityTooltip(stub({}), '99Z9', 'Horse', NEUTRAL_EFFECTS);
    expect(content.lines).toEqual(['Not enough data at this locus']);
  });

  it('shows "Analysing…" while the baseline is still resolving', () => {
    // Distinct from "not enough data": the answer is coming, not absent.
    const content = buildRarityTooltip(null, '01A4', 'Horse', NEUTRAL_EFFECTS);
    expect(content.lines).toEqual(['Analysing…']);
  });

  it('reports a monomorphic locus as 100/0 rather than suppressing the absent arm', () => {
    const content = buildRarityTooltip(stub({ '01A4': tally(20, 20, 0, 0) }), '01A4', 'Horse', NEUTRAL_EFFECTS);
    expect(content.lines[0]).toContain('100.0%');
    expect(content.lines[1]).toContain('0.0%');
  });

  it('withholds "never seen" below the sole-carrier gate, where the colour withholds it too', () => {
    // 4 pets: measurable (8 known alleles), but `rarityBucket` refuses the
    // never-seen step under 10 known pets and paints the neutral centre. The card
    // must not make in words the claim the scale just declined to make in colour.
    const content = buildRarityTooltip(stub({ '01A4': tally(4, 4, 0, 0) }), '01A4', 'Horse', NEUTRAL_EFFECTS);
    expect(content.lines[1]).toContain('0 carriers');
    expect(content.lines[1]).not.toContain('never seen');
  });

  it('says "never seen" rather than "0 carriers" — that reading is acted on differently', () => {
    // An allele nobody owns cannot be bred for, only captured (#367). The words
    // carry that; the number does not.
    const content = buildRarityTooltip(stub({ '01A4': tally(20, 20, 0, 0) }), '01A4', 'Horse', NEUTRAL_EFFECTS);
    expect(content.lines[1]).toContain('never seen');
    expect(content.lines[1]).not.toContain('0 carriers');
    // The arm that IS carried still counts carriers.
    expect(content.lines[0]).toContain('20 carriers');
  });
});

/**
 * Placement is shared by both surfaces, so a locus is not positioned differently
 * depending on which grid you hovered.
 *
 * Every expectation is derived from `rarityTooltipSize` rather than restating its
 * constants: hardcoding them is how the previous version of this suite came to
 * "pass" against a card model that was 50px too wide and ~45px too short.
 */
describe('placeRarityTooltip', () => {
  const VIEWPORT = { width: 1000, height: 800 };
  const OFFSET = 12;
  const LINES = 3;
  const { width, height } = rarityTooltipSize(LINES);

  it('sits below and to the right of the cursor when there is room', () => {
    expect(placeRarityTooltip(100, 200, LINES, VIEWPORT)).toEqual({ x: 100 + OFFSET, y: 200 + OFFSET });
  });

  it('flips to the left of the cursor rather than overhanging the right edge', () => {
    const cursorX = VIEWPORT.width - 40;
    expect(placeRarityTooltip(cursorX, 200, LINES, VIEWPORT).x).toBe(cursorX - width - OFFSET);
  });

  it('flips above the cursor rather than overhanging the bottom edge', () => {
    const cursorY = VIEWPORT.height - 20;
    expect(placeRarityTooltip(100, cursorY, LINES, VIEWPORT).y).toBe(cursorY - height - OFFSET);
  });

  it('never places the card outside the viewport, on either axis', () => {
    // The size above is an estimate of a wrapping card, so the clamp — not the
    // estimate — is what guarantees this.
    for (const [x, y] of [
      [0, 0],
      [VIEWPORT.width, VIEWPORT.height],
      [VIEWPORT.width - 1, 5],
      [5, VIEWPORT.height - 1],
    ]) {
      const placed = placeRarityTooltip(x, y, LINES, VIEWPORT);
      expect(placed.x, `x at cursor ${x},${y}`).toBeGreaterThanOrEqual(0);
      expect(placed.y, `y at cursor ${x},${y}`).toBeGreaterThanOrEqual(0);
      expect(placed.x + width, `right edge at cursor ${x},${y}`).toBeLessThanOrEqual(VIEWPORT.width);
      expect(placed.y + height, `bottom edge at cursor ${x},${y}`).toBeLessThanOrEqual(VIEWPORT.height);
    }
  });

  it('grows the card with the line count, so a taller card flips sooner', () => {
    const cursorY = VIEWPORT.height - rarityTooltipSize(1).height - OFFSET - 1;
    expect(placeRarityTooltip(100, cursorY, 1, VIEWPORT).y).toBe(cursorY + OFFSET);
    expect(placeRarityTooltip(100, cursorY, 8, VIEWPORT).y).toBeLessThan(cursorY);
  });

  it('models the card no smaller than GeneTooltip renders it', () => {
    // Measured in Chromium: a 3-line rarity card is 225 × 145. Under-estimating
    // height is the error that clips the card; the model must not go below it.
    expect(width).toBeGreaterThanOrEqual(225);
    expect(height).toBeGreaterThanOrEqual(145);
    // ...and not wildly above the 250px cap GeneTooltip sets, or the card flips
    // away from the cursor when it would have fitted.
    expect(width).toBeLessThanOrEqual(250);
  });
});

describe('escaping on the way into a tooltip line', () => {
  it('is applied to effect text on its way into a tooltip line', () => {
    // Effect strings come from the gene template DB, which the user can edit
    // through the Reference editor, and the lines are rendered with `{@html}`.
    const content = buildRarityTooltip(stub({ '01A4': tally(10, 8, 0, 2) }), '01A4', 'Horse', {
      dominant: '<img src=x onerror=alert(1)>',
      recessive: 'Temperament+',
    });
    expect(content.lines[0]).not.toContain('<img');
    expect(content.lines[0]).toContain('&lt;img');
  });
});
