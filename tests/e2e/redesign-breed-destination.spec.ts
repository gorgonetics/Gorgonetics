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
    // The covered pair table is made inert so focus / AT can't reach controls
    // hidden behind the overlay.
    await expect(page.getByTestId('breed-view')).toHaveAttribute('inert', '');
    // Wait out the heavy grid render (~2304 cells; slow under CPU contention).
    await expect(trio.locator('.role-label').first()).toBeVisible({ timeout: 30000 });
    await expect(trio.getByText('Offspring', { exact: false }).first()).toBeVisible();

    // Escape backs out (focus lands inside the overlay on open), returning to
    // the still-mounted pair table — the keyboard affordance the old modal had.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('trio-view')).toHaveCount(0);
    // Backed out to the breed destination; the covered table is interactive again.
    await expect(page.getByTestId('breed-view')).toBeVisible();
    await expect(page.getByTestId('breed-view')).not.toHaveAttribute('inert', '');
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

  test('offspring breed can be chosen and re-ranks the pairs (horses)', async ({ page }) => {
    await openBreed(page);
    await page.locator('[data-testid="breed-species"] [data-species="horse"]').click();
    await expect(page.locator('[data-testid="breeding-pair-table"]')).toBeVisible();

    // Horses expose an offspring-breed control that shapes the ranking.
    const offspring = page.getByTestId('breed-offspring');
    await expect(offspring).toBeVisible();

    const trigger = offspring.getByTestId('breed-selector-trigger');
    await trigger.click();
    const pop = offspring.getByTestId('breed-selector-pop');
    await expect(pop).toBeVisible();

    const opt = pop.locator('.bs-opt[data-breed]:not([data-breed=""])').first();
    const chosen = await opt.getAttribute('data-breed');
    await opt.click();

    await expect(pop).toHaveCount(0);
    await expect(trigger.locator('.bs-value')).toHaveText(chosen ?? '');
    // Re-ranks under the chosen breed without emptying the table.
    await expect(page.locator('[data-testid="breeding-pair-table"] tbody tr').first()).toBeVisible();
  });

  test('trio can hide locked-in loci to show new gains only', async ({ page }) => {
    test.slow();
    await openBreed(page);
    await page.locator('[data-testid="breed-species"] [data-species="horse"]').click();
    await expect(page.locator('[data-testid="breeding-pair-table"]')).toBeVisible();
    await page.locator('[data-testid="inspect-pair"]').first().click();

    const trio = page.getByTestId('trio-view');
    await expect(trio).toBeVisible();
    // Wait for the heavy grid (~2304 cells) to fully render before interacting,
    // so a click doesn't race the summary re-rendering as the grid settles.
    await expect(trio.locator('.role-label').first()).toBeVisible({ timeout: 30000 });
    await expect(trio.locator('.dist-bar').first()).toBeVisible();

    const toggle = trio.getByTestId('trio-hide-locked');
    // The toggle only exists when the pair has locked-in loci to hide.
    await expect(toggle).toBeVisible();
    const gainsChip = trio.locator('.chip-gain');
    await expect(gainsChip).toContainText('gains');
    await expect(gainsChip).not.toContainText('new gains');

    // force: the toggle is pinned and clickable, but the heavy grid reflowing
    // underneath can keep Playwright's stability check from settling under CI
    // CPU load. The assertions below confirm the click actually applied.
    await toggle.click({ force: true });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(gainsChip).toContainText('new gains');
    await expect(trio.locator('.trio-grid-container.hide-locked')).toBeVisible();
  });

  test('the offspring-breed control is horse-only', async ({ page }) => {
    await openBreed(page);
    await page.locator('[data-testid="breed-species"] [data-species="horse"]').click();
    await expect(page.getByTestId('breed-offspring')).toBeVisible();

    // Species without breeds (beewasp) don't expose the control.
    await page.locator('[data-testid="breed-species"] [data-species="beewasp"]').click();
    await expect(page.getByTestId('breed-offspring')).toHaveCount(0);
  });
});
