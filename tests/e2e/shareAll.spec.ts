import { expect, test } from '@playwright/test';
import { blockFirestore, gotoDestination, waitForPets } from './helpers.js';

// "Share all pets" — the background bulk-share flow. Firestore is blocked so no
// real writes happen; we assert the trigger, confirm gate, and the global,
// non-blocking progress widget (which lives at the layout root so it survives
// navigation). Actual upload success is covered by unit tests.

test.describe('Share all pets', () => {
  test.beforeEach(async ({ page }) => {
    await blockFirestore(page);
    await page.goto('/');
    await waitForPets(page);
  });

  test('button opens a confirm dialog that Cancel dismisses without sharing', async ({ page }) => {
    await page.locator('[data-testid="mypets-share-all"]').click();
    const dialog = page.locator('[data-testid="share-all-dialog"]');
    await expect(dialog).toBeVisible();
    // Confirm copy spells out "every pet", not the Stabled subset.
    await expect(dialog).toContainText('every pet in your collection');

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('[data-testid="bulk-share-progress-global"]')).toHaveCount(0);
  });

  test('confirming starts a non-blocking job whose progress survives navigation', async ({ page }) => {
    await page.locator('[data-testid="mypets-share-all"]').click();
    await page.locator('[data-testid="share-all-confirm"]').click();

    // Global, non-modal progress widget appears with a progress bar.
    const progress = page.locator('[data-testid="bulk-share-progress-global"]');
    await expect(progress).toBeVisible();
    await expect(progress.locator('[role="progressbar"]')).toBeVisible();

    // The app stays interactive while it runs: switch destinations and back.
    // The widget lives at the layout root, so it persists across navigation —
    // the defining property of a background job.
    await gotoDestination(page, 'Community');
    await expect(progress).toBeVisible();
    await gotoDestination(page, 'My Pets');
    await expect(progress).toBeVisible();
  });

  test('sharing a selection runs in the background via the global widget', async ({ page }) => {
    // Select two pets and share them. Like "Share all", the selected-pets flow
    // now delegates to the background job: the confirm dialog closes and the
    // global, non-blocking widget takes over — no in-modal progress bar.
    const checks = page.locator('[data-testid="roster-row-select"]');
    await checks.nth(0).check();
    await checks.nth(1).check();
    await expect(page.locator('[data-testid="mypets-selection"]')).toContainText('2 selected');

    await page.locator('[data-testid="mypets-share"]').click();
    await page.locator('[data-testid="bulk-share-confirm"]').click();

    // Confirm dialog is gone; the background widget is running.
    await expect(page.getByTestId('bulk-share-dialog')).toHaveCount(0);
    const progress = page.locator('[data-testid="bulk-share-progress-global"]');
    await expect(progress).toBeVisible();
    await expect(progress.locator('[role="progressbar"]')).toBeVisible();

    // The selection is cleared and the Share button is disabled while it runs.
    await expect(page.locator('[data-testid="mypets-selection"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="mypets-share-all"]')).toBeDisabled();
  });
});
