import { expect, type Page, test } from '@playwright/test';
import { gotoDestination, resolveCssColours, settled, waitForPets } from './helpers.js';

/**
 * Per-locus paint on either surface, read off the rendered pixels rather than
 * off the model: the recessive half is the first gradient stop (top-left on the
 * shared 135deg axis), the dominant half the second. A pure cell paints one
 * flat colour and carries only that arm.
 */
interface Paint {
  rec: string | null;
  dom: string | null;
  missing: boolean;
}

/**
 * Read every cell of one grid as `{geneId: Paint}`.
 *
 * Runs in the page because only the browser can resolve `color-mix` ramps and
 * gradient stops to concrete colours — which is the point: comparing resolved
 * paint catches a scale or orientation drift that comparing bucket numbers
 * would not.
 */
function surfacePaint(page: Page, root: string) {
  return page.evaluate((rootSelector) => {
    // Any colour FUNCTION, not just `rgb()`: the ramps are `color-mix(in oklab,
    // …)`, which Chromium resolves to `oklab(…)`, and an in-flight transition
    // interpolates in yet another space. An rgb-only pattern silently matches
    // nothing and every comparison below passes vacuously.
    const COLOUR = /(?:rgba?|hsla?|oklab|oklch|lab|lch|hwb|color)\([^)]*\)/g;
    const stops = (image: string) => [...image.matchAll(COLOUR)].map((m) => m[0]);
    const out: Record<string, Paint> = {};
    for (const el of document.querySelectorAll(`${rootSelector} .gene-cell[data-gene-id]`)) {
      const cell = el as HTMLElement;
      const geneId = cell.dataset.geneId;
      if (!geneId) continue;
      // `?` readings carry no rarity signal and are dashed by `gene-unknown`.
      if (cell.classList.contains('gene-unknown')) continue;
      const style = getComputedStyle(cell);
      const image = style.backgroundImage;
      const missing = style.borderStyle === 'dashed';
      switch (cell.dataset.zygosity) {
        case 'mixed': {
          const [rec, dom] = stops(image);
          out[geneId] = { rec: rec ?? null, dom: dom ?? null, missing: missing || image === 'none' };
          break;
        }
        case 'dominant':
          out[geneId] = { rec: null, dom: style.backgroundColor, missing };
          break;
        case 'recessive':
          out[geneId] = { rec: style.backgroundColor, dom: null, missing };
          break;
      }
    }
    return out;
  }, root);
}

/** Paint read only once it has stopped moving — see `settled`. */
const settledPaint = (page: Page, root: string): Promise<Record<string, Paint>> =>
  settled(page, () => surfacePaint(page, root));

/**
 * Cell pitch and block gap for one grid, measured off the first chromosome row
 * once layout has settled.
 *
 * `computeGeneCellSize` budgets a 1px gutter each side of every cell plus one
 * BLOCK_GAP per block, so a grid that omits them lays out tighter than the size
 * it asked for — which is how the map came to look denser than the pet grid.
 */
const gridPitch = (page: Page, root: string) => settled(page, () => readPitch(page, root));

function readPitch(page: Page, root: string) {
  return page.evaluate((rootSelector) => {
    const container = document.querySelector(rootSelector) as HTMLElement;
    const row = container.querySelector('.chromosome-row') as HTMLElement;
    const cells = [...row.querySelectorAll('.gene-cell')].slice(0, 12);
    const lefts = cells.map((c) => c.getBoundingClientRect().left);
    const pitches = lefts.slice(1).map((left, i) => Math.round(left - lefts[i]));
    const cellSize = Number.parseFloat(container.style.getPropertyValue('--cell-size'));
    return {
      cellSize,
      cellWidth: Math.round(cells[0].getBoundingClientRect().width),
      // Within a block every column is one cell-size apart; the first column of
      // a block is further out by the block gap.
      inBlock: Math.min(...pitches),
      acrossBlocks: Math.max(...pitches),
    };
  }, root);
}

/** The resolved common-centre colour, so "is this cell tinted" is decidable. */
const neutralColour = async (page: Page) => (await resolveCssColours(page, ['--rarity-neutral']))[0];

const tinted = (paint: Paint, neutral: string) =>
  (paint.rec !== null && paint.rec !== neutral) || (paint.dom !== null && paint.dom !== neutral);

