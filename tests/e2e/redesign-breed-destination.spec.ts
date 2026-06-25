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
    // The trio grid (~2304 cells) is heavy; allow extra time under CPU contention.
    test.slow();
    await openBreed(page);
    await page.locator('[data-testid="breed-species"] [data-species="horse"]').click();
    await expect(page.locator('[data-testid="breeding-pair-table"]')).toBeVisible();

    await page.locator('[data-testid="inspect-pair"]').first().click();
    const trio = page.getByTestId('trio-view');
    await expect(trio).toBeVisible();
    // Unified with the single-pet / Compare lenses: an in-tab full-view overlay
    // with a back button — not the old modal popup (no backdrop).
    await expect(trio).toHaveClass(/detail-overlay/);
    await expect(trio.locator('.modal-backdrop')).toHaveCount(0);
    await expect(trio.getByTestId('trio-view-back')).toBeVisible();
    // Wait out the heavy grid render before asserting its labels.
    await expect(trio.locator('.role-label').first()).toBeVisible({ timeout: 15000 });
    await expect(trio.getByText('Offspring', { exact: false }).first()).toBeVisible();

    // Escape backs out (focus lands inside the overlay on open), returning to
    // the still-mounted pair table — the keyboard affordance the old modal had.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('trio-view')).toHaveCount(0);
    await expect(page.locator('[data-testid="breeding-pair-table"]')).toBeVisible();
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
