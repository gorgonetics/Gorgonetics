import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers.js';

// ==========================================
// Theme / Dark Mode
// ==========================================

test.describe('Theme Support', () => {
  test('defaults to system theme (light when emulated)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await waitForAppReady(page);

    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme).toBe('light');
  });

  test('theme toggle is visible in settings', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await page.locator('.settings-toggle').click();
    await expect(page.locator('.theme-selector')).toBeVisible();
    await expect(page.locator('.theme-btn').filter({ hasText: 'Light' })).toBeVisible();
    await expect(page.locator('.theme-btn').filter({ hasText: 'Dark' })).toBeVisible();
    await expect(page.locator('.theme-btn').filter({ hasText: 'System' })).toBeVisible();
  });

  test('system theme is active by default', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await page.locator('.settings-toggle').click();
    const systemBtn = page.locator('.theme-btn').filter({ hasText: 'System' });
    await expect(systemBtn).toHaveClass(/active/);
  });

  test('switching to dark mode applies data-theme="dark"', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await page.locator('.settings-toggle').click();
    await page.locator('.theme-btn').filter({ hasText: 'Dark' }).click();

    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme).toBe('dark');
  });

  test('dark mode changes background color', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Get light mode bg
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    // Switch to dark
    await page.locator('.settings-toggle').click();
    await page.locator('.theme-btn').filter({ hasText: 'Dark' }).click();

    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(darkBg).not.toBe(lightBg);
  });

  test('switching to light mode applies data-theme="light"', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await page.locator('.settings-toggle').click();

    // Go dark first
    await page.locator('.theme-btn').filter({ hasText: 'Dark' }).click();
    let theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme).toBe('dark');

    // Switch back to light
    await page.locator('.theme-btn').filter({ hasText: 'Light' }).click();
    theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme).toBe('light');
  });

  test('dark mode button shows active state', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await page.locator('.settings-toggle').click();
    await page.locator('.theme-btn').filter({ hasText: 'Dark' }).click();

    const darkBtn = page.locator('.theme-btn').filter({ hasText: 'Dark' });
    await expect(darkBtn).toHaveClass(/active/);
  });

  test('theme persists across settings reopen', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Set dark
    await page.locator('.settings-toggle').click();
    await page.locator('.theme-btn').filter({ hasText: 'Dark' }).click();

    // Close and reopen settings
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-dialog')).not.toBeVisible();

    await page.locator('.settings-toggle').click();
    const darkBtn = page.locator('.theme-btn').filter({ hasText: 'Dark' });
    await expect(darkBtn).toHaveClass(/active/);
  });

  test('CSS custom properties change with theme', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    const lightTextColor = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim(),
    );

    await page.locator('.settings-toggle').click();
    await page.locator('.theme-btn').filter({ hasText: 'Dark' }).click();

    const darkTextColor = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim(),
    );

    expect(darkTextColor).not.toBe(lightTextColor);
  });

  test('system preference is respected', async ({ page }) => {
    // Emulate dark color scheme
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await waitForAppReady(page);

    // Default is 'system', so should resolve to dark
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme).toBe('dark');
  });

  test('system preference switch updates live', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Ensure we're on system preference
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme).toBe('light');

    // Switch system to dark
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  });
});
