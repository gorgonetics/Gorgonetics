import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '$lib/services/database.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as settings from '$lib/services/settingsService.js';

describe('Settings Service', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
  });

  describe('getDefaultSettings', () => {
    it('returns a copy of defaults', () => {
      const defaults = settings.getDefaultSettings();
      expect(defaults).toHaveProperty('horse.autoSelectBreedFilter', true);
      defaults['horse.autoSelectBreedFilter'] = false;
      expect(settings.getDefaultSettings()['horse.autoSelectBreedFilter']).toBe(true);
    });
  });

  describe('getSetting / setSetting', () => {
    it('returns default when key is not set', async () => {
      const value = await settings.getSetting('horse.autoSelectBreedFilter');
      expect(value).toBe(true);
    });

    it('returns undefined for unknown keys', async () => {
      const value = await settings.getSetting('nonexistent');
      expect(value).toBeUndefined();
    });

    it('persists and retrieves a string value', async () => {
      await settings.setSetting('theme', 'dark');
      const value = await settings.getSetting('theme');
      expect(value).toBe('dark');
    });

    it('persists and retrieves a boolean value', async () => {
      await settings.setSetting('horse.autoSelectBreedFilter', false);
      const value = await settings.getSetting('horse.autoSelectBreedFilter');
      expect(value).toBe(false);
    });

    it('persists and retrieves a numeric value', async () => {
      await settings.setSetting('fontSize', 14);
      const value = await settings.getSetting('fontSize');
      expect(value).toBe(14);
    });

    it('overwrites previous value', async () => {
      await settings.setSetting('theme', 'light');
      await settings.setSetting('theme', 'dark');
      const value = await settings.getSetting('theme');
      expect(value).toBe('dark');
    });
  });

  describe('getAllSettings', () => {
    it('returns defaults when no settings are stored', async () => {
      const all = await settings.getAllSettings();
      expect(all).toHaveProperty('horse.autoSelectBreedFilter', true);
    });

    it('merges stored values over defaults', async () => {
      await settings.setSetting('horse.autoSelectBreedFilter', false);
      await settings.setSetting('theme', 'dark');
      const all = await settings.getAllSettings();
      expect(all['horse.autoSelectBreedFilter']).toBe(false);
      expect(all.theme).toBe('dark');
    });
  });

  describe('resetSetting', () => {
    it('reverts to default after reset', async () => {
      await settings.setSetting('horse.autoSelectBreedFilter', false);
      await settings.resetSetting('horse.autoSelectBreedFilter');
      const value = await settings.getSetting('horse.autoSelectBreedFilter');
      expect(value).toBe(true);
    });
  });
});
