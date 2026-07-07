import { expect, test } from '@playwright/test';
import { openEditor, waitForPets } from './helpers.js';

// ==========================================
// Pet Editor – Saving Changes
// ==========================================

test.describe('Pet Editor – Save', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);
  });

  test('saves name change and persists it', async ({ page }) => {
    // The roster is name-sorted, so target rows by name rather than position.
    const firstRow = page.locator('[data-testid="roster"] tbody tr').first();
    const originalName = (await firstRow.locator('[data-testid="roster-open"]').textContent())?.trim() ?? '';

    await firstRow.locator('[data-testid="pet-edit-btn"]').click();
    await expect(page.locator('[data-testid="pet-editor"]')).toBeVisible();
    const newName = `Renamed-${Date.now()}`;
    await page.locator('#petName').fill(newName);
    await page.locator('.btn-primary').click();

    await expect(page.locator('[data-testid="pet-editor"]')).not.toBeVisible();
    await expect(page.locator('.save-error')).toHaveCount(0);

    // The renamed pet shows in the table (sort may move it).
    const renamedRow = page.locator('[data-testid="roster"] tbody tr').filter({ hasText: newName });
    await expect(renamedRow).toHaveCount(1);

    // Re-open that pet by name and verify the change stuck, then restore.
    await renamedRow.locator('[data-testid="pet-edit-btn"]').click();
    await expect(page.locator('#petName')).toHaveValue(newName);
    await page.locator('#petName').fill(originalName);
    await page.locator('.btn-primary').click();
    await expect(page.locator('[data-testid="pet-editor"]')).not.toBeVisible();
  });

  test('saves gender change and persists it', async ({ page }) => {
    await openEditor(page);

    const genderSelect = page.locator('#petGender');
    const originalGender = await genderSelect.inputValue();
    const newGender = originalGender === 'Male' ? 'Female' : 'Male';

    await genderSelect.selectOption(newGender);
    await page.locator('.btn-primary').click();

    // Modal closes without error
    await expect(page.locator('[data-testid="pet-editor"]')).not.toBeVisible();
    await expect(page.locator('.save-error')).toHaveCount(0);

    // Re-open and verify
    await openEditor(page);
    await expect(genderSelect).toHaveValue(newGender);

    // Restore
    await genderSelect.selectOption(originalGender);
    await page.locator('.btn-primary').click();
    await expect(page.locator('[data-testid="pet-editor"]')).not.toBeVisible();
  });

  test('saves breed change and persists it', async ({ page }) => {
    await openEditor(page);

    const breedSelect = page.locator('#petBreed');
    const options = await breedSelect.locator('option').allTextContents();

    // Only test if there are multiple breed options
    if (options.length < 2) return;

    const originalBreed = await breedSelect.inputValue();
    // Skip the explicit "Not set" (empty-value) option — pick a real breed.
    const newBreed = options.find((o) => o !== originalBreed && o !== 'Not set');
    if (newBreed === undefined) return;
    await breedSelect.selectOption(newBreed);

    await page.locator('.btn-primary').click();
    await expect(page.locator('[data-testid="pet-editor"]')).not.toBeVisible();
    await expect(page.locator('.save-error')).toHaveCount(0);

    // Re-open and verify
    await openEditor(page);
    await expect(breedSelect).toHaveValue(newBreed);

    // Restore
    await breedSelect.selectOption(originalBreed);
    await page.locator('.btn-primary').click();
    await expect(page.locator('[data-testid="pet-editor"]')).not.toBeVisible();
  });

  test('saves attribute changes and persists them', async ({ page }) => {
    await openEditor(page);

    // Grab the first attribute input
    const attrInput = page.locator('.attr-field input[type="number"]').first();
    const originalValue = await attrInput.inputValue();
    const newValue = originalValue === '75' ? '25' : '75';

    await attrInput.fill(newValue);
    await page.locator('.btn-primary').click();

    // Modal closes without error — this is the exact scenario that was broken
    await expect(page.locator('[data-testid="pet-editor"]')).not.toBeVisible();
    await expect(page.locator('.save-error')).toHaveCount(0);

    // Re-open and verify the attribute value persisted
    await openEditor(page);
    await expect(page.locator('.attr-field input[type="number"]').first()).toHaveValue(newValue);

    // Restore
    await attrInput.fill(originalValue);
    await page.locator('.btn-primary').click();
    await expect(page.locator('[data-testid="pet-editor"]')).not.toBeVisible();
  });

  test('saves multiple attribute changes at once', async ({ page }) => {
    await openEditor(page);

    const attrInputs = page.locator('.attr-field input[type="number"]');
    const count = await attrInputs.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Read originals
    const originals = [];
    for (let i = 0; i < Math.min(count, 3); i++) {
      originals.push(await attrInputs.nth(i).inputValue());
    }

    // Set new values
    const newValues = originals.map((v) => (v === '99' ? '1' : '99'));
    for (let i = 0; i < newValues.length; i++) {
      await attrInputs.nth(i).fill(newValues[i]);
    }

    await page.locator('.btn-primary').click();
    await expect(page.locator('[data-testid="pet-editor"]')).not.toBeVisible();
    await expect(page.locator('.save-error')).toHaveCount(0);

    // Re-open and verify all values
    await openEditor(page);
    for (let i = 0; i < newValues.length; i++) {
      await expect(attrInputs.nth(i)).toHaveValue(newValues[i]);
    }

    // Restore
    for (let i = 0; i < originals.length; i++) {
      await attrInputs.nth(i).fill(originals[i]);
    }
    await page.locator('.btn-primary').click();
    await expect(page.locator('[data-testid="pet-editor"]')).not.toBeVisible();
  });

  test('saves combined name and attribute changes', async ({ page }) => {
    await openEditor(page);

    const nameInput = page.locator('#petName');
    const attrInput = page.locator('.attr-field input[type="number"]').first();
    const originalName = await nameInput.inputValue();
    const originalAttr = await attrInput.inputValue();

    const newName = `Combined-${Date.now()}`;
    const newAttr = originalAttr === '42' ? '58' : '42';

    await nameInput.fill(newName);
    await attrInput.fill(newAttr);
    await page.locator('.btn-primary').click();

    await expect(page.locator('[data-testid="pet-editor"]')).not.toBeVisible();
    await expect(page.locator('.save-error')).toHaveCount(0);

    // Verify both persisted
    await openEditor(page);
    await expect(nameInput).toHaveValue(newName);
    await expect(attrInput).toHaveValue(newAttr);

    // Restore
    await nameInput.fill(originalName);
    await attrInput.fill(originalAttr);
    await page.locator('.btn-primary').click();
    await expect(page.locator('[data-testid="pet-editor"]')).not.toBeVisible();
  });

  test('saving with no changes closes modal without error', async ({ page }) => {
    await openEditor(page);
    await page.locator('.btn-primary').click();

    await expect(page.locator('[data-testid="pet-editor"]')).not.toBeVisible();
    await expect(page.locator('.save-error')).toHaveCount(0);
  });
});