/**
 * The fixture DB has several horses but only one beewasp, so the two species
 * exercise opposite ends of the same rule: horse has a real baseline, beewasp
 * sits below `minKnown` and must render as missing data rather than as
 * spuriously rare. Both are asserted below.
 */
async function selectSpecies(page: import('@playwright/test').Page, name: string) {
  const labels = await page.locator('#animalType option').allTextContents();
  const match = labels.find((l) => l.toLowerCase() === name);
  expect(match, `no ${name} among ${JSON.stringify(labels)}`).toBeTruthy();
  await page.locator('#animalType').selectOption({ label: match as string });
  await expect(page.getByTestId('genome-map-grid')).toBeVisible();
}

/** How many cells the injected sheet gave a rarity colour to. */
function colouredCells(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const cells = [...document.querySelectorAll('[data-testid="genome-map-grid"] .gene-cell')];
    return cells.filter((c) => {
      const s = getComputedStyle(c);
      return s.getPropertyValue('--rarity-dom').trim() || s.getPropertyValue('--rarity-rec').trim();
    }).length;
  });
}

/** Reference genome map (#368, design §7). */
test.describe('Genome map', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await waitForPets(page);
    await gotoDestination(page, 'Reference');
  });

  test('is the default view, with the template editor behind an Edit toggle', async ({ page }) => {
    await expect(page.getByTestId('reference-edit-toggle')).toBeVisible();
    // Map mode by default: no chromosome picker until Edit is on.
    await expect(page.locator('#chromosome')).toHaveCount(0);

    await page.getByTestId('reference-edit-toggle').click();
    await expect(page.locator('#chromosome')).toBeVisible();
  });

  test('renders the whole genome for the selected species', async ({ page }) => {
    await selectSpecies(page, 'horse');

    const cells = page.locator('[data-testid="genome-map-grid"] .gene-cell');
    await expect.poll(async () => cells.count()).toBeGreaterThan(100);
    // Every map cell is the mixed case — that is the model, not a shortcut.
    const zygs = await page.evaluate(
      () =>
        new Set(
          [...document.querySelectorAll('[data-testid="genome-map-grid"] .gene-cell')].map(
            (c) => (c as HTMLElement).dataset.zygosity,
          ),
        ).size,
    );
    expect(zygs).toBe(1);
  });

  test('colours cells from the same baseline the pet lens uses', async ({ page }) => {
    await selectSpecies(page, 'horse');
    await expect.poll(() => colouredCells(page)).toBeGreaterThan(0);
  });

  test('a species below minKnown renders as missing data, not as rare', async ({ page }) => {
    // One beewasp in the fixture = 2 known alleles, under the 4-allele floor.
    // Frequency 0/1 must not be mistaken for scarcity when there is no sample.
    await selectSpecies(page, 'beewasp');
    await page.waitForTimeout(600);
    expect(await colouredCells(page)).toBe(0);
  });

  test('the baseline toggle does not change the grid geometry', async ({ page }) => {
    await selectSpecies(page, 'horse');
    const rect = () =>
      page.evaluate(() => {
        const el = document.querySelector('[data-testid="genome-map-grid"]') as HTMLElement;
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), cell: el.style.getPropertyValue('--cell-size') };
      });
    const before = await rect();
    await page.getByTestId('map-pop-stabled').click();
    await page.waitForTimeout(400);
    expect(await rect()).toEqual(before);
  });

  test('is reachable and navigable by keyboard', async ({ page }) => {
    // The map is the one surface where allele frequencies are readable without a
    // pet, so a keyboard user losing access to it loses the data entirely.
    await selectSpecies(page, 'horse');
    const first = page.locator('[data-testid="genome-map-grid"] .gene-cell[data-gene-id]').first();
    await first.focus();
    await expect(first).toBeFocused();

    const focusedId = () =>
      page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.geneId ?? null);
    const start = await focusedId();

    await page.keyboard.press('ArrowRight');
    expect(await focusedId(), 'ArrowRight did not move focus').not.toBe(start);
    await page.keyboard.press('ArrowDown');
    expect(await focusedId()).not.toBe(start);

    // Enter opens the card for the focused cell, without a pointer anywhere near.
    await page.keyboard.press('Enter');
    await expect(page.locator('.gene-tooltip')).toBeVisible();
    const tip = await page.locator('.gene-tooltip').textContent();
    expect(tip).toContain(await focusedId());
  });

  test('renders with no pet loaded at all — the map has no pet in it', async ({ page }) => {
    // The map answers "where is there scarce material in my stock", which has no
    // pet in it: the grid comes from the gene template, not from a genome. So it
    // must render its full structure without ever visiting a pet, and every cell
    // must be the mixed case even before a baseline exists.
    await selectSpecies(page, 'horse');
    expect(await page.locator('[data-testid="pet-detail"]').count()).toBe(0);

    const cells = page.locator('[data-testid="genome-map-grid"] .gene-cell');
    await expect.poll(async () => cells.count()).toBeGreaterThan(100);
    await expect(page.locator('[data-testid="genome-map-grid"] .chromosome-row').first()).toBeVisible();
  });

  test('the breed control filters the DISPLAY without rescoping the baseline', async ({ page }) => {
    // §7/§8: every horse carries all ten breeds' loci, so breed-scoped
    // populations are rejected — scoping to one breed would discard most of the
    // evidence for genes the whole collection holds. The control therefore
    // narrows which loci are *shown* while every remaining cell keeps the colour
    // it had, computed across all pets of the species.
    await selectSpecies(page, 'horse');
    await expect.poll(() => colouredCells(page)).toBeGreaterThan(0);

    const wholeGenome = await settledPaint(page, '[data-testid="genome-map-grid"]');
    const beforeCount = Object.keys(wholeGenome).length;

    await page.getByTestId('breed-selector-trigger').click();
    await page.locator('[data-testid="breed-selector-pop"] [data-breed="Kurbone"]').click();
    await expect(page.getByTestId('genome-map-grid')).toBeVisible();
    await expect
      .poll(async () => Object.keys(await surfacePaint(page, '[data-testid="genome-map-grid"]')).length, {
        message: 'the breed filter never narrowed the displayed genome',
      })
      .toBeLessThan(beforeCount);

    const sliced = await settledPaint(page, '[data-testid="genome-map-grid"]');
    const drifted: string[] = [];
    let compared = 0;
    let scored = 0;
    for (const [geneId, paint] of Object.entries(sliced)) {
      const before = wholeGenome[geneId];
      if (!before) continue;
      compared++;
      // Untagged loci survive every breed filter (§7), so a scored survivor is
      // guaranteed — without one this would compare nothing but missing data.
      if (!paint.missing) scored++;
      if (JSON.stringify(paint) !== JSON.stringify(before)) {
        drifted.push(`${geneId}: ${JSON.stringify(before)} → ${JSON.stringify(paint)}`);
      }
    }
    expect(drifted.slice(0, 5), 'a displayed locus changed colour, so the baseline was rescoped').toEqual([]);
    expect(compared).toBeGreaterThan(50);
    expect(scored, 'every surviving locus was missing data, so nothing was really compared').toBeGreaterThan(0);
  });
});

