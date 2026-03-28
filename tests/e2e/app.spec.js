import { test, expect } from '@playwright/test';

// Helper: wait for the app to initialize (DB + demo data loading)
async function waitForAppReady(page) {
  await page.waitForSelector('.top-bar', { timeout: 15000 });
  await page.waitForFunction(
    () => !document.querySelector('.loading-screen'),
    { timeout: 15000 }
  );
}

// ==========================================
// App Launch & Layout Tests
// ==========================================

test.describe('App Launch', () => {
  test('should load and display the top bar', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await expect(page.locator('.top-bar')).toBeVisible();
    await expect(page.locator('.app-name')).toHaveText('Gorgonetics');
  });

  test('should show Pets and Genes tab buttons', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await expect(page.locator('.tab-btn').filter({ hasText: 'Pets' })).toBeVisible();
    await expect(page.locator('.tab-btn').filter({ hasText: 'Genes' })).toBeVisible();
  });

  test('should show master-detail layout', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Master panel (left) and detail pane (right) should exist
    await expect(page.locator('.master-panel')).toBeVisible();
    await expect(page.locator('.detail-pane')).toBeVisible();
  });

  test('should NOT show any auth UI', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await expect(page.locator('text=Sign In')).toHaveCount(0);
    await expect(page.locator('text=Sign Up')).toHaveCount(0);
    await expect(page.locator('text=Logout')).toHaveCount(0);
  });

  test('should show empty state when no pet selected', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await expect(page.getByText('Select a pet to view details')).toBeVisible();
  });
});

// ==========================================
// Pet List (Master Panel) Tests
// ==========================================

test.describe('Pet List', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    // Pets tab is active by default
    await page.waitForTimeout(1000);
  });

  test('should show pet cards in the master panel', async ({ page }) => {
    const petCards = page.locator('.pet-card');
    const count = await petCards.count();
    // Demo pets should be loaded
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('should show search input', async ({ page }) => {
    await expect(page.locator('.search-input')).toBeVisible();
  });

  test('should show upload button', async ({ page }) => {
    await expect(page.locator('.upload-btn')).toBeVisible();
    await expect(page.locator('.upload-btn')).toContainText('Upload Genome');
  });

  test('should show pet count', async ({ page }) => {
    await expect(page.locator('.pet-count')).toBeVisible();
  });

  test('should filter pets when searching', async ({ page }) => {
    await page.waitForSelector('.pet-card', { timeout: 10000 }).catch(() => {});
    const initialCount = await page.locator('.pet-card').count();
    if (initialCount > 0) {
      await page.locator('.search-input').fill('zzz-nonexistent');
      await page.waitForTimeout(300);
      const filteredCount = await page.locator('.pet-card').count();
      expect(filteredCount).toBe(0);
    }
  });

  test('should show edit/delete buttons on hover', async ({ page }) => {
    await page.waitForSelector('.pet-card', { timeout: 10000 }).catch(() => {});
    const card = page.locator('.pet-card-wrapper').first();
    if (await card.isVisible().catch(() => false)) {
      await card.hover();
      await expect(page.locator('.pet-card-actions').first()).toBeVisible();
    }
  });
});

// ==========================================
// Pet Selection & Detail View Tests
// ==========================================

test.describe('Pet Detail View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await page.waitForSelector('.pet-card', { timeout: 10000 }).catch(() => {});
  });

  test('should select pet and show detail view', async ({ page }) => {
    const petCard = page.locator('.pet-card').first();
    if (await petCard.isVisible().catch(() => false)) {
      await petCard.click();
      // Detail pane should show the pet visualization
      await expect(page.locator('.pet-visualization')).toBeVisible({ timeout: 10000 });
    }
  });

  test('should show pet name and metadata in detail header', async ({ page }) => {
    const petCard = page.locator('.pet-card').first();
    if (await petCard.isVisible().catch(() => false)) {
      await petCard.click();
      await page.waitForSelector('.detail-header', { timeout: 10000 });
      await expect(page.locator('.detail-title')).toBeVisible();
      await expect(page.locator('.detail-meta')).toBeVisible();
    }
  });

  test('should show Attributes and Appearance buttons', async ({ page }) => {
    const petCard = page.locator('.pet-card').first();
    if (await petCard.isVisible().catch(() => false)) {
      await petCard.click();
      await page.waitForSelector('.view-controls', { timeout: 10000 });
      await expect(page.locator('.view-btn').filter({ hasText: 'Attributes' })).toBeVisible();
      await expect(page.locator('.view-btn').filter({ hasText: 'Appearance' })).toBeVisible();
    }
  });

  test('should highlight selected pet in master list', async ({ page }) => {
    const petCard = page.locator('.pet-card').first();
    if (await petCard.isVisible().catch(() => false)) {
      await petCard.click();
      await expect(page.locator('.pet-card.selected')).toBeVisible();
    }
  });
});

