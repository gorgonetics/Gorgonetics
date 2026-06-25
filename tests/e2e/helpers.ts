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

/** Wait for My Pets (the default destination) to render its roster table. */
export async function waitForPets(page: Page) {
  await waitForAppReady(page);
  await page.waitForSelector('[data-testid="roster-open"]');
  // The startup backfill chain fires loadPets() after the spinner clears,
  // re-rendering the roster. Wait for it to settle so a click doesn't race a
  // DOM swap that detaches the row/control mid-action. See AuthWrapper.
  await page.waitForSelector('[data-backfills-done="true"]');
}

/** Open one of the destinations by its nav button. */
export async function gotoDestination(page: Page, name: 'My Pets' | 'Breed' | 'Community' | 'Reference') {
  const map = { 'My Pets': 'tab-library', Breed: 'tab-breed', Community: 'tab-community', Reference: 'tab-reference' };
  await page.locator(`[data-testid="${map[name]}"]`).click();
}

/** Open the first pet's detail (full-view) from the roster table. */
export async function openFirstPet(page: Page) {
  await page.locator('[data-testid="roster-open"]').first().click();
  await expect(page.locator('[data-testid="pet-detail"]')).toBeVisible();
  await expect(page.locator('.pet-visualization')).toBeVisible();
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

/** Open the edit modal for the first pet via its roster row action. */
export async function openEditor(page: Page) {
  await page.locator('[data-testid="roster"] tbody tr').first().locator('[data-testid="pet-edit-btn"]').click();
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