/**
 * The two surfaces must share one scale and one orientation (§7, §10).
 *
 * A map cell is *defined* as what a fully-mixed pet would render at that locus,
 * so this is the strongest available guard: read the resolved paint off both
 * grids and require a locus to look the same on each, arm for arm. Comparing
 * bucket numbers would not catch a swapped gradient axis; comparing pixels does.
 */
test.describe('map and pet grid agree cell for cell', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await waitForPets(page);
  });

  /**
   * Run at two widths on purpose.
   *
   * At 1920 both containers compute a cell size above `GENE_CELL_MAX` and clamp to
   * it, so a bare `toEqual` between the two surfaces passes trivially — it was
   * comparing two clamped 24s, not two spacing rules. At 1100 the panels (pet
   * detail vs `.ref-body`, which has its own padding) resolve to *different*
   * unclamped sizes, so only the size-independent relations can be asserted:
   * each surface's own gutter and gap, and the gap being the same number of px on
   * both. Those are what a padding regression actually breaks.
   */
  for (const width of [1920, 1100]) {
    test(`spaces its cells and blocks as the pet grid does, at ${width}px`, async ({ page }) => {
      // The map shipped with `padding: 0` on its cell containers, which dropped
      // both the 1px gutter and the block gap: same cells, visibly denser grid,
      // and narrower than the width `computeGeneCellSize` had budgeted for.
      await page.setViewportSize({ width, height: 1080 });
      await page.getByTestId('roster-open').filter({ hasText: 'Roach' }).click();
      await expect(page.locator('.gene-grid-container .gene-cell').first()).toBeVisible();
      // Park the mouse so no cell measures with its :hover scale applied.
      await page.mouse.move(0, 0);
      const petGrid = await gridPitch(page, '.gene-grid-container');

      await gotoDestination(page, 'Reference');
      await selectSpecies(page, 'horse');
      const map = await gridPitch(page, '[data-testid="genome-map-grid"]');

      for (const [surface, geometry] of [
        ['pet grid', petGrid],
        ['map', map],
      ] as const) {
        // The cell is its slot inset by the 1px gutter on each side.
        expect(geometry.cellWidth, `${surface} cell width`).toBe(geometry.cellSize - 2);
        expect(geometry.inBlock, `${surface} column pitch`).toBe(geometry.cellSize);
        expect(geometry.acrossBlocks, `${surface} block gap`).toBeGreaterThan(geometry.cellSize);
      }
      // Size-independent: the block gap is a fixed px value (BLOCK_GAP), so it
      // must agree across surfaces even when the cell sizes legitimately differ.
      expect(map.acrossBlocks - map.inBlock, 'block gap differs between surfaces').toBe(
        petGrid.acrossBlocks - petGrid.inBlock,
      );
    });
  }

  test('a locus paints the same colour on the same half on both surfaces', async ({ page }) => {
    // Roach is a horse, so it shares a species — and therefore a baseline — with
    // the horse genome map. Both surfaces default to "All my pets".
    await page.getByTestId('roster-open').filter({ hasText: 'Roach' }).click();
    await page.getByRole('button', { name: 'Rarity', exact: true }).click();
    await expect(page.getByTestId('rarity-legend')).toBeVisible();

    const neutral = await neutralColour(page);
    await expect
      .poll(async () => {
        const paint = await surfacePaint(page, '.gene-grid-container.view-rarity');
        return Object.values(paint).filter((p) => tinted(p as Paint, neutral)).length;
      })
      .toBeGreaterThan(0);
    const petPaint = await settledPaint(page, '.gene-grid-container.view-rarity');

    await gotoDestination(page, 'Reference');
    await selectSpecies(page, 'horse');
    // A lingering pet stylesheet would colour the map from the pet's baseline
    // and make this comparison vacuous — it is scoped to `.view-rarity`, which
    // the map container also carries.
    expect(await page.locator('style#gene-visualizer-rarity').count()).toBe(0);
    await expect.poll(() => colouredCells(page)).toBeGreaterThan(0);
    const mapPaint = await settledPaint(page, '[data-testid="genome-map-grid"]');

    const mismatches: string[] = [];
    let compared = 0;
    let tintedLoci = 0;
    for (const [geneId, pet] of Object.entries(petPaint) as [string, Paint][]) {
      const map = mapPaint[geneId] as Paint | undefined;
      if (!map) continue;
      compared++;
      if (pet.missing || map.missing) {
        // Under-studied loci must read as missing on both, or one surface is
        // inventing evidence the other does not have.
        if (pet.missing !== map.missing) {
          mismatches.push(`${geneId}: missing-data disagrees (pet ${pet.missing}, map ${map.missing})`);
        }
        continue;
      }
      if (tinted(pet, neutral)) tintedLoci++;
      // Only the arms the pet actually carries are comparable: a pure D cell
      // says nothing about the recessive half.
      if (pet.rec !== null && pet.rec !== map.rec) {
        mismatches.push(`${geneId}: recessive half pet ${pet.rec} vs map ${map.rec}`);
      }
      if (pet.dom !== null && pet.dom !== map.dom) {
        mismatches.push(`${geneId}: dominant half pet ${pet.dom} vs map ${map.dom}`);
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(compared, 'the two surfaces shared almost no loci — the comparison was vacuous').toBeGreaterThan(100);
    // A grid of nothing but the common centre would match trivially, including
    // with the two halves swapped.
    expect(tintedLoci, 'no locus was tinted on the pet grid, so hue was never compared').toBeGreaterThan(0);
  });
});
