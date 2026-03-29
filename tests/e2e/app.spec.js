import { expect, test } from '@playwright/test';

// Wait for the app to finish initializing (DB + demo data)
async function waitForAppReady(page) {
  await page.waitForSelector('.top-bar');
  // Wait until loading screen is gone and pet cards appear (demo data loaded)
  await page.waitForFunction(() => {
    const loading = document.querySelector('.loading-screen');
    const spinner = document.querySelector('.spinner');
    return !loading && !spinner;
  });
}

// Wait for demo pet cards to appear in the list
async function waitForPets(page) {
  await waitForAppReady(page);
  await page.waitForSelector('.pet-card');
}

// Navigate to gene editor with a selected chromosome, return true if successful
async function openGeneEditor(page) {
  await page.locator('.tab-btn').filter({ hasText: 'Genes' }).click();
  // Wait for animal types to populate (more than just the placeholder)
  await expect(page.locator('#animalType option')).not.toHaveCount(1);

  // Select first real animal type
  const firstValue = await page.locator('#animalType option').nth(1).getAttribute('value');
  await page.locator('#animalType').selectOption(firstValue);

  // Wait for chromosomes to populate
  await expect(page.locator('#chromosome option')).not.toHaveCount(1);

  // Select first real chromosome
  const firstChrom = await page.locator('#chromosome option').nth(1).getAttribute('value');
  await page.locator('#chromosome').selectOption(firstChrom);

  await page.locator('button.load-btn').click();
  await expect(page.locator('.gene-editing-view')).toBeVisible();
}

// ==========================================
// App Launch & Layout
// ==========================================

test.describe('App Launch', () => {
  test('shows top bar with app name and tabs', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await expect(page.locator('.app-name')).toHaveText('Gorgonetics');
    await expect(page.locator('.tab-btn').filter({ hasText: 'Pets' })).toBeVisible();
    await expect(page.locator('.tab-btn').filter({ hasText: 'Genes' })).toBeVisible();
  });

  test('shows master-detail layout', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await expect(page.locator('.master-panel')).toBeVisible();
    await expect(page.locator('.detail-pane')).toBeVisible();
  });

  test('has no auth UI', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await expect(page.getByText('Sign In')).toHaveCount(0);
    await expect(page.getByText('Sign Up')).toHaveCount(0);
  });

  test('shows empty state when no pet selected', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await expect(page.getByText('Select a pet to view details')).toBeVisible();
  });
});

// ==========================================
// Pet List
// ==========================================

test.describe('Pet List', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);
  });

  test('shows demo pet cards', async ({ page }) => {
    expect(await page.locator('.pet-card').count()).toBeGreaterThan(0);
  });

  test('shows search input and upload button', async ({ page }) => {
    await expect(page.locator('.search-input')).toBeVisible();
    await expect(page.locator('.upload-btn')).toContainText('Upload Genome');
  });

  test('shows pet count', async ({ page }) => {
    await expect(page.locator('.pet-count')).toContainText('pets');
  });

  test('filters pets by search', async ({ page }) => {
    const before = await page.locator('.pet-card').count();
    expect(before).toBeGreaterThan(0);

    await page.locator('.search-input').fill('zzz-nonexistent');
    await expect(page.locator('.pet-card')).toHaveCount(0);

    // Clear search restores all
    await page.locator('.search-input').fill('');
    await expect(page.locator('.pet-card')).toHaveCount(before);
  });

  test('shows edit/delete on hover', async ({ page }) => {
    await page.locator('.pet-card-wrapper').first().hover();
    await expect(page.locator('.pet-card-actions').first()).toBeVisible();
  });
});

// ==========================================
// Pet Detail View
// ==========================================

test.describe('Pet Detail View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);
  });

  test('clicking pet card shows visualization', async ({ page }) => {
    await page.locator('.pet-card').first().click();
    await expect(page.locator('.pet-visualization')).toBeVisible();
    await expect(page.locator('.detail-title')).toBeVisible();
    await expect(page.locator('.detail-meta')).toBeVisible();
  });

  test('shows view control buttons', async ({ page }) => {
    await page.locator('.pet-card').first().click();
    await expect(page.locator('.view-btn').filter({ hasText: 'Attributes' })).toBeVisible();
    await expect(page.locator('.view-btn').filter({ hasText: 'Appearance' })).toBeVisible();
    await expect(page.locator('.view-btn').filter({ hasText: 'Stats' })).toBeVisible();
  });

  test('highlights selected pet in list', async ({ page }) => {
    await page.locator('.pet-card').first().click();
    await expect(page.locator('.pet-card.selected')).toHaveCount(1);
  });

  test('stats drawer toggles on button click', async ({ page }) => {
    await page.locator('.pet-card').first().click();
    await expect(page.locator('.pet-visualization')).toBeVisible();

    // Stats should be hidden by default
    await expect(page.locator('.stats-drawer')).toHaveCount(0);

    // Click Stats button to open drawer
    await page.locator('.view-btn').filter({ hasText: 'Stats' }).click();
    await expect(page.locator('.stats-drawer')).toBeVisible();

    // Click again to close
    await page.locator('.view-btn').filter({ hasText: 'Stats' }).click();
    await expect(page.locator('.stats-drawer')).toHaveCount(0);
  });
});

