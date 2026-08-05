import { expect, test } from '@playwright/test';
import { gotoDestination, waitForPets } from './helpers.js';

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
function surfacePaint(page: import('@playwright/test').Page, root: string) {
  return page.evaluate((rootSelector) => {
    // Any colour FUNCTION, not just `rgb()`: the ramps are `color-mix(in oklab,
    // …)`, which Chromium resolves to `oklab(…)`, and an in-flight transition
    // interpolates in yet another space. An rgb-only pattern silently matches
    // nothing and every comparison below passes vacuously.
    const COLOUR = /(?:rgba?|hsla?|oklab|oklch|lab|lch|hwb|color)\([^)]*\)/g;
    const stops = (image: string) => [...image.matchAll(COLOUR)].map((m) => m[0]);
    const out: Record<string, { rec: string | null; dom: string | null; missing: boolean }> = {};
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

/**
 * Paint read only once it has stopped moving.
 *
 * `.gene-cell` carries `transition: all 0.2s ease`, so a read taken right after
 * a view switch or a filter change catches the animation mid-flight and reports
 * an interpolated colour — a difference that is pure noise, including between a
 * surface and itself.
 */
async function settledPaint(page: import('@playwright/test').Page, root: string): Promise<Record<string, Paint>> {
  let previous = JSON.stringify(await surfacePaint(page, root));
  // Transitions run 200ms; ~3s is a generous ceiling.
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(120);
    const current = JSON.stringify(await surfacePaint(page, root));
    if (current === previous) return JSON.parse(current);
    previous = current;
  }
  return JSON.parse(previous);
}

/** The resolved common-centre colour, so "is this cell tinted" is decidable. */
function neutralColour(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.background = 'var(--rarity-neutral)';
    document.body.appendChild(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  });
}

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
