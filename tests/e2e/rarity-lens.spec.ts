import { expect, test } from '@playwright/test';
import { resolveCssColours, waitForPets } from './helpers.js';

/**
 * The rarity lens (#368) — and above all the constraint that made its design
 * hard: **the grid must be byte-identical across Attributes / Appearance /
 * Rarity.**
 *
 * A rebuild-on-view-switch resized the grid on the first attempt at this
 * feature, and every layout patch made it worse. jsdom has no layout, so unit
 * tests cannot see this class of regression — it needs a real browser measuring
 * real boxes. That is what this file is for.
 */

const VIEWS = ['Attributes', 'Appearance', 'Rarity'] as const;

async function openPetDetail(page: import('@playwright/test').Page) {
  await page.locator('[data-testid="roster-open"]').first().click();
  await expect(page.getByTestId('view-rarity-btn')).toBeVisible();
  // The grid renders ~1500 cells asynchronously; wait for it to settle.
  await expect(page.locator('.gene-grid-container .gene-cell').first()).toBeVisible();
  // Park the mouse: after the click it can land on a grid cell, whose
  // `:hover` scale(1.2) inflates the measured box — geometry then compares
  // a hovered baseline against unhovered views and fails on pure noise.
  await page.mouse.move(0, 0);
}

/**
 * Geometry of the grid and of one reference cell, measured **after layout has
 * settled**.
 *
 * `.gene-cell` carries `transition: all 0.2s ease`, and cell size is the fixed
 * point of a ResizeObserver feedback loop, so a naive measurement taken right
 * after a click catches the animation mid-flight and reports differences that
 * are pure noise — including between a view and itself. Poll until two
 * consecutive animation frames agree.
 */
async function geometry(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const read = () => {
      const w = (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        return el ? Math.round(el.getBoundingClientRect().width * 100) / 100 : null;
      };
      const grid = document.querySelector('.gene-grid-container') as HTMLElement;
      const cell = document.querySelector('.gene-grid-container .gene-cell') as HTMLElement;
      const legend = document.querySelector('.gene-legend') as HTMLElement | null;
      const gr = grid.getBoundingClientRect();
      const cr = cell.getBoundingClientRect();
      return {
        gridWidth: Math.round(gr.width * 100) / 100,
        gridHeight: Math.round(gr.height * 100) / 100,
        gridLeft: Math.round(gr.left * 100) / 100,
        cellWidth: Math.round(cr.width * 100) / 100,
        cellHeight: Math.round(cr.height * 100) / 100,
        cellSizeVar: grid.style.getPropertyValue('--cell-size'),
        // Ancestors, so a failure says WHICH box moved rather than just that
        // one did. `.content-area` is a row: the drawer and the visualizer
        // share its width.
        contentAreaWidth: w('.content-area'),
        visualizerWidth: w('.visualizer-container'),
        drawerWidth: w('.stats-drawer'),
        // Full ancestor chain, so a failure names the element that actually
        // moved instead of leaving it to be guessed at.
        ancestors: (() => {
          const out: string[] = [];
          let el: HTMLElement | null = grid;
          while (el && el !== document.body) {
            // Drop `view-rarity`: it is a view-state marker, not layout
            // identity, and including it would make the chain differ by name
            // even when every box is identical.
            const cls = el.className
              ?.toString()
              .split(' ')
              .filter((c) => c && c !== 'view-rarity')
              .slice(0, 2)
              .join('.');
            out.push(
              `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}=${Math.round(el.getBoundingClientRect().width)}`,
            );
            el = el.parentElement;
          }
          return out.join(' < ');
        })(),
        legendHeight: legend ? Math.round(legend.getBoundingClientRect().height * 100) / 100 : null,
      };
    };
    const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

    let previous = JSON.stringify(read());
    let stableFor = 0;
    // Transitions run 200ms; ~40 frames is a generous ceiling.
    for (let i = 0; i < 60; i++) {
      await frame();
      const current = JSON.stringify(read());
      stableFor = current === previous ? stableFor + 1 : 0;
      previous = current;
      if (stableFor >= 8) break;
    }
    return JSON.parse(previous);
  });
}

