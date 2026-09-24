import { expect, type Page, test } from '@playwright/test';
import { gotoDestination, waitForPets } from './helpers.js';

async function openPetOfSpecies(page: Page, species: 'horse' | 'beewasp') {
  await page.locator(`[data-testid="filter-species"] [data-species="${species}"]`).click();
  await page.locator('[data-testid="roster-open"]').first().click();
  await expect(page.locator('.pet-visualization')).toBeVisible();
}

/** How many grid cells the impact sheet painted with a hatch (declared, size unknown). */
function hatchedCells(page: Page, grid: string) {
  return page.evaluate((selector) => {
    const cells = [...document.querySelectorAll(`${selector} .gene-cell`)];
    return cells.filter((c) => {
      const s = getComputedStyle(c);
      const halves = [getComputedStyle(c, '::before'), getComputedStyle(c, '::after')];
      return [s, ...halves].some((x) => x.backgroundImage.includes('repeating-linear-gradient'));
    }).length;
  }, grid);
}

test.describe('Gene impact lens', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto('/');
    await waitForPets(page);
  });

  test('pet view shows declared effects and per-attribute totals', async ({ page }) => {
    await openPetOfSpecies(page, 'horse');
    await page.getByTestId('view-impact-btn').click();

    await expect(page.getByTestId('impact-legend')).toBeVisible();
    await expect(page.getByTestId('impact-summary')).toBeVisible();
    expect(await page.locator('[data-testid="impact-summary"] .impact-chip').count()).toBeGreaterThan(0);
    await expect.poll(() => hatchedCells(page, '.view-impact.gene-grid-container')).toBeGreaterThan(0);

    await page.getByTestId('detail-stats-toggle').click();
    await expect(page.getByTestId('stats-impact-note')).toBeVisible();
  });

  test('clicking an attribute shows only the genes expressing it, and the stats explain it', async ({ page }) => {
    await openPetOfSpecies(page, 'horse');
    await page.getByTestId('view-impact-btn').click();
    const chip = page.locator('[data-testid="impact-summary"] .impact-chip').first();
    const attribute = await chip.getAttribute('data-attribute');
    await chip.click();
    await expect(chip).toHaveClass(/selected/);

    const opacityOf = (selector: string) =>
      page.evaluate((s) => {
        const cell = document.querySelector(s);
        return cell ? getComputedStyle(cell).opacity : null;
      }, selector);
    const lit = `[data-attr="${attribute}"][data-effecttype="positive"]`;
    await expect.poll(() => opacityOf(`.view-impact .gene-cell${lit}`)).toBe('1');
    await expect
      .poll(() => opacityOf(`.view-impact .gene-cell[data-gene-id]:not([data-attr="${attribute}"])`))
      .not.toBe('1');

    await page.getByTestId('detail-stats-toggle').click();
    const row = page.locator(`.stats-drawer tr[data-attribute="${attribute}"]`);
    await expect(row).toHaveClass(/selected/);
    await expect(page.getByTestId('stats-impact-note')).toBeVisible();
  });

  test('an open stats drawer follows the grid with no refresh', async ({ page }) => {
    // The drawer reads the grid's state reactively (#537): open it first, then
    // change view and filter, and it must keep up on its own.
    await openPetOfSpecies(page, 'horse');
    await page.getByTestId('detail-stats-toggle').click();
    await expect(page.locator('.stats-drawer-title')).toHaveText('Attribute Effects');

    await page.getByTestId('view-impact-btn').click();
    await expect(page.locator('.stats-drawer-title')).toHaveText('Impact');
    // Impact totals load after the switch; the table picks them up.
    await expect(page.locator('.stats-drawer .stats-table td.pos').first()).not.toHaveText('—');

    const chip = page.locator('[data-testid="impact-summary"] .impact-chip').first();
    const attribute = await chip.getAttribute('data-attribute');
    await chip.click();
    await expect(page.locator(`.stats-drawer tr[data-attribute="${attribute}"]`)).toHaveClass(/selected/);
    await chip.click();
    await expect(page.locator(`.stats-drawer tr[data-attribute="${attribute}"]`)).not.toHaveClass(/selected/);
  });

  test('beewasps are studied too, so no coverage caveat shows', async ({ page }) => {
    await openPetOfSpecies(page, 'beewasp');
    await page.getByTestId('view-impact-btn').click();
    await expect(page.getByTestId('impact-summary')).toBeVisible();
    await expect(page.getByTestId('impact-status')).not.toContainText('does not cover');
  });

  test('genome map has an impact lens that is remembered', async ({ page }) => {
    await gotoDestination(page, 'Reference');
    await page.locator('[data-testid="reference-species"] [data-species="horse"]').click();
    await expect(page.getByTestId('map-pop-all')).toBeVisible();

    await page.getByTestId('map-lens-impact').click();
    await expect(page.getByTestId('map-impact-legend')).toBeVisible();
    // The rarity baseline has no meaning for impact, so its control goes.
    await expect(page.getByTestId('map-pop-all')).toHaveCount(0);
    await expect.poll(() => hatchedCells(page, '[data-testid="genome-map-grid"]')).toBeGreaterThan(0);

    await gotoDestination(page, 'My Pets');
    await gotoDestination(page, 'Reference');
    await expect(page.getByTestId('map-lens-impact')).toHaveClass(/active/);
    await expect(page.getByTestId('map-impact-legend')).toBeVisible();
  });
});