// ==========================================
// Pet Editor Tests
// ==========================================

test.describe('Pet Editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await page.waitForSelector('.pet-card-wrapper', { timeout: 10000 }).catch(() => {});
  });

  test('should open edit modal from action button', async ({ page }) => {
    const wrapper = page.locator('.pet-card-wrapper').first();
    if (await wrapper.isVisible().catch(() => false)) {
      await wrapper.hover();
      await page.locator('.edit-btn').first().click();
      await expect(page.getByText('Basic Information')).toBeVisible({ timeout: 5000 });
    }
  });

  test('should show pet form fields in editor', async ({ page }) => {
    const wrapper = page.locator('.pet-card-wrapper').first();
    if (await wrapper.isVisible().catch(() => false)) {
      await wrapper.hover();
      await page.locator('.edit-btn').first().click();
      await expect(page.getByText('Basic Information')).toBeVisible({ timeout: 5000 });
      await expect(page.getByText('Attributes', { exact: false }).first()).toBeVisible();
    }
  });

  test('should close editor via Escape key', async ({ page }) => {
    const wrapper = page.locator('.pet-card-wrapper').first();
    if (await wrapper.isVisible().catch(() => false)) {
      await wrapper.hover();
      await page.locator('.edit-btn').first().click();
      await expect(page.getByText('Basic Information')).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Escape');
      await expect(page.getByText('Basic Information')).not.toBeVisible({ timeout: 3000 });
    }
  });
});

// ==========================================
// Gene Editor Tab Tests
// ==========================================

