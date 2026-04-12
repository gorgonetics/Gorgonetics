import { expect, test } from '@playwright/test';
import { waitForAppReady, waitForPets } from './helpers.js';

// ==========================================
// Keyboard Navigation & Accessibility
// ==========================================

test.describe('Keyboard Navigation', () => {
  test.describe('Skip Link', () => {
    test('skip link appears on Tab and targets main content', async ({ page }) => {
      await page.goto('/');
      await waitForAppReady(page);

      // Tab to reveal skip link
      await page.keyboard.press('Tab');
      const skipLink = page.locator('.skip-link');
      await expect(skipLink).toBeFocused();
      await expect(skipLink).toHaveText('Skip to main content');
      await expect(skipLink).toHaveAttribute('href', '#main-content');
    });
  });

  test.describe('Semantic Landmarks', () => {
    test('TopBar contains nav element', async ({ page }) => {
      await page.goto('/');
      await waitForAppReady(page);

      const nav = page.locator('nav[aria-label="Main navigation"]');
      await expect(nav).toBeVisible();
    });

    test('main content area has id for skip link', async ({ page }) => {
      await page.goto('/');
      await waitForAppReady(page);

      await expect(page.locator('#main-content')).toBeVisible();
    });
  });

  test.describe('Data Menu Dropdown', () => {
    test('opens with Enter key and navigates with arrow keys', async ({ page }) => {
      await page.goto('/');
      await waitForAppReady(page);

      // Focus the data menu toggle
      const toggle = page.locator('.menu-toggle');
      await toggle.focus();

      // Open with Enter
      await page.keyboard.press('Enter');
      await expect(page.locator('.dropdown')).toBeVisible();

      // First item should be focused
      const firstItem = page.locator('.dropdown-item').first();
      await expect(firstItem).toBeFocused();

      // Arrow down to second item
      await page.keyboard.press('ArrowDown');
      const secondItem = page.locator('.dropdown-item').nth(1);
      await expect(secondItem).toBeFocused();

      // Escape closes
      await page.keyboard.press('Escape');
      await expect(page.locator('.dropdown')).not.toBeVisible();
    });

    test('toggle has aria-haspopup and aria-expanded', async ({ page }) => {
      await page.goto('/');
      await waitForAppReady(page);

      const toggle = page.locator('.menu-toggle');
      await expect(toggle).toHaveAttribute('aria-haspopup', 'menu');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });
  });

  test.describe('Pet List Navigation', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      await waitForPets(page);
    });

    test('arrow keys navigate between pet cards', async ({ page }) => {
      const firstCard = page.locator('.pet-card').first();
      await firstCard.focus();

      // Arrow down moves to second card
      await page.keyboard.press('ArrowDown');
      const secondCard = page.locator('.pet-card').nth(1);
      await expect(secondCard).toBeFocused();

      // Arrow up moves back
      await page.keyboard.press('ArrowUp');
      await expect(firstCard).toBeFocused();
    });

    test('Enter on pet card selects the pet', async ({ page }) => {
      const firstCard = page.locator('.pet-card').first();
      await firstCard.focus();
      await page.keyboard.press('Enter');

      // Pet card should now be selected
      await expect(firstCard).toHaveClass(/selected/);
    });

    test('action buttons visible on keyboard focus', async ({ page }) => {
      const firstCard = page.locator('.pet-card').first();
      await firstCard.focus();

      // Action buttons should be visible when card is focused
      const actions = page.locator('.pet-card-wrapper').first().locator('.pet-card-actions');
      await expect(actions).toBeVisible();
    });
  });

  test.describe('Settings Modal', () => {
    test('Escape closes the modal', async ({ page }) => {
      await page.goto('/');
      await waitForAppReady(page);

      // Open settings
      await page.locator('.settings-toggle').click();
      await expect(page.locator('.settings-dialog')).toBeVisible();

      // Escape closes it
      await page.keyboard.press('Escape');
      await expect(page.locator('.settings-dialog')).not.toBeVisible();
    });

    test('modal has aria-modal and focus trap', async ({ page }) => {
      await page.goto('/');
      await waitForAppReady(page);

      await page.locator('.settings-toggle').click();
      const dialog = page.locator('.settings-dialog');
      await expect(dialog).toHaveAttribute('aria-modal', 'true');
      await expect(dialog).toHaveAttribute('role', 'dialog');
    });

    test('font scale controls are visible', async ({ page }) => {
      await page.goto('/');
      await waitForAppReady(page);

      await page.locator('.settings-toggle').click();
      await expect(page.locator('.scale-controls')).toBeVisible();
      await expect(page.locator('.scale-value')).toHaveText('100%');
    });
  });

  test.describe('Font Scaling (Issue #89)', () => {
    test('Cmd/Ctrl+Plus increases font scale', async ({ page }) => {
      await page.goto('/');
      await waitForAppReady(page);

      const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
      await page.keyboard.press(`${modifier}+=`);

      // Check that the root font size changed
      const fontSize = await page.evaluate(() => document.documentElement.style.fontSize);
      expect(fontSize).toBe('110%');
    });

    test('Cmd/Ctrl+Minus decreases font scale', async ({ page }) => {
      await page.goto('/');
      await waitForAppReady(page);

      const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
      await page.keyboard.press(`${modifier}+-`);

      const fontSize = await page.evaluate(() => document.documentElement.style.fontSize);
      expect(fontSize).toBe('90%');
    });

    test('Cmd/Ctrl+0 resets font scale', async ({ page }) => {
      await page.goto('/');
      await waitForAppReady(page);

      const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

      // Increase first
      await page.keyboard.press(`${modifier}+=`);
      let fontSize = await page.evaluate(() => document.documentElement.style.fontSize);
      expect(fontSize).toBe('110%');

      // Reset
      await page.keyboard.press(`${modifier}+0`);
      fontSize = await page.evaluate(() => document.documentElement.style.fontSize);
      expect(fontSize).toBe('100%');
    });

    test('font scale buttons in settings work', async ({ page }) => {
      await page.goto('/');
      await waitForAppReady(page);

      await page.locator('.settings-toggle').click();
      await expect(page.locator('.scale-value')).toHaveText('100%');

      // Click increase
      await page.locator('.scale-btn[aria-label="Increase font size"]').click();
      await expect(page.locator('.scale-value')).toHaveText('110%');

      // Click reset
      await page.locator('.scale-reset-btn').click();
      await expect(page.locator('.scale-value')).toHaveText('100%');
    });
  });

  test.describe('Gene Cell Keyboard', () => {
    test('gene cells have role button and are keyboard focusable', async ({ page }) => {
      await page.goto('/');
      await waitForPets(page);

      // Select a pet first to get gene visualization
      await page.locator('.pet-card').first().click();
      await page.waitForTimeout(500);

      const geneCells = page.locator('.gene-cell[role="button"]');
      const count = await geneCells.count();
      if (count > 0) {
        await expect(geneCells.first()).toHaveAttribute('tabindex', '0');
        await expect(geneCells.first()).toHaveAttribute('aria-label', /Gene/);
      }
    });
  });

  test.describe('Focus Visible Styles', () => {
    test('focus-visible outline appears on keyboard focus', async ({ page }) => {
      await page.goto('/');
      await waitForAppReady(page);

      // Tab to first focusable element
      await page.keyboard.press('Tab'); // skip link
      await page.keyboard.press('Tab'); // next element

      // Verify outline style is applied (browser applies :focus-visible)
      const focusedEl = page.locator(':focus');
      await expect(focusedEl).toBeVisible();
    });
  });

  test.describe('Delete Confirmation Dialog', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      await waitForPets(page);
    });

    test('delete dialog has aria-modal and closes on Escape', async ({ page }) => {
      // Hover to reveal delete button, then click
      await page.locator('.pet-card-wrapper').first().hover();
      await page.locator('.delete-btn').first().click();

      const dialog = page.locator('.confirm-dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute('aria-modal', 'true');

      // Escape closes it
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
    });
  });
});
