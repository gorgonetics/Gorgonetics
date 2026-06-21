import { expect, type Page, test } from '@playwright/test';
import { waitForAppReady } from './helpers.js';

// The redesign Library + Workspace shell lives behind the ?redesign=1 flag.
async function openLibrary(page: Page) {
  await page.goto('/?redesign=1');
  await waitForAppReady(page);
  await page.locator('[data-testid="tab-library"]').click();
  await expect(page.locator('[data-testid="library"]')).toBeVisible();
}

test.describe('Redesign — Library + Workspace shell', () => {
  test('the My Pets destination appears only with the flag', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await expect(page.locator('[data-testid="tab-library"]')).toHaveCount(0);

    await openLibrary(page);
    await expect(page.locator('[data-testid="tab-library"]')).toBeVisible();
  });

  test('selecting one pet shows its detail; the prompt shows when none selected', async ({ page }) => {
    await openLibrary(page);
    await expect(page.locator('[data-testid="workspace"] [data-testid="empty-state"]')).toBeVisible();

    await page.locator('[data-testid="pet-row-select"]').first().check();
    await expect(page.locator('.pet-visualization')).toBeVisible();
  });

  test('selecting two same-species pets opens the Compare lens', async ({ page }) => {
    await openLibrary(page);

    // Narrow to horses (the demo has two) so both selected pets share a species.
    await page.locator('[data-testid="filter-species"] [data-species="horse"]').click();
    const checks = page.locator('[data-testid="pet-row-select"]');
    await expect(checks).toHaveCount(2);
    await checks.nth(0).check();
    await checks.nth(1).check();

    await expect(page.locator('[data-testid="workspace-compare"]')).toBeVisible();
    await expect(page.locator('[data-testid="workspace-compare"]')).toContainText('Compare');
  });
});
