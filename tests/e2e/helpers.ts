import { expect, type Page } from '@playwright/test';

/** Wait for the app to finish initializing (DB + demo data). */
export async function waitForAppReady(page: Page) {
  await page.waitForSelector('.top-bar');
  await page.waitForFunction(() => {
    const loading = document.querySelector('.loading-screen');
    const spinner = document.querySelector('.spinner');
    return !loading && !spinner;
  });
}

/** Wait for the Library (default destination) to render its pet rows. */
export async function waitForPets(page: Page) {
  await waitForAppReady(page);
  await page.waitForSelector('[data-testid="pet-row"]');
}

/** Open one of the three destinations by its nav button. */
export async function gotoDestination(page: Page, name: 'My Pets' | 'Community' | 'Reference') {
  const testid = name === 'My Pets' ? 'tab-library' : name === 'Community' ? 'tab-community' : 'tab-reference';
  await page.locator(`[data-testid="${testid}"]`).click();
}

/** Navigate to gene editor (Reference destination) with a selected chromosome. */
export async function openGeneEditor(page: Page) {
  await gotoDestination(page, 'Reference');
  await expect(page.locator('#animalType option')).not.toHaveCount(1);

  const firstValue = await page.locator('#animalType option').nth(1).getAttribute('value');
  await page.locator('#animalType').selectOption(firstValue);

  await expect(page.locator('#chromosome option')).not.toHaveCount(1);

  const firstChrom = await page.locator('#chromosome option').nth(1).getAttribute('value');
  await page.locator('#chromosome').selectOption(firstChrom);

  await page.locator('button.load-btn').click();
  await expect(page.locator('.gene-editing-view')).toBeVisible();
}

/** Open the edit modal for the first pet via its Library row action. */
export async function openEditor(page: Page) {
  await page.locator('[data-testid="pet-row"]').first().locator('[data-testid="pet-edit-btn"]').click();
  await expect(page.locator('.modal-panel')).toBeVisible();
}

/**
 * Abort every request to the Firestore backend so e2e never touches the
 * live `gorgonetics` project. Since PR #279 wired the real public config
 * into the bundle, `isPlaceholderConfig` is false in all builds — without
 * this, the community store's `listPets` would make non-deterministic
 * network calls against production and burn Spark read quota on each CI
 * run. Aborting makes `getDocs` reject with `unavailable`, exercising the
 * store's load-error path deterministically and offline.
 *
 * Install this BEFORE `page.goto` so the route is in place before any
 * SDK call fires.
 */
export async function blockFirestore(page: Page) {
  await page.route('**://firestore.googleapis.com/**', (route) => route.abort());
}
