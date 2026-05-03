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
  for (let i = 0; i < count; i++) {
    await speciesButtons.nth(i).click();
    const table = page.locator('[data-testid="breeding-pair-table"]');
    if (await table.isVisible().catch(() => false)) return true;
    // Wait briefly for the empty state vs loading state to settle.
    await page.waitForTimeout(200);
    if (await table.isVisible().catch(() => false)) return true;
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
    await expect(page.locator('.species-btn')).toHaveCount(2);

    const found = await pickSpeciesWithPairs(page);
    if (!found) {
      // Demo data lacks both genders for any species — verify the empty
      // state at least surfaces the diagnostic counts so this never silently
      // passes if the demo seeding changes.
      await expect(page.locator('[data-testid="breeding-empty"]')).toBeVisible();
      return;
    }

    const rows = page.locator('[data-testid="breeding-pair-table"] tbody tr');
    await expect(rows.first()).toBeVisible();
  });

  test('clicking a column header sorts the table', async ({ page }) => {
    await openBreedingTab(page);
    const found = await pickSpeciesWithPairs(page);
    test.skip(!found, 'demo data has no eligible breeding pairs');

    const totalHeader = page.locator('th button.sort-btn').filter({ hasText: 'Total +' });
    await totalHeader.click();
    // Asc indicator first click
    await expect(page.locator('th.active button')).toContainText('▲');
    await totalHeader.click();
    await expect(page.locator('th.active button')).toContainText('▼');
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
    test.skip(!found, 'demo data has no eligible breeding pairs');

    const firstParent = page.locator('[data-testid="breeding-pair-table"] .parent-link').first();
    const name = (await firstParent.textContent())?.trim();
    await firstParent.click();

    await expect(page.locator('.tab-btn').filter({ hasText: 'Pets' })).toHaveClass(/active/);
    // Detail pane should show the selected pet's name somewhere — leaning
    // on visibility of the pet header rather than locking to a specific
    // class, since PetVisualization's structure is owned by another team.
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible();
  });
});
