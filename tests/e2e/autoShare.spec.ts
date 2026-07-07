import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers.js';

// The auto-share-on-import toggle. Sharing itself needs Firestore (covered by
// unit tests with mocks); here we only assert the opt-in control is present,
// defaults OFF, toggles, and persists — the privacy-critical contract is that
// it is never on unless the user turned it on.

test.describe('Auto-share on import setting', () => {
  test('toggle is present and defaults to OFF', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await page.locator('.settings-toggle').click();
    const toggle = page.locator('[data-testid="setting-auto-share"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(toggle).not.toHaveClass(/toggle-on/);
  });

  test('toggling on survives closing and reopening the modal', async ({ page }) => {
    // Within-session only: the e2e DB is in-memory and resets on reload, so true
    // cross-session DB persistence is covered by the settingsService unit test.
    await page.goto('/');
    await waitForAppReady(page);

    await page.locator('.settings-toggle').click();
    const toggle = page.locator('[data-testid="setting-auto-share"]');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="settings-view"]')).not.toBeVisible();
    await page.locator('.settings-toggle').click();
    await expect(page.locator('[data-testid="setting-auto-share"]')).toHaveAttribute('aria-checked', 'true');
  });
});
