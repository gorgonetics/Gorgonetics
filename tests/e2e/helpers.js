import { expect } from '@playwright/test';

/** Wait for the app to finish initializing (DB + demo data). */
export async function waitForAppReady(page) {
  await page.waitForSelector('.top-bar');
  await page.waitForFunction(() => {
    const loading = document.querySelector('.loading-screen');
    const spinner = document.querySelector('.spinner');
    return !loading && !spinner;
  });
}

/** Wait for demo pet cards to appear in the list. */
export async function waitForPets(page) {
  await waitForAppReady(page);
  await page.waitForSelector('.pet-card');
}

/** Navigate to gene editor with a selected chromosome, return true if successful. */
export async function openGeneEditor(page) {
  await page.locator('.tab-btn').filter({ hasText: 'Genes' }).click();
  await expect(page.locator('#animalType option')).not.toHaveCount(1);

  const firstValue = await page.locator('#animalType option').nth(1).getAttribute('value');
  await page.locator('#animalType').selectOption(firstValue);

  await expect(page.locator('#chromosome option')).not.toHaveCount(1);

  const firstChrom = await page.locator('#chromosome option').nth(1).getAttribute('value');
  await page.locator('#chromosome').selectOption(firstChrom);

  await page.locator('button.load-btn').click();
  await expect(page.locator('.gene-editing-view')).toBeVisible();
}

/** Open the edit modal for the first pet. */
export async function openEditor(page) {
  await page.locator('.pet-card-wrapper').first().hover();
  await page.locator('.edit-btn').first().click();
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
export async function blockFirestore(page) {
  await page.route('**://firestore.googleapis.com/**', (route) => route.abort());
}
