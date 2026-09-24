import { expect, type Page, test } from '@playwright/test';
import { gotoDestination, waitForPets } from './helpers.js';

/** Record a Toughness reading on a roster pet through the editor. */
async function setToughness(page: Page, name: string, value: number) {
  await page
    .locator('[data-testid="roster"] tbody tr', { hasText: name })
    .locator('[data-testid="pet-edit-btn"]')
    .click();
  await expect(page.getByTestId('pet-editor')).toBeVisible();
  await page.locator('#attr-Toughness').fill(String(value));
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByTestId('pet-editor')).toHaveCount(0);
}

async function openTrio(page: Page) {
  await gotoDestination(page, 'Breed');
  await page.locator('[data-testid="breed-species"] [data-species="horse"]').click();
  await page.locator('[data-testid="inspect-pair"]').first().click();
  await expect(page.getByTestId('trio-view')).toBeVisible();
  await page.getByTestId('trio-lens-impact').click();
}

test.describe('Trio impact lens', () => {
  test.beforeEach(async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto('/');
    await waitForPets(page);
  });

  test('requires an offspring breed before estimating anything', async ({ page }) => {
    await openTrio(page);
    await expect(page.getByTestId('trio-impact-breed-needed')).toBeVisible();
    await expect(page.getByTestId('trio-impact-table')).toHaveCount(0);

    await page.locator('[data-testid^="trio-impact-pick-"]').first().click();
    await expect(page.getByTestId('trio-impact-table')).toBeVisible();
    await expect(page.getByTestId('trio-impact-breed-needed')).toHaveCount(0);
  });

  test('compares the foal with same-breed parents, showing their recorded values', async ({ page }) => {
    // Both demo horses are Standardbred; record Toughness on each.
    await setToughness(page, 'Sample Horse', 60);
    await setToughness(page, 'Roach', 70);
    await openTrio(page);
    await page.getByTestId('trio-impact-pick-Standardbred').click();

    const row = page.locator('[data-testid="trio-impact-table"] tr[data-attribute="Toughness"]');
    await expect(row.locator('td').nth(1)).toHaveText('60');
    await expect(row.locator('td').nth(2)).toHaveText('70');
    // The demo data has no measured effects, so no gene can move the foal
    // past either parent: comparable, with a 0% chance either way.
    await expect(row.locator('td.beats')).toHaveText('0%');
    await expect(row.locator('td.below')).toHaveText('0%');
  });
});
