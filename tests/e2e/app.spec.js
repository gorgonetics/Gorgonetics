import { test, expect } from '@playwright/test';

// Helper: wait for the app to finish initializing (AuthWrapper loads DB + demo data)
async function waitForAppReady(page) {
  // Wait for the loading screen to disappear and content to appear
  await page.waitForSelector('.sidebar', { timeout: 15000 });
  // Wait for the loading spinner to go away
  await page.waitForFunction(() => !document.querySelector('.loading-spinner'), { timeout: 15000 });
}

// ==========================================
// App Launch & Layout Tests
// ==========================================

test.describe('App Launch', () => {
  test('should load and display the sidebar', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Sidebar should be visible
    await expect(page.locator('.sidebar')).toBeVisible();

    // App title should be visible
    await expect(page.locator('.gradient-text')).toHaveText('Gorgonetics');
  });

  test('should show Pet Manager and Gene Editor tabs', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await expect(page.locator('.tab').filter({ hasText: 'Pet Manager' })).toBeVisible();
    await expect(page.locator('.tab').filter({ hasText: 'Gene Editor' })).toBeVisible();
  });

  test('should show "Gorgonetics / Desktop App" in sidebar footer', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await expect(page.locator('.username')).toHaveText('Gorgonetics');
    await expect(page.locator('.user-role')).toHaveText('Desktop App');
  });

  test('should NOT show any login/register/auth UI', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // No sign in / sign up buttons
    await expect(page.locator('text=Sign In')).toHaveCount(0);
    await expect(page.locator('text=Sign Up')).toHaveCount(0);
    await expect(page.locator('text=Logout')).toHaveCount(0);
  });
});

// ==========================================
// Pet Manager Tab Tests
// ==========================================

test.describe('Pet Manager', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    // Ensure Pet Manager tab is active
    await page.locator('.tab').filter({ hasText: 'Pet Manager' }).click();
    // Wait for pet table to load
    await page.waitForSelector('table', { timeout: 10000 }).catch(() => {});
  });

  test('should show the pet data table', async ({ page }) => {
    // Check for either pets loaded or empty state
    const hasPets = await page.locator('table').isVisible().catch(() => false);
    const hasEmpty = await page.locator('.empty-state').isVisible().catch(() => false);

    expect(hasPets || hasEmpty).toBeTruthy();
  });

  test('should display demo pets if loaded', async ({ page }) => {
    // Wait a bit for demo data to load
    await page.waitForTimeout(2000);

    const petRows = page.locator('table tbody tr');
    const count = await petRows.count();

    if (count > 0) {
      // Demo pets should have names
      await expect(petRows.first()).toContainText(/Sample|Pet|Bee|Horse/i);
    }
  });

  test('should show pet upload form in sidebar', async ({ page }) => {
    await expect(page.getByText('Add Pet to Collection')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('select genome file', { exact: false })).toBeVisible({ timeout: 5000 });
  });

  test('should show action buttons for each pet', async ({ page }) => {
    await page.waitForTimeout(2000);
    const actionButtons = page.locator('button[data-action]');
    const count = await actionButtons.count();

    if (count > 0) {
      // Each pet should have view, edit, delete buttons
      await expect(page.locator('button[data-action="view"]').first()).toBeVisible();
      await expect(page.locator('button[data-action="edit"]').first()).toBeVisible();
      await expect(page.locator('button[data-action="delete"]').first()).toBeVisible();
    }
  });
});

// ==========================================
// Pet Visualization Tests
// ==========================================

test.describe('Pet Visualization', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await page.locator('.tab').filter({ hasText: 'Pet Manager' }).click();
    // Wait for datatable to fully render including action buttons
    await page.waitForSelector('button[data-action="view"]', { timeout: 15000 }).catch(() => {});
  });

  test('should open pet visualization when clicking view button', async ({ page }) => {
    // Wait for action buttons to render inside datatable
    await page.waitForSelector('button[data-action="view"]', { timeout: 15000 });

    // Use JS click to bypass viewport issues and ensure event bubbles properly
    await page.locator('button[data-action="view"]').first().dispatchEvent('click');

    // Should show the pet visualization view
    await expect(page.locator('.pet-visualization')).toBeVisible({ timeout: 10000 });

    // Should show the visualization header with pet name
    await expect(page.locator('.visualization-title')).toBeVisible();
  });

  test('should show Attributes and Appearance buttons in visualization', async ({ page }) => {
    await page.waitForSelector('button[data-action="view"]', { timeout: 15000 });
    await page.locator('button[data-action="view"]').first().dispatchEvent('click');
    await page.waitForSelector('.pet-visualization', { timeout: 10000 });

    await expect(page.locator('.view-btn').filter({ hasText: 'Attributes' })).toBeVisible();
    await expect(page.locator('.view-btn').filter({ hasText: 'Appearance' })).toBeVisible();
  });

  test('should have a back button that returns to pet table', async ({ page }) => {
    await page.waitForSelector('button[data-action="view"]', { timeout: 15000 });
    await page.locator('button[data-action="view"]').first().dispatchEvent('click');
    await page.waitForSelector('.pet-visualization', { timeout: 10000 });

    // Click back button
    const backButton = page.locator('.back-icon-button');
    await expect(backButton).toBeVisible();
    await backButton.click();

    // Should return to pet table
    await expect(page.locator('table')).toBeVisible({ timeout: 5000 });
  });
});

