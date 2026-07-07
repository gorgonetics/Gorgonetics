import { expect, type Page, test } from '@playwright/test';
import { waitForAppReady } from './helpers.js';

// The Roster — the Workspace's full attribute table when nothing is selected —
// absorbs the retired Stable tab. These cover the table itself: columns, sort,
// per-species columns, and search narrowing (ported from stable-table.spec).

async function openRoster(page: Page) {
  await page.goto('/');
  await waitForAppReady(page);
  await expect(page.locator('[data-testid="my-pets"]')).toBeVisible();
  await expect(page.locator('[data-testid="roster"]')).toBeVisible();
}

test.describe('Redesign — Roster table', () => {
  test('renders the table with the core columns and at least one row', async ({ page }) => {
    await openRoster(page);
    const headers = page.locator('[data-testid="roster"] thead th');
    await expect(headers.filter({ hasText: 'Name' })).toHaveCount(1);
    await expect(headers.filter({ hasText: 'Gender' })).toHaveCount(1);
    await expect(headers.filter({ hasText: '+ Genes' })).toHaveCount(1);
    await expect(page.locator('[data-testid="roster"] tbody tr').first()).toBeVisible();
  });

  test('selecting a species reveals that species attribute columns', async ({ page }) => {
    await openRoster(page);
    const headerCells = page.locator('[data-testid="roster"] thead th');
    // Narrow to horses; horse-specific attribute columns appear alongside Total.
    await page.locator('[data-testid="filter-species"] [data-species="horse"]').click();
    await expect(headerCells.filter({ hasText: 'Total' })).toHaveCount(1);
    // More than the four species-agnostic columns once attributes are shown.
    await expect.poll(() => headerCells.count()).toBeGreaterThan(5);
  });

  test('clicking a header toggles the sort direction', async ({ page }) => {
    await openRoster(page);
    // Name is the default sort column (ascending ▲); clicking flips it.
    const nameBtn = page.locator('[data-testid="roster"] thead th').filter({ hasText: 'Name' }).locator('.sort-btn');
    await expect(nameBtn).toContainText('▲');
    await nameBtn.click();
    await expect(nameBtn).toContainText('▼');
    await nameBtn.click();
    await expect(nameBtn).toContainText('▲');
  });

  test('search narrows the rows by pet name', async ({ page }) => {
    await openRoster(page);
    const rows = page.locator('[data-testid="roster"] tbody tr');
    const before = await rows.count();
    expect(before).toBeGreaterThan(1);

    const firstName = (await rows.first().locator('.name-btn').textContent())?.trim() ?? '';
    await page.locator('[data-testid="filter-search"]').fill(firstName);
    await expect(rows.first().locator('.name-btn')).toContainText(firstName);
    await expect.poll(() => rows.count()).toBeLessThanOrEqual(before);
  });
});