// ==========================================
// Pet Editor
// ==========================================

test.describe('Pet Editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);
  });

  test('opens edit modal on hover + click', async ({ page }) => {
    await page.locator('.pet-card-wrapper').first().hover();
    await page.locator('.edit-btn').first().click();
    await expect(page.getByText('Basic Information')).toBeVisible();
  });

  test('shows form fields in editor', async ({ page }) => {
    await page.locator('.pet-card-wrapper').first().hover();
    await page.locator('.edit-btn').first().click();
    await expect(page.getByText('Basic Information')).toBeVisible();
    await expect(page.getByText('Attributes', { exact: false }).first()).toBeVisible();
  });

  test('closes on Escape', async ({ page }) => {
    await page.locator('.pet-card-wrapper').first().hover();
    await page.locator('.edit-btn').first().click();
    await expect(page.getByText('Basic Information')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByText('Basic Information')).not.toBeVisible();
  });
});

// ==========================================
// Gene Editor
// ==========================================

test.describe('Gene Editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('shows selector form when Genes tab clicked', async ({ page }) => {
    await page.locator('.tab-btn').filter({ hasText: 'Genes' }).click();
    await expect(page.locator('#animalType')).toBeVisible();
    await expect(page.locator('#chromosome')).toBeVisible();
  });

  test('populates animal types', async ({ page }) => {
    await page.locator('.tab-btn').filter({ hasText: 'Genes' }).click();
    await expect(page.locator('#animalType option')).not.toHaveCount(1);
  });

  test('loads chromosomes on animal type selection', async ({ page }) => {
    await page.locator('.tab-btn').filter({ hasText: 'Genes' }).click();
    await expect(page.locator('#animalType option')).not.toHaveCount(1);

    const firstValue = await page.locator('#animalType option').nth(1).getAttribute('value');
    await page.locator('#animalType').selectOption(firstValue);
    await expect(page.locator('#chromosome option')).not.toHaveCount(1);
  });

  test('opens gene editing view in detail pane', async ({ page }) => {
    await openGeneEditor(page);
    await expect(page.locator('.gene-editing-header')).toBeVisible();
  });
});

// ==========================================
// Gene Editing View
// ==========================================

test.describe('Gene Editing View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await openGeneEditor(page);
  });

  test('displays gene cards grid', async ({ page }) => {
    await expect(page.locator('.genes-grid')).toBeVisible();
    expect(await page.locator('.gene-card').count()).toBeGreaterThan(0);
  });

  test('shows gene IDs', async ({ page }) => {
    expect(await page.locator('.gene-id').count()).toBeGreaterThan(0);
  });

  test('has export button', async ({ page }) => {
    await expect(page.locator('.export-btn')).toBeVisible();
  });
});

// ==========================================
// Tab Navigation
// ==========================================

test.describe('Tab Navigation', () => {
  test('switches between tabs', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await expect(page.locator('.tab-btn').filter({ hasText: 'Pets' })).toHaveClass(/active/);

    await page.locator('.tab-btn').filter({ hasText: 'Genes' }).click();
    await expect(page.locator('.tab-btn').filter({ hasText: 'Genes' })).toHaveClass(/active/);
    await expect(page.locator('#animalType')).toBeVisible();

    await page.locator('.tab-btn').filter({ hasText: 'Pets' }).click();
    await expect(page.locator('.tab-btn').filter({ hasText: 'Pets' })).toHaveClass(/active/);
  });

  test('clears pet selection on tab switch', async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);

    await page.locator('.pet-card').first().click();
    await expect(page.locator('.pet-visualization')).toBeVisible();

    await page.locator('.tab-btn').filter({ hasText: 'Genes' }).click();
    await page.locator('.tab-btn').filter({ hasText: 'Pets' }).click();
    await expect(page.getByText('Select a pet to view details')).toBeVisible();
  });
});

// ==========================================
// Window Sizing
// ==========================================

test.describe('Window Sizing', () => {
  for (const [w, h] of [
    [1200, 800],
    [1024, 768],
    [800, 600],
  ]) {
    test(`renders at ${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/');
      await waitForAppReady(page);
      await expect(page.locator('.top-bar')).toBeVisible();
      await expect(page.locator('.master-panel')).toBeVisible();
    });
  }
});