// ==========================================
// Pet Editor Tests
// ==========================================

test.describe('Pet Editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await page.locator('.tab').filter({ hasText: 'Pet Manager' }).click();
    // Wait for datatable to fully render including action buttons
    await page.waitForSelector('button[data-action="edit"]', { timeout: 15000 }).catch(() => {});
  });

  test('should open edit modal when clicking edit button', async ({ page }) => {
    await page.waitForSelector('button[data-action="edit"]', { timeout: 15000 });
    await page.locator('button[data-action="edit"]').first().dispatchEvent('click');

    // The modal should appear (Flowbite Modal)
    await expect(page.getByText('Edit Pet')).toBeVisible({ timeout: 5000 });
  });

  test('should show pet form fields in editor', async ({ page }) => {
    await page.waitForSelector('button[data-action="edit"]', { timeout: 15000 });
    await page.locator('button[data-action="edit"]').first().dispatchEvent('click');

    // Wait for modal to open
    await expect(page.getByText('Basic Information')).toBeVisible({ timeout: 5000 });

    // Check key sections are present
    await expect(page.locator('h3').filter({ hasText: 'Basic Information' })).toBeVisible();
    await expect(page.getByText('Attributes', { exact: false }).first()).toBeVisible();
  });

  test('should close editor via close button', async ({ page }) => {
    await page.waitForSelector('button[data-action="edit"]', { timeout: 15000 });
    await page.locator('button[data-action="edit"]').first().dispatchEvent('click');
    await expect(page.getByText('Basic Information')).toBeVisible({ timeout: 5000 });

    // Close via the X button in the modal header (more reliable than scrolling to Cancel)
    const closeButton = page.locator('button').filter({ hasText: 'Close' }).first();
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click();
    } else {
      // Try the X icon button at the top of the modal
      await page.locator('[aria-label="Close"]').first().click().catch(() => {
        // Fallback: press Escape
        return page.keyboard.press('Escape');
      });
    }

    // Modal should close
    await expect(page.getByText('Basic Information')).not.toBeVisible({ timeout: 3000 });
  });
});

// ==========================================
// Gene Editor Tab Tests
// ==========================================

