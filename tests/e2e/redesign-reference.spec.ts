import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers.js';

test.describe('Redesign — Reference destination', () => {
  test('flag-gated Reference hosts the gene-template editor with its own empty state', async ({ page }) => {
    // Hidden without the flag.
    await page.goto('/');
    await waitForAppReady(page);
    await expect(page.locator('[data-testid="tab-reference"]')).toHaveCount(0);

    await page.goto('/?redesign=1');
    await waitForAppReady(page);
    await page.locator('[data-testid="tab-reference"]').click();

    // Sidebar shows the gene-template editor controls…
    await expect(page.locator('#animalType')).toBeVisible();
    // …and the main area shows a fitting empty state (not the "select a pet" copy).
    await expect(page.locator('[data-testid="empty-state"]')).toContainText('Edit gene templates');

    // Picking an animal type + chromosome and editing opens the editing view.
    await page.locator('#animalType').selectOption('beewasp');
    await page.locator('#chromosome').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Edit Genes' }).click();
    await expect(page.locator('.gene-editing-view')).toBeVisible();
  });
});
