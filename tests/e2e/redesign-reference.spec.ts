import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers.js';

test.describe('Redesign — Reference destination', () => {
  test('Reference is map-first, with the gene-template editor behind Edit', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await page.locator('[data-testid="tab-reference"]').click();

    // The animal-type picker is shared by both modes.
    await expect(page.locator('#animalType')).toBeVisible();
    // Default is the genome map (#368 §7), not the editor.
    await expect(page.locator('[data-testid="empty-state"]')).toContainText('Genome map');
    await expect(page.locator('#chromosome')).toHaveCount(0);
  });

  test('the gene-template editor still opens and works from the Edit toggle', async ({ page }) => {
    // The map became the default, but editing must not be stranded — this is
    // the original assertion, reached through the new affordance.
    await page.goto('/');
    await waitForAppReady(page);
    await page.locator('[data-testid="tab-reference"]').click();
    await page.getByTestId('reference-edit-toggle').click();

    await expect(page.locator('[data-testid="empty-state"]')).toContainText('Edit gene templates');

    await page.locator('#animalType').selectOption('beewasp');
    await page.locator('#chromosome').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Edit Genes' }).click();
    await expect(page.locator('.gene-editing-view')).toBeVisible();
  });
});