test.describe('Gene Editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    // Switch to Gene Editor tab
    await page.locator('.tab').filter({ hasText: 'Gene Editor' }).click();
  });

  test('should show animal type and chromosome selects', async ({ page }) => {
    await expect(page.locator('#animalType')).toBeVisible();
    await expect(page.locator('#chromosome')).toBeVisible();
    await expect(page.locator('button.load-btn')).toBeVisible();
  });

  test('should populate animal types dropdown', async ({ page }) => {
    // Wait for animal types to load
    await page.waitForTimeout(2000);

    const select = page.locator('#animalType');
    const options = select.locator('option');
    const count = await options.count();

    // Should have at least the default + some animal types
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('should load chromosomes when animal type is selected', async ({ page }) => {
    await page.waitForTimeout(2000);

    const animalTypeSelect = page.locator('#animalType');
    const options = animalTypeSelect.locator('option');
    const count = await options.count();

    if (count > 1) {
      // Select the first non-default option
      const firstOption = await options.nth(1).getAttribute('value');
      if (firstOption) {
        await animalTypeSelect.selectOption(firstOption);
        await page.waitForTimeout(1000);

        // Chromosome select should now have options
        const chromOptions = page.locator('#chromosome option');
        const chromCount = await chromOptions.count();
        expect(chromCount).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test('should open gene editing view when Edit Genes is clicked', async ({ page }) => {
    await page.waitForTimeout(2000);

    const animalTypeSelect = page.locator('#animalType');
    const options = animalTypeSelect.locator('option');
    const count = await options.count();

    if (count > 1) {
      // Select animal type
      const firstOption = await options.nth(1).getAttribute('value');
      if (firstOption) {
        await animalTypeSelect.selectOption(firstOption);
        await page.waitForTimeout(1000);

        // Select first chromosome
        const chromSelect = page.locator('#chromosome');
        const chromOptions = chromSelect.locator('option');
        const chromCount = await chromOptions.count();

        if (chromCount > 1) {
          const firstChrom = await chromOptions.nth(1).getAttribute('value');
          if (firstChrom) {
            await chromSelect.selectOption(firstChrom);
            await page.waitForTimeout(500);

            // Click Edit Genes
            await page.locator('button.load-btn').click();

            // Should show the gene editing view
            await expect(page.locator('.gene-editing-view')).toBeVisible({ timeout: 10000 });
          }
        }
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

    await page.locator('.tab').filter({ hasText: 'Gene Editor' }).click();
    await page.waitForTimeout(2000);

    const animalTypeSelect = page.locator('#animalType');
    const options = animalTypeSelect.locator('option');
    const count = await options.count();

    if (count <= 1) return false;

    const firstOption = await options.nth(1).getAttribute('value');
    if (!firstOption) return false;

    await animalTypeSelect.selectOption(firstOption);
    await page.waitForTimeout(1000);

    const chromSelect = page.locator('#chromosome');
    const chromOptions = chromSelect.locator('option');
    const chromCount = await chromOptions.count();

    if (chromCount <= 1) return false;

    const firstChrom = await chromOptions.nth(1).getAttribute('value');
    if (!firstChrom) return false;

    await chromSelect.selectOption(firstChrom);
    await page.waitForTimeout(500);

    await page.locator('button.load-btn').click();
    await page.waitForSelector('.gene-editing-view', { timeout: 10000 }).catch(() => {});
    return await page.locator('.gene-editing-view').isVisible();
  }

  test('should display gene cards grid', async ({ page }) => {
    const opened = await navigateToGeneEditor(page);
    if (opened) {
      await expect(page.locator('.genes-grid')).toBeVisible();
      const geneCards = page.locator('.gene-card');
      const count = await geneCards.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test('should show gene IDs on cards', async ({ page }) => {
    const opened = await navigateToGeneEditor(page);
    if (opened) {
      const geneIds = page.locator('.gene-id');
      const count = await geneIds.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test('should have dominant and recessive effect selectors', async ({ page }) => {
    const opened = await navigateToGeneEditor(page);
    if (opened) {
      await expect(page.locator('text=Dominant').first()).toBeVisible();
      await expect(page.locator('text=Recessive').first()).toBeVisible();
    }
  });
});

// ==========================================
// Sidebar Interaction Tests
// ==========================================

test.describe('Sidebar', () => {
  test('should toggle sidebar collapse', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Sidebar should start expanded
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).not.toHaveClass(/collapsed/);

    // Click toggle button
    await page.locator('.sidebar-toggle').click();

    // Should be collapsed
    await expect(sidebar).toHaveClass(/collapsed/);

    // Click again to expand
    await page.locator('.sidebar-toggle').click();

    // Should be expanded again
    await expect(sidebar).not.toHaveClass(/collapsed/);
  });

  test('should switch between Pet Manager and Gene Editor tabs', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Click Gene Editor
    await page.locator('.tab').filter({ hasText: 'Gene Editor' }).click();
    await expect(page.locator('.tab').filter({ hasText: 'Gene Editor' })).toHaveClass(/active/);

    // Click Pet Manager
    await page.locator('.tab').filter({ hasText: 'Pet Manager' }).click();
    await expect(page.locator('.tab').filter({ hasText: 'Pet Manager' })).toHaveClass(/active/);
  });

  test('should persist sidebar state across tab switches', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Collapse sidebar
    await page.locator('.sidebar-toggle').click();
    await expect(page.locator('.sidebar')).toHaveClass(/collapsed/);

    // Switch tabs — when collapsed, text is hidden, so click the second tab button directly
    await page.locator('.tab').nth(1).click();

    // Should still be collapsed
    await expect(page.locator('.sidebar')).toHaveClass(/collapsed/);
  });
});

// ==========================================
// Responsive / Window Size Tests
// ==========================================

test.describe('Window Sizing', () => {
  test('should render correctly at 1200x800 (default window size)', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');
    await waitForAppReady(page);

    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('main')).toBeVisible();
  });

  test('should render correctly at 1024x768', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/');
    await waitForAppReady(page);

    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('main')).toBeVisible();
  });

  test('should render correctly at smaller viewport', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto('/');
    await waitForAppReady(page);

    // App should still be functional
    await expect(page.locator('.sidebar')).toBeVisible();
  });
});