// ==========================================
// Pet Editor – Cancel / Discard
// ==========================================

test.describe('Pet Editor – Cancel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);
  });

  // Backing out with pending changes (Cancel / Escape / back button) opens a
  // discard-confirm dialog instead of silently dropping the edits (#396).

  test('cancel with no changes closes immediately without a confirm', async ({ page }) => {
    await openEditor(page);
    await page.locator('.editor-footer .btn-secondary').click();

    await expect(page.locator('[data-testid="pet-editor-discard-confirm"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="pet-editor"]')).not.toBeVisible();
  });

  test('cancel with a name change asks before discarding', async ({ page }) => {
    const originalName = (await page.locator('[data-testid="roster-open"]').first().textContent()) ?? '';

    await openEditor(page);
    await page.locator('#petName').fill('ShouldNotPersist');
    await page.locator('.editor-footer .btn-secondary').click();

    // The editor stays until the discard is confirmed.
    await expect(page.locator('[data-testid="pet-editor-discard-confirm"]')).toBeVisible();
    await expect(page.locator('[data-testid="pet-editor"]')).toBeVisible();

    await page.locator('[data-testid="discard-confirm"]').click();
    await expect(page.locator('[data-testid="pet-editor"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="roster-open"]').first()).toHaveText(originalName);
  });

  test('"Keep editing" returns to the editor with the edits intact', async ({ page }) => {
    await openEditor(page);
    await page.locator('#petName').fill('StillEditing');
    await page.locator('[data-testid="pet-editor-back"]').click();

    await expect(page.locator('[data-testid="pet-editor-discard-confirm"]')).toBeVisible();
    await page.locator('[data-testid="discard-keep-editing"]').click();

    await expect(page.locator('[data-testid="pet-editor-discard-confirm"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="pet-editor"]')).toBeVisible();
    await expect(page.locator('#petName')).toHaveValue('StillEditing');

    // Clean up: discard for real.
    await page.locator('[data-testid="pet-editor-back"]').click();
    await page.locator('[data-testid="discard-confirm"]').click();
    await expect(page.locator('[data-testid="pet-editor"]')).not.toBeVisible();
  });

  test('cancel discards attribute change after confirming', async ({ page }) => {
    await openEditor(page);

    const attrInput = page.locator('.attr-field input[type="number"]').first();
    const originalValue = await attrInput.inputValue();

    await attrInput.fill('0');
    await page.locator('.editor-footer .btn-secondary').click();
    await page.locator('[data-testid="discard-confirm"]').click();

    await expect(page.locator('[data-testid="pet-editor"]')).not.toBeVisible();

    // Re-open and verify original value is intact
    await openEditor(page);
    await expect(page.locator('.attr-field input[type="number"]').first()).toHaveValue(originalValue);
    await page.locator('[data-testid="pet-editor-back"]').click();
  });

  test('escape key with unsaved changes asks, then discards', async ({ page }) => {
    const originalName = (await page.locator('[data-testid="roster-open"]').first().textContent()) ?? '';

    await openEditor(page);
    await page.locator('#petName').fill('EscapeShouldDiscard');
    await page.keyboard.press('Escape');

    // Escape surfaces the guard rather than closing outright; a second Escape
    // dismisses only the dialog (keep editing).
    await expect(page.locator('[data-testid="pet-editor-discard-confirm"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="pet-editor-discard-confirm"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="pet-editor"]')).toBeVisible();

    await page.keyboard.press('Escape');
    await page.locator('[data-testid="discard-confirm"]').click();

    await expect(page.locator('[data-testid="pet-editor"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="roster-open"]').first()).toHaveText(originalName);
  });

  test('back button with unsaved changes asks, then discards', async ({ page }) => {
    const originalName = (await page.locator('[data-testid="roster-open"]').first().textContent()) ?? '';

    await openEditor(page);
    await page.locator('#petName').fill('BackShouldDiscard');
    await page.locator('[data-testid="pet-editor-back"]').click();
    await page.locator('[data-testid="discard-confirm"]').click();

    await expect(page.locator('[data-testid="pet-editor"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="roster-open"]').first()).toHaveText(originalName);
  });
});

