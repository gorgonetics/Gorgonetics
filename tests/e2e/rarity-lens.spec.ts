import { expect, test } from '@playwright/test';
import { waitForPets } from './helpers.js';

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
            out.push(`${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}=${Math.round(el.getBoundingClientRect().width)}`);
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
