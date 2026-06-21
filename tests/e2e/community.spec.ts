import { expect, test } from '@playwright/test';
import { blockFirestore, waitForPets } from './helpers.js';

// Exercises the dialog flow: open, preview, cancel, backdrop, Escape, and the
// enabled Share button now that the real public Firebase config ships in the
// bundle (PR #279 — `isPlaceholderConfig` is false). Firestore traffic is
// aborted via `blockFirestore` so the suite stays offline and never touches
// the live project; the upload round-trip is covered by
// tests/integration/shareService.emulator.test.js.

test.describe('Share Pet Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await blockFirestore(page);
    await page.goto('/');
    await waitForPets(page);
    await page.locator('[data-testid="roster-open"]').first().click();
    await expect(page.locator('.pet-visualization')).toBeVisible();
  });

  test('opens dialog showing a preview of the pet metadata', async ({ page }) => {
    const petName = await page.locator('[data-testid="roster-open"]').first().textContent();

    await page.locator('[data-testid="share-pet-btn"]').click();

    const dialog = page.getByRole('dialog', { name: 'Share Pet to Community' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText((petName ?? '').trim());
    await expect(page.locator('[data-testid="share-preview"]')).toBeVisible();
  });

  test('enables the Share button now that Firebase is configured', async ({ page }) => {
    await page.locator('[data-testid="share-pet-btn"]').click();

    // Real config ships in the bundle, so the not-configured banner is gone
    // and the confirm button is live. We do not click it — that would attempt
    // a write, which `blockFirestore` aborts anyway.
    await expect(page.locator('[data-testid="share-not-configured"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="share-confirm"]')).toBeEnabled();
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
// Firebase is configured in this build (PR #279), but `blockFirestore`
// aborts all backend traffic so the suite stays offline and never touches
// the live project or burns Spark quota. We assert the tab renders and is
// navigable under a blocked backend. The fetch/error/pagination/import
// paths (including the load-error UI) are covered by the unit suite (mocked
// SDK) and the integration suite (Firestore Emulator) — exercising the
// network-error path here is unreliable because the Firestore SDK retries
// the WebChannel indefinitely rather than letting `getDocs` reject.

test.describe('Community Tab', () => {
  test.beforeEach(async ({ page }) => {
    await blockFirestore(page);
    await page.goto('/');
    await waitForPets(page);
  });

  test('Community tab is reachable from the TopBar', async ({ page }) => {
    await page.locator('[data-testid="tab-community"]').click();
    await expect(page.locator('[data-testid="community-tab"]')).toBeVisible();
  });

  test('shows the empty-selection panel until a row is clicked', async ({ page }) => {
    await page.locator('[data-testid="tab-community"]').click();
    await expect(page.locator('[data-testid="community-empty-selection"]')).toBeVisible();
  });
});
