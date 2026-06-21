import { expect, type Page, test } from '@playwright/test';
import { waitForAppReady } from './helpers.js';

// The Breed lens — the Workspace lens that ranks M×F pairs among the selected
// pets and opens the trio inspector. Ports the retired Breeding tab's coverage:
// pair ranking, column sort, the trio rows, and the trio attribute/breed
// filters (PR #318), now reached by selecting same-species pets in the Library.

/** Select the two demo horses and open the Breed lens with its pair table. */
async function openBreedLens(page: Page) {
  await page.goto('/');
  await waitForAppReady(page);
  await page.locator('[data-testid="filter-species"] [data-species="horse"]').click();
  const checks = page.locator('[data-testid="pet-row-select"]');
  await expect(checks).toHaveCount(2);
  await checks.nth(0).check();
  await checks.nth(1).check();
  await page.locator('[data-testid="lens-tab-breed"]').click();
  await expect(page.locator('[data-testid="breeding-pair-table"]')).toBeVisible();
}

/** Open the trio inspector from the first ranked pair, waiting out the grid load. */
async function openTrio(page: Page) {
  await page.locator('[data-testid="inspect-pair"]').first().click();
  const trio = page.getByTestId('trio-view');
  await expect(trio).toBeVisible();
  // The trio grid (~2304 cells) computes and renders asynchronously; wait for a
  // role label so the heavy render is settled before asserting (avoids flake
  // under parallel workers).
  await expect(trio.locator('.role-label').first()).toBeVisible({ timeout: 15000 });
  return trio;
}

test.describe('Redesign — Breed lens', () => {
  test('ranks the selected pair and a column header toggles the sort', async ({ page }) => {
    await openBreedLens(page);
    await expect(page.locator('[data-testid="breeding-pair-table"] tbody tr').first()).toBeVisible();

    const totalHeader = page.locator('th').filter({ hasText: 'Total +' });
    await totalHeader.locator('button.sort-btn').click();
    await expect(totalHeader).toHaveAttribute('aria-sort', 'ascending');
    await expect(totalHeader.locator('button')).toContainText('▲');
    await totalHeader.locator('button.sort-btn').click();
    await expect(totalHeader).toHaveAttribute('aria-sort', 'descending');
    await expect(totalHeader.locator('button')).toContainText('▼');
  });

  test('inspecting a pair opens the trio with father / offspring / mother rows', async ({ page }) => {
    await openBreedLens(page);
    const trio = await openTrio(page);

    await expect(trio.getByText('Father', { exact: false }).first()).toBeVisible();
    await expect(trio.getByText('Offspring', { exact: false }).first()).toBeVisible();
    await expect(trio.getByText('Mother', { exact: false }).first()).toBeVisible();
    await expect(trio.locator('.offspring-row').first()).toBeVisible();

    await trio.getByRole('button', { name: 'Close trio view' }).click();
    await expect(page.getByTestId('trio-view')).toHaveCount(0);
  });

  test('the trio filters offspring loci by attribute', async ({ page }) => {
    await openBreedLens(page);
    const trio = await openTrio(page);

    const attrFilter = trio.getByTestId('trio-attribute-filter');
    await expect(attrFilter).toBeVisible();

    const firstAttr = attrFilter.locator('.attr-filter-btn').nth(1);
    await firstAttr.click();
    await expect(firstAttr).toHaveClass(/active/);
    await expect(attrFilter.locator('.attr-filter-btn').first()).not.toHaveClass(/active/);

    await firstAttr.click();
    await expect(attrFilter.locator('.attr-filter-btn').first()).toHaveClass(/active/);
  });

  test('the trio shows the horse offspring-breed filter, and changing it clears the attribute focus', async ({
    page,
  }) => {
    await openBreedLens(page);
    const trio = await openTrio(page);

    const breedFilter = trio.getByTestId('trio-breed-filter');
    await expect(breedFilter).toBeVisible();

    const attrFilter = trio.getByTestId('trio-attribute-filter');
    await attrFilter.locator('.attr-filter-btn').nth(1).click();
    await expect(attrFilter.locator('.attr-filter-btn').first()).not.toHaveClass(/active/);

    await breedFilter.locator('.breed-btn').nth(1).click();
    await expect(attrFilter.locator('.attr-filter-btn').first()).toHaveClass(/active/);
  });
});
