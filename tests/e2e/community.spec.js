import { expect, test } from '@playwright/test';
import { waitForPets } from './helpers.js';

// Exercises the dialog flow: open, preview, cancel, backdrop, Escape, and the
// disabled state when Firebase is unconfigured (which is always true in this
// build — `src/lib/firebase.ts` ships a placeholder apiKey by design). The
// upload round-trip is covered by tests/integration/shareService.emulator.test.js.

test.describe('Share Pet Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);
    await page.locator('.pet-card').first().click();
    await expect(page.locator('.pet-visualization')).toBeVisible();
  });

  test('opens dialog showing a preview of the pet metadata', async ({ page }) => {
    const petName = await page.locator('.pet-card-name').first().textContent();

    await page.locator('[data-testid="share-pet-btn"]').click();

    const dialog = page.getByRole('dialog', { name: 'Share Pet to Community' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(petName.trim());
    await expect(page.locator('[data-testid="share-preview"]')).toBeVisible();
  });

  test('shows the not-configured banner and disables the Share button on this build', async ({ page }) => {
    await page.locator('[data-testid="share-pet-btn"]').click();

    await expect(page.locator('[data-testid="share-not-configured"]')).toBeVisible();
    await expect(page.locator('[data-testid="share-confirm"]')).toBeDisabled();
  });

  test('Cancel closes the dialog', async ({ page }) => {
    await page.locator('[data-testid="share-pet-btn"]').click();
    const dialog = page.getByRole('dialog', { name: 'Share Pet to Community' });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('Escape closes the dialog', async ({ page }) => {
    await page.locator('[data-testid="share-pet-btn"]').click();
    const dialog = page.getByRole('dialog', { name: 'Share Pet to Community' });
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  test('backdrop click closes the dialog', async ({ page }) => {
    await page.locator('[data-testid="share-pet-btn"]').click();
    const dialog = page.getByRole('dialog', { name: 'Share Pet to Community' });
    await expect(dialog).toBeVisible();

    // Click the backdrop near the top-left corner, away from the dialog body.
    await page.locator('[data-testid="share-pet-backdrop"]').click({ position: { x: 10, y: 10 } });
    await expect(dialog).not.toBeVisible();
  });
});

// PR 4 — Community catalogue browser tab.
// Firestore is unreachable in this build (placeholder apiKey), so the store
// surfaces the "not configured" error path. We assert the tab is reachable
// and that the empty/error state renders correctly. The real fetch +
// pagination + import paths are covered by the unit suite (mocked SDK) and
// the integration suite (Firestore Emulator).

test.describe('Community Tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);
  });

  test('Community tab is reachable from the TopBar', async ({ page }) => {
    await page.locator('[data-testid="tab-community"]').click();
    await expect(page.locator('[data-testid="community-tab"]')).toBeVisible();
  });

  test('surfaces the not-configured error when Firebase is not set up', async ({ page }) => {
    await page.locator('[data-testid="tab-community"]').click();
    const errorBox = page.locator('[data-testid="community-error"]');
    await expect(errorBox).toBeVisible();
    await expect(errorBox).toContainText(/not configured/i);
  });

  test('shows the empty-selection panel until a row is clicked', async ({ page }) => {
    await page.locator('[data-testid="tab-community"]').click();
    await expect(page.locator('[data-testid="community-empty-selection"]')).toBeVisible();
  });
});