// ==========================================
// Pet Editor – Initial Values
// ==========================================

test.describe('Pet Editor – Initial Values', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);
  });

  test('editor shows correct pet name', async ({ page }) => {
    const cardName = (await page.locator('[data-testid="roster-open"]').first().textContent()) ?? '';
    await openEditor(page);
    await expect(page.locator('#petName')).toHaveValue(cardName);
  });

  test('species and breeder shown as read-only metadata', async ({ page }) => {
    await openEditor(page);
    // Provenance is not editable: shown as a static meta line, not inputs.
    const meta = page.locator('.meta-line');
    await expect(meta).toBeVisible();
    await expect(meta).toContainText('Species');
    await expect(meta).toContainText('Breeder');
    await expect(page.locator('#petSpecies')).toHaveCount(0);
    await expect(page.locator('#petBreeder')).toHaveCount(0);
  });

  test('attribute inputs have numeric values between 0-100', async ({ page }) => {
    await openEditor(page);
    const attrInputs = page.locator('.attr-field input[type="number"]');
    const count = await attrInputs.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const val = Number(await attrInputs.nth(i).inputValue());
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(100);
    }
  });

  test('shows species-appropriate attributes', async ({ page }) => {
    await openEditor(page);
    const meta = (await page.locator('.meta-line').textContent()) ?? '';
    const species = meta.includes('BeeWasp') ? 'BeeWasp' : meta.includes('Horse') ? 'Horse' : '';
    const labels = await page.locator('.attr-field label').allTextContents();
    const labelText = labels.join(' ').toLowerCase();

    // Core attributes always present
    expect(labelText).toContain('intelligence');
    expect(labelText).toContain('toughness');

    // Species-specific
    if (species === 'BeeWasp') {
      expect(labelText).toContain('ferocity');
      expect(labelText).not.toContain('temperament');
    } else if (species === 'Horse') {
      expect(labelText).toContain('temperament');
      expect(labelText).not.toContain('ferocity');
    }
  });
});

// ==========================================
// Pet Delete + Re-edit
// ==========================================

test.describe('Pet Delete – Count Integrity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);
  });

  test('deleting a pet updates the pet count', async ({ page }) => {
    const rows = page.locator('[data-testid="roster"] tbody tr');
    const countBefore = await rows.count();

    await rows.first().locator('[data-testid="pet-delete-btn"]').click();
    await page.locator('.btn-danger').filter({ hasText: 'Delete' }).click();
    await expect(page.locator('.confirm-dialog')).toHaveCount(0);

    // Use Playwright's auto-retrying assertion to avoid races with async UI updates
    await expect(rows).toHaveCount(countBefore - 1);
  });
});
