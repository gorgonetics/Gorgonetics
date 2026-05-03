import { expect, test } from '@playwright/test';
import { waitForPets } from './helpers.js';

async function openBreedingTab(page) {
  await page.locator('.tab-btn').filter({ hasText: 'Breed' }).click();
  await expect(page.locator('[data-testid="breeding-tab"]')).toBeVisible();
}

async function pickSpeciesWithPairs(page) {
  // Try each species until we land on one that has at least one M × F
  // pair from the demo data; the breeding table only renders when the
  // service returns at least one result.
  const speciesButtons = page.locator('.species-btn');
  const count = await speciesButtons.count();
  const table = page.locator('[data-testid="breeding-pair-table"]');
  for (let i = 0; i < count; i++) {
    await speciesButtons.nth(i).click();
    try {
      await table.waitFor({ state: 'visible', timeout: 1000 });
      return true;
    } catch {
      // Empty state for this species — try the next one.
    }
  }
  return false;
}

test.describe('Breeding Assistant — ranking UI (PR 4)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);
  });

  test('renders the species toggle and ranks pairs for the active species', async ({ page }) => {
    await openBreedingTab(page);
    // Asserted by name rather than count so adding a new species in
    // configService doesn't break this test.
    await expect(page.locator('.species-btn').filter({ hasText: /beewasp/i })).toHaveCount(1);
    await expect(page.locator('.species-btn').filter({ hasText: /horse/i })).toHaveCount(1);

    const found = await pickSpeciesWithPairs(page);
    expect(found).toBe(true);
    const rows = page.locator('[data-testid="breeding-pair-table"] tbody tr');
    await expect(rows.first()).toBeVisible();
  });

  test('clicking a column header flips both the indicator and aria-sort', async ({ page }) => {
    await openBreedingTab(page);
    const found = await pickSpeciesWithPairs(page);
    expect(found).toBe(true);

    const totalHeader = page.locator('th').filter({ hasText: 'Total +' });
    await totalHeader.locator('button.sort-btn').click();
    await expect(totalHeader).toHaveAttribute('aria-sort', 'ascending');
    await expect(totalHeader.locator('button')).toContainText('▲');

    await totalHeader.locator('button.sort-btn').click();
    await expect(totalHeader).toHaveAttribute('aria-sort', 'descending');
    await expect(totalHeader.locator('button')).toContainText('▼');

    // If demo data ever grows to ≥2 pairs in one species, also verify
    // the rows actually re-order. With a single pair this collapses to
    // a no-op — the indicator/aria-sort assertions above still cover
    // the user-visible behaviour, and the unit-level sort math is
    // exercised by the breedingService tests.
    const rows = page.locator('[data-testid="breeding-pair-table"] tbody tr');
    const rowCount = await rows.count();
    if (rowCount >= 2) {
      const descTopName = await rows.first().locator('td').first().textContent();
      await totalHeader.locator('button.sort-btn').click(); // back to ascending
      await expect(totalHeader).toHaveAttribute('aria-sort', 'ascending');
      const ascTopName = await rows.first().locator('td').first().textContent();
      expect(ascTopName).not.toEqual(descTopName);
    }
  });

  test('horse offspring-breed selector appears when species is horse', async ({ page }) => {
    await openBreedingTab(page);
    const horseBtn = page.locator('.species-btn').filter({ hasText: /horse/i });
    if ((await horseBtn.count()) === 0) test.skip(true, 'no horse species supported in this build');
    await horseBtn.click();
    await expect(page.locator('[data-testid="offspring-breed"]')).toBeVisible();

    const beewaspBtn = page.locator('.species-btn').filter({ hasText: /beewasp/i });
    if ((await beewaspBtn.count()) > 0) {
      await beewaspBtn.click();
      await expect(page.locator('[data-testid="offspring-breed"]')).toHaveCount(0);
    }
  });

  test('clicking a parent name navigates to the Pets tab with that pet selected', async ({ page }) => {
    await openBreedingTab(page);
    const found = await pickSpeciesWithPairs(page);
    expect(found).toBe(true);

    const firstParent = page.locator('[data-testid="breeding-pair-table"] .parent-link').first();
    const name = (await firstParent.textContent())?.trim();
    await firstParent.click();

    await expect(page.locator('.tab-btn').filter({ hasText: 'Pets' })).toHaveClass(/active/);
    // Scope the name check to the detail pane — `getByText` against the
    // whole page would also match the pet card in the master list and
    // pass even if no pet were actually selected.
    await expect(page.locator('.detail-content').getByText(name, { exact: false }).first()).toBeVisible();
  });
});
