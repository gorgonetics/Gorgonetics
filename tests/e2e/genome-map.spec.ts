import { expect, test } from '@playwright/test';
import { gotoDestination, waitForPets } from './helpers.js';

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
});
