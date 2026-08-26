import { expect, test } from '@playwright/test';
import { gotoDestination, waitForPets } from './helpers.js';

/**
 * The breeding strategy picker.
 *
 * Breeding has no single objective — each strategy surfaces pairings the
 * others hide, so the player picks one per round and it drives both the
 * table sort and the planner (design doc §10a). These tests hold that
 * contract at the UI: the choice must visibly change the ranking, or the
 * picker is decoration.
 */

async function openBreed(page: import('@playwright/test').Page) {
  await waitForPets(page);
  await gotoDestination(page, 'Breed');
  await expect(page.getByTestId('breed-objective')).toBeVisible();
}

/**
 * The active sort header. Matched on `aria-sort`, which is the accessible
 * contract rather than a styling class — the class this table uses (`active`)
 * is not the one the roster uses, and picking the wrong one silently matches
 * nothing and passes.
 */
const sortedHeader = (page: import('@playwright/test').Page) =>
  page.locator('table thead th[aria-sort="descending"], table thead th[aria-sort="ascending"]');

test.describe('Breeding strategy picker', () => {
  test('offers the general strategies and one per attribute', async ({ page }) => {
    await page.goto('/');
    await openBreed(page);
    const labels = await page.locator('.objective-select option').allTextContents();
    expect(labels).toContain('Reach new ground');
    expect(labels).toContain('Raise the ceiling');
    expect(labels).toContain('Raise the floor');
    expect(labels).toContain('Clean the line');
    // Per-attribute strategies come from the species config.
    expect(labels.some((l) => l.startsWith('Improve '))).toBe(true);
  });

  test('defaults to genetic quality, not an absolute positive count', async ({ page }) => {
    await page.goto('/');
    await openBreed(page);
    await expect(sortedHeader(page)).toHaveText(/Quality/);
  });

  test('changing the strategy re-sorts the table by its column', async ({ page }) => {
    await page.goto('/');
    await openBreed(page);
    await page.locator('.objective-select').selectOption('floor');
    await expect(sortedHeader(page)).toHaveText(/Floor/);
    await page.locator('.objective-select').selectOption('clean');
    await expect(sortedHeader(page)).toHaveText(/Cleanup/);
  });

  test('an attribute strategy sorts by that attribute', async ({ page }) => {
    await page.goto('/');
    await openBreed(page);
    await page.locator('.objective-select').selectOption('attribute:Intelligence');
    await expect(sortedHeader(page)).toHaveText(/Intelligence/);
  });

  test('names the active strategy beside the results', async ({ page }) => {
    await page.goto('/');
    await openBreed(page);
    await page.locator('.objective-select').selectOption('ceiling');
    // The label alone does not say what a strategy costs; the line carries
    // the trade-off so a player is never sorting by an unexplained number.
    await expect(page.getByTestId('breed-objective-hint')).toHaveText('raise the ceiling');
    await expect(page.locator('.objective-why')).toContainText('beat the better parent');
  });

  test('every header has a matching cell — no silent column drift', async ({ page }) => {
    await page.goto('/');
    await openBreed(page);
    const headers = await page.locator('table thead th').count();
    const cells = await page.locator('table tbody tr').first().locator('td').count();
    expect(cells).toBe(headers);
  });
});
