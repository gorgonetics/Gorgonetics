import { expect, type Page, test } from '@playwright/test';
import { waitForPets } from './helpers.js';

/**
 * Guards for #436: the responsive genome grid derives its cell size from the
 * scroll container's content-box width. Where a scrollbar takes layout space, a
 * *vertical* scrollbar appearing/disappearing shifts that width, so a change
 * that only affects the grid box's HEIGHT (toolbar/legend height) leaks into
 * cell WIDTH. `scrollbar-gutter: stable` reserves the gutter permanently so the
 * width no longer moves.
 *
 * Note on coverage: the width coupling only manifests with space-taking
 * scrollbars — the shipped Tauri WKWebView with classic scrollbars, or Windows.
 * Playwright's Chromium renders overlay (zero-width) scrollbars on macOS and
 * ignores both `::-webkit-scrollbar` styling and the overlay-scrollbar launch
 * flags, so a before/after cell-size reproduction is not achievable here (it
 * passes with or without the fix). We therefore guard the fix two ways that
 * Chromium *can* observe: (1) the decoupling property is actually applied —
 * removing the fix fails this; (2) cell size does not depend on the selected
 * view, the user-visible symptom, which also catches non-scrollbar regressions
 * (e.g. reintroducing a rebuild-on-view-change).
 */

const WIDTH = 1280;
const CONTAINER = '.pet-visualization .gene-grid-container';

async function openSampleHorse(page: Page, height: number): Promise<void> {
  await page.setViewportSize({ width: WIDTH, height });
  await page.goto('/');
  await waitForPets(page);
  await page.locator('button[data-testid="roster-open"]:has-text("Sample Horse")').click();
  await expect(page.locator('.pet-visualization')).toBeVisible();
  await expect(page.locator(`${CONTAINER} .gene-cell`).first()).toBeVisible();
}

async function readCellSize(page: Page): Promise<string> {
  // Poll so the ResizeObserver-driven recompute has settled before we read.
  let last = '';
  await expect
    .poll(async () => {
      const next = await page
        .locator(CONTAINER)
        .evaluate((el) => getComputedStyle(el).getPropertyValue('--cell-size').trim());
      const stable = next === last && next !== '';
      last = next;
      return stable;
    })
    .toBe(true);
  return last;
}

test('genome grid reserves a stable scrollbar gutter, decoupling width from height (#436)', async ({ page }) => {
  await openSampleHorse(page, 700);
  const gutter = await page.locator(CONTAINER).evaluate((el) => getComputedStyle(el).scrollbarGutter);
  // Without this the vertical scrollbar toggling would shift the measured width
  // and resize the cells whenever the toolbar/legend height changes.
  expect(gutter).toBe('stable');
});

test('genome grid cell size is identical across Attributes and Appearance views (#436)', async ({ page }) => {
  await openSampleHorse(page, 700);
  const sizeAttributes = await readCellSize(page);
  await page.locator('.pet-visualization .view-btn:has-text("Appearance")').click();
  const sizeAppearance = await readCellSize(page);
  expect(sizeAppearance).toBe(sizeAttributes);
});