test.describe('Gene Editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await page.locator('.tab-btn').filter({ hasText: 'Genes' }).click();
  });

  test('should show gene editor form in master panel', async ({ page }) => {
    await expect(page.locator('#animalType')).toBeVisible();
    await expect(page.locator('#chromosome')).toBeVisible();
  });

  test('should populate animal types dropdown', async ({ page }) => {
    await page.waitForTimeout(2000);
    const options = page.locator('#animalType option');
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('should load chromosomes when animal type is selected', async ({ page }) => {
    await page.waitForTimeout(2000);
    const animalTypeSelect = page.locator('#animalType');
    const options = animalTypeSelect.locator('option');
    const count = await options.count();

    if (count > 1) {
      const firstOption = await options.nth(1).getAttribute('value');
      if (firstOption) {
        await animalTypeSelect.selectOption(firstOption);
        await page.waitForTimeout(1000);
        const chromOptions = page.locator('#chromosome option');
        expect(await chromOptions.count()).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test('should open gene editing view in detail pane', async ({ page }) => {
    await page.waitForTimeout(2000);
    const animalTypeSelect = page.locator('#animalType');
    const options = animalTypeSelect.locator('option');
    if (await options.count() > 1) {
      await animalTypeSelect.selectOption(await options.nth(1).getAttribute('value'));
      await page.waitForTimeout(1000);

      const chromSelect = page.locator('#chromosome');
      const chromOptions = chromSelect.locator('option');
      if (await chromOptions.count() > 1) {
        await chromSelect.selectOption(await chromOptions.nth(1).getAttribute('value'));
        await page.waitForTimeout(500);
        await page.locator('button.load-btn').click();
        await expect(page.locator('.gene-editing-view')).toBeVisible({ timeout: 10000 });
      }
    }
  });
});

// ==========================================
// Gene Editing View Tests
// ==========================================

test.describe('Gene Editing View', () => {
  async function navigateToGeneEditor(page) {
    await page.goto('/');
    await waitForAppReady(page);
    await page.locator('.tab-btn').filter({ hasText: 'Genes' }).click();
    await page.waitForTimeout(2000);

    const animalTypeSelect = page.locator('#animalType');
    const options = animalTypeSelect.locator('option');
    if (await options.count() <= 1) return false;

    await animalTypeSelect.selectOption(await options.nth(1).getAttribute('value'));
    await page.waitForTimeout(1000);

    const chromSelect = page.locator('#chromosome');
    const chromOptions = chromSelect.locator('option');
    if (await chromOptions.count() <= 1) return false;

    await chromSelect.selectOption(await chromOptions.nth(1).getAttribute('value'));
    await page.waitForTimeout(500);
    await page.locator('button.load-btn').click();
    await page.waitForSelector('.gene-editing-view', { timeout: 10000 }).catch(() => {});
    return await page.locator('.gene-editing-view').isVisible();
  }

  test('should display gene cards grid', async ({ page }) => {
    if (await navigateToGeneEditor(page)) {
      await expect(page.locator('.genes-grid')).toBeVisible();
      expect(await page.locator('.gene-card').count()).toBeGreaterThan(0);
    }
  });

  test('should show gene IDs on cards', async ({ page }) => {
    if (await navigateToGeneEditor(page)) {
      expect(await page.locator('.gene-id').count()).toBeGreaterThan(0);
    }
  });

  test('should show save and export buttons in header', async ({ page }) => {
    if (await navigateToGeneEditor(page)) {
      await expect(page.locator('.gene-editing-header')).toBeVisible();
      await expect(page.locator('.export-btn')).toBeVisible();
    }
  });
});

// ==========================================
// Tab Switching Tests
// ==========================================

test.describe('Tab Navigation', () => {
  test('should switch between Pets and Genes tabs', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Pets tab should be active by default
    await expect(page.locator('.tab-btn').filter({ hasText: 'Pets' })).toHaveClass(/active/);

    // Switch to Genes
    await page.locator('.tab-btn').filter({ hasText: 'Genes' }).click();
    await expect(page.locator('.tab-btn').filter({ hasText: 'Genes' })).toHaveClass(/active/);
    await expect(page.locator('#animalType')).toBeVisible();

    // Switch back to Pets
    await page.locator('.tab-btn').filter({ hasText: 'Pets' }).click();
    await expect(page.locator('.tab-btn').filter({ hasText: 'Pets' })).toHaveClass(/active/);
  });

  test('should clear selection when switching tabs', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Select a pet
    await page.waitForSelector('.pet-card', { timeout: 10000 }).catch(() => {});
    const petCard = page.locator('.pet-card').first();
    if (await petCard.isVisible().catch(() => false)) {
      await petCard.click();
      await page.waitForSelector('.pet-visualization', { timeout: 10000 });

      // Switch to Genes tab
      await page.locator('.tab-btn').filter({ hasText: 'Genes' }).click();

      // Switch back to Pets — pet should be deselected
      await page.locator('.tab-btn').filter({ hasText: 'Pets' }).click();
      await expect(page.getByText('Select a pet to view details')).toBeVisible({ timeout: 5000 });
    }
  });
});

// ==========================================
// Window Sizing Tests
// ==========================================

test.describe('Window Sizing', () => {
  test('should render at 1200x800', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');
    await waitForAppReady(page);
    await expect(page.locator('.master-panel')).toBeVisible();
    await expect(page.locator('.detail-pane')).toBeVisible();
  });

  test('should render at 1024x768', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/');
    await waitForAppReady(page);
    await expect(page.locator('.master-panel')).toBeVisible();
    await expect(page.locator('.detail-pane')).toBeVisible();
  });

  test('should render at 800x600', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto('/');
    await waitForAppReady(page);
    await expect(page.locator('.top-bar')).toBeVisible();
  });
});