test.describe('Gene rarity lens', () => {
  test.beforeEach(async ({ page }) => {
    // The effect is most visible at a large viewport: more width means a bigger
    // computed cell size, so any drift is scaled up rather than clamped away by
    // GENE_CELL_MIN/MAX.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await waitForPets(page);
  });

  test('grid geometry is identical across all three views', async ({ page }) => {
    await openPetDetail(page);

    const baseline = await geometry(page);
    for (const view of VIEWS) {
      await page.getByRole('button', { name: view, exact: true }).click();
      await expect(page.locator('.gene-grid-container .gene-cell').first()).toBeVisible();
      expect(await geometry(page), `geometry drifted in the ${view} view`).toEqual(baseline);
    }
  });

  test('grid geometry survives a round trip back to Attributes', async ({ page }) => {
    await openPetDetail(page);
    const before = await geometry(page);

    await page.getByRole('button', { name: 'Rarity', exact: true }).click();
    await page.getByRole('button', { name: 'Attributes', exact: true }).click();

    expect(await geometry(page)).toEqual(before);
  });

  test('geometry holds with the stats drawer open — it must stay mounted', async ({ page }) => {
    // Regression: unmounting the drawer on the rarity switch handed the grid an
    // extra `drawerWidth` px. `.content-area` is a row, so the drawer and the
    // visualizer share the width.
    await openPetDetail(page);
    await page.getByTestId('detail-stats-toggle').click();
    await expect(page.locator('.stats-drawer')).toBeVisible();

    const withDrawer = await geometry(page);
    await page.getByRole('button', { name: 'Rarity', exact: true }).click();

    await expect(page.locator('.stats-drawer')).toBeVisible();
    expect(await geometry(page)).toEqual(withDrawer);
  });

  test('the population toggle does not disturb the grid', async ({ page }) => {
    await openPetDetail(page);
    await page.getByRole('button', { name: 'Rarity', exact: true }).click();
    await expect(page.getByTestId('rarity-pop-all')).toBeVisible();

    const before = await geometry(page);
    await page.getByTestId('rarity-pop-stabled').click();
    expect(await geometry(page)).toEqual(before);
  });

  test('every zygosity paints the same area on the same uniform edge', async ({ page }) => {
    // `.gene-cell` carries an unconditional `border: 2px solid` (4px on
    // recessive) and `box-sizing: border-box` is global, so a hued or thicker
    // border in this view shrinks the fill and makes split cells read as smaller
    // than their neighbours — the reason §4 settled on one uniform hairline.
    //
    // Never-seen cells are the one sanctioned exception (§7): a different edge
    // COLOUR at the same width, so they are excluded from the edge comparison but
    // still bound by the geometry rule, which `rarityCSS` pins directly.
    await openPetDetail(page);
    await page.getByRole('button', { name: 'Rarity', exact: true }).click();
    await expect(page.getByTestId('rarity-legend')).toBeVisible();
    // The injected sheet arrives with the baseline, and `.gene-cell` transitions
    // `all 0.2s` — measuring before both have landed reads a border interpolating
    // between the attribute view's 2px and this view's hairline.
    await expect
      .poll(async () => (await page.locator('style#gene-visualizer-rarity').textContent())?.length ?? 0)
      .toBeGreaterThan(0);
    await page.waitForTimeout(400);

    const measured = await page.evaluate(() => {
      const box = (zygosity: string) => {
        // Skip cells the baseline could not score (below `minKnown`, deliberately
        // dashed in their own colour) and never-seen cells (their own edge colour
        // by design) — neither is the rule under test here.
        const cell = [
          ...document.querySelectorAll(
            `.gene-grid-container.view-rarity .gene-cell[data-zygosity="${zygosity}"]:not(.gene-unknown)`,
          ),
        ].find((el) => {
          const style = getComputedStyle(el);
          return style.borderStyle === 'solid' && !style.getPropertyValue('--rarity-edge').trim();
        }) as HTMLElement | undefined;
        if (!cell) return null;
        const style = getComputedStyle(cell);
        const rect = cell.getBoundingClientRect();
        const borders = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth];
        const width = Number.parseFloat(style.borderTopWidth);
        return {
          // The fill is the box inset by its border on each side — identical
          // outer boxes with different borders are NOT identical fills.
          filled: `${Math.round((rect.width - 2 * width) * 100) / 100}x${Math.round((rect.height - 2 * width) * 100) / 100}`,
          borders: [...new Set(borders)],
          colours: [
            ...new Set([style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor]),
          ],
        };
      };
      return {
        dominant: box('dominant'),
        recessive: box('recessive'),
        mixed: box('mixed'),
      };
    });

    // The tokens a border must never be painted with, plus the one it must be.
    const armTokens = [1, 2, 3, 4, 5].flatMap((b) => [`--rarity-d-${b}`, `--rarity-r-${b}`]);
    const [edge, ...armColours] = await resolveCssColours(page, ['--rarity-cell-edge', ...armTokens]);

    for (const zygosity of ['dominant', 'recessive', 'mixed'] as const) {
      expect(measured[zygosity], `no ${zygosity} cell rendered to measure`).not.toBeNull();
    }
    // One uniform hairline: same width on all four sides of all three.
    expect(measured.dominant?.borders).toEqual(['1px']);
    expect(measured.recessive?.borders, 'the recessive 4px ring is dropped in this view').toEqual(['1px']);
    expect(measured.mixed?.borders).toEqual(['1px']);
    // Same painted area, so a split cell cannot look smaller than a pure one.
    expect(measured.recessive?.filled).toBe(measured.dominant?.filled);
    expect(measured.mixed?.filled).toBe(measured.dominant?.filled);
    // One neutral edge everywhere, and never an arm hue: a coloured border would
    // put rarity on the outline where it misrepresents a two-armed cell.
    for (const zygosity of ['dominant', 'recessive', 'mixed'] as const) {
      expect(measured[zygosity]?.colours, `${zygosity} border is not the uniform edge`).toEqual([edge]);
      for (const arm of armColours) {
        expect(measured[zygosity]?.colours).not.toContain(arm);
      }
    }
  });

  test('the lens actually colours cells', async ({ page }) => {
    await openPetDetail(page);
    await page.getByRole('button', { name: 'Rarity', exact: true }).click();
    await expect(page.getByTestId('rarity-legend')).toBeVisible();
    await expect(page.locator('.gene-grid-container.view-rarity')).toBeVisible();

    // The baseline resolves asynchronously; once it has, the injected sheet
    // gives at least one cell a rarity custom property.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const cells = [...document.querySelectorAll('.view-rarity .gene-cell')];
            return cells.filter((c) => {
              const s = getComputedStyle(c);
              return s.getPropertyValue('--rarity-dom').trim() || s.getPropertyValue('--rarity-rec').trim();
            }).length;
          }),
        { message: 'no cell ever received a rarity custom property' },
      )
      .toBeGreaterThan(0);
  });
});

test.describe('rarity tooltip', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await waitForPets(page);
  });

  test('shows both alleles with exact percentages, not attribute-view text', async ({ page }) => {
    await openPetDetail(page);
    await page.getByRole('button', { name: 'Rarity', exact: true }).click();
    await expect(page.getByTestId('rarity-legend')).toBeVisible();

    await page.locator('.view-rarity .gene-cell').first().hover();
    const tip = page.locator('.gene-tooltip');
    await expect(tip).toBeVisible();

    const text = (await tip.textContent()) ?? '';
    // Both arms, always — not just on mixed cells.
    expect(text).toContain('Dominant');
    expect(text).toContain('Recessive');
    // Exact frequency to one decimal, or an honest "not enough data".
    expect(text).toMatch(/\d+\.\d%|Not enough data/);
    // The heading is the rarity one, not the attribute view's.
    expect(text).not.toContain('Potential Effects');
  });
});
