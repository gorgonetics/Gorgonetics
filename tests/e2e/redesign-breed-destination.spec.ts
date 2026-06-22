import { expect, type Page, test } from '@playwright/test';
import { waitForAppReady } from './helpers.js';

// The Breed destination — a first-class, search-first breeding helper reached
// from the top nav. Pick a species; it ranks pairs across the stabled pets of
// that species and opens the trio on inspect (no pre-selection needed).

async function openBreed(page: Page) {
  await page.goto('/');
  await waitForAppReady(page);
  await page.locator('[data-testid="tab-breed"]').click();
  await expect(page.locator('[data-testid="breed-view"]')).toBeVisible();
}

test.describe('Redesign — Breed destination', () => {
  test('is reachable from the top nav and ranks pairs by species', async ({ page }) => {
    await openBreed(page);
    await expect(page.locator('[data-testid="tab-breed"]')).toHaveClass(/active/);

    // Pick horses (the demo has a male + female) → a ranked pair table appears
    // without any pre-selection.
    await page.locator('[data-testid="breed-species"] [data-species="horse"]').click();
    await expect(page.locator('[data-testid="breeding-pair-table"]')).toBeVisible();
    await expect(page.locator('[data-testid="breeding-pair-table"] tbody tr').first()).toBeVisible();
  });

  test('inspecting a pair opens the offspring trio', async ({ page }) => {
    await openBreed(page);
    await page.locator('[data-testid="breed-species"] [data-species="horse"]').click();
    await expect(page.locator('[data-testid="breeding-pair-table"]')).toBeVisible();

    await page.locator('[data-testid="inspect-pair"]').first().click();
    const trio = page.getByTestId('trio-view');
    await expect(trio).toBeVisible();
    // Wait out the heavy grid render before asserting its labels.
    await expect(trio.locator('.role-label').first()).toBeVisible({ timeout: 15000 });
    await expect(trio.getByText('Offspring', { exact: false }).first()).toBeVisible();

    await trio.getByRole('button', { name: 'Close trio view' }).click();
    await expect(page.getByTestId('trio-view')).toHaveCount(0);
  });

  test('clicking a parent name opens that pet in My Pets', async ({ page }) => {
    await openBreed(page);
    await page.locator('[data-testid="breed-species"] [data-species="horse"]').click();
    await expect(page.locator('[data-testid="breeding-pair-table"]')).toBeVisible();

    await page.locator('[data-testid="breeding-pair-table"] .parent-link').first().click();

    // Jumps to My Pets with that pet's detail open.
    await expect(page.locator('[data-testid="tab-library"]')).toHaveClass(/active/);
    await expect(page.locator('[data-testid="pet-detail"]')).toBeVisible();
    await expect(page.locator('.pet-visualization')).toBeVisible();
  });
});
