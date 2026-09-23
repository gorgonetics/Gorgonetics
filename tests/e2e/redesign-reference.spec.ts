import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers.js';

test.describe('Redesign — Reference destination', () => {
  test('Reference is map-first, with the gene-template editor behind Edit', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await page.locator('[data-testid="tab-reference"]').click();

    // The species selector is shared by both modes, with a species preselected.
    await expect(page.getByTestId('reference-species')).toBeVisible();
    await expect(page.locator('[data-testid="reference-species"] .seg-btn.active')).toHaveCount(1);
    // Default is the genome map (#368 §7), not the editor — shown straight away.
    await expect(page.getByTestId('genome-map-grid')).toBeVisible();
    await expect(page.locator('#chromosome')).toHaveCount(0);
  });

  test('remembers the species pick across destination switches', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await page.locator('[data-testid="tab-reference"]').click();

    const inactive = page.locator('[data-testid="reference-species"] .seg-btn:not(.active)').first();
    const picked = await inactive.getAttribute('data-species');
    await inactive.click();
    await expect(page.locator(`[data-testid="reference-species"] [data-species="${picked}"]`)).toHaveClass(/active/);

    await page.locator('[data-testid="tab-mypets"]').click();
    await page.locator('[data-testid="tab-reference"]').click();
    await expect(page.locator(`[data-testid="reference-species"] [data-species="${picked}"]`)).toHaveClass(/active/);
  });

  test('the gene-template editor still opens and works from the Edit toggle', async ({ page }) => {
    // The map became the default, but editing must not be stranded — this is
    // the original assertion, reached through the new affordance.
    await page.goto('/');
    await waitForAppReady(page);
    await page.locator('[data-testid="tab-reference"]').click();
    await page.getByTestId('reference-edit-toggle').click();

    await expect(page.locator('[data-testid="empty-state"]')).toContainText('Edit gene templates');

    await page.locator('[data-testid="reference-species"] [data-species="beewasp"]').click();
    await page.locator('#chromosome').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Edit Genes' }).click();
    await expect(page.locator('.gene-editing-view')).toBeVisible();
  });
});
