import { expect, test } from '@playwright/test';
import { waitForPets } from './helpers.js';

test.describe('Breeding Assistant — tab scaffold (PR 3)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);
  });

  test('shows the Breed tab in the top bar', async ({ page }) => {
    await expect(page.locator('.tab-btn').filter({ hasText: 'Breed' })).toBeVisible();
  });

  test('clicking the Breed tab activates the placeholder view', async ({ page }) => {
    const tab = page.locator('.tab-btn').filter({ hasText: 'Breed' });
    await tab.click();
    await expect(tab).toHaveClass(/active/);
    await expect(page.locator('[data-testid="breeding-tab"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Breeding Assistant/i })).toBeVisible();
  });

  test('placeholder lists eligible-parent counts per supported species', async ({ page }) => {
    await page.locator('.tab-btn').filter({ hasText: 'Breed' }).click();
    const list = page.locator('.species-list');
    await expect(list).toBeVisible();
    // Each currently supported species gets its own row. Asserted by name
    // rather than exact count so adding a new species in configService
    // doesn't break this test.
    await expect(list.locator('li').filter({ hasText: 'beewasp' })).toHaveCount(1);
    await expect(list.locator('li').filter({ hasText: 'horse' })).toHaveCount(1);
  });

  test('switching away from Breed tab and back preserves placeholder', async ({ page }) => {
    await page.locator('.tab-btn').filter({ hasText: 'Breed' }).click();
    await expect(page.locator('[data-testid="breeding-tab"]')).toBeVisible();

    await page.locator('.tab-btn').filter({ hasText: 'Pets' }).click();
    await expect(page.locator('[data-testid="breeding-tab"]')).toHaveCount(0);

    await page.locator('.tab-btn').filter({ hasText: 'Breed' }).click();
    await expect(page.locator('[data-testid="breeding-tab"]')).toBeVisible();
  });
});
