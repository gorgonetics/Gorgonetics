import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '$lib/services/database.js';
import * as gameImport from '$lib/services/gameImport.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';
import { sha256Hex } from '$lib/utils/hash.js';

const SAMPLE_BEEWASP = readFileSync(resolve('data/Genes_SampleFaeBee.txt'), 'utf-8');

describe('gameImport service', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
  });

  describe('detectPlatform', () => {
    it('returns one of the supported platform tags', () => {
      const platform = gameImport.detectPlatform();
      expect(['windows', 'mac', 'linux', 'unknown']).toContain(platform);
    });
  });

  describe('getDefaultGameFolder', () => {
    it('returns the verified Mac path under $HOME', () => {
      expect(gameImport.getDefaultGameFolder('mac')).toBe(
        '$HOME/Library/Application Support/unity.Elder Game.Project Gorgon/Reports',
      );
    });

    it('returns the verified Windows path under $HOME/AppData/LocalLow', () => {
      expect(gameImport.getDefaultGameFolder('windows')).toBe(
        '$HOME/AppData/LocalLow/Elder Game/Project Gorgon/Reports',
      );
    });

    it('returns the verified Linux path under $HOME/.config/unity3d', () => {
      expect(gameImport.getDefaultGameFolder('linux')).toBe('$HOME/.config/unity3d/Elder Game/Project Gorgon/Reports');
    });

    it('returns empty string for unknown platform', () => {
      expect(gameImport.getDefaultGameFolder('unknown')).toBe('');
    });
  });

  describe('isPlaceholderPath', () => {
    it('treats empty/whitespace as placeholder', () => {
      expect(gameImport.isPlaceholderPath('')).toBe(true);
      expect(gameImport.isPlaceholderPath('   ')).toBe(true);
    });
    it('treats real paths as not-placeholder', () => {
      expect(gameImport.isPlaceholderPath('/Users/me/game')).toBe(false);
      expect(gameImport.isPlaceholderPath('C:/Games/Project Gorgon')).toBe(false);
    });
  });

  describe('autoScanGameFolder', () => {
    it('returns error status outside Tauri', async () => {
      const result = await gameImport.autoScanGameFolder();
      expect(result.status).toBe('error');
      expect(result.message).toMatch(/desktop app/i);
    });
  });

  describe('watchGameFolder', () => {
    it('returns null outside Tauri', async () => {
      const stop = await gameImport.watchGameFolder(() => {});
      expect(stop).toBeNull();
    });
  });

  describe('imported_files ledger', () => {
    it('records hash on successful upload', async () => {
      const hash = await sha256Hex(SAMPLE_BEEWASP);
      expect(await petService.hasImportedFile(hash)).toBe(false);

      const result = await petService.uploadPet(SAMPLE_BEEWASP, 'Test', 'Female');
      expect(result.status).toBe('success');
      expect(await petService.hasImportedFile(hash)).toBe(true);
    });

    it('keeps the hash recorded after pet deletion', async () => {
      const hash = await sha256Hex(SAMPLE_BEEWASP);
      const upload = await petService.uploadPet(SAMPLE_BEEWASP, 'Test', 'Female');
      expect(upload.status).toBe('success');

      await petService.deletePet(upload.pet_id);
      expect(await petService.hasImportedFile(hash)).toBe(true);
    });

    it('recordImportedFile is idempotent for the same hash', async () => {
      await petService.recordImportedFile('abc123', '/path/one');
      await petService.recordImportedFile('abc123', '/path/two');
      expect(await petService.hasImportedFile('abc123')).toBe(true);
    });

    it('backfillImportedFilesIfNeeded populates ledger from existing pets', async () => {
      // Upload a pet, then wipe the ledger to simulate a pre-feature
      // database, and verify the backfill reseeds it.
      const hash = await sha256Hex(SAMPLE_BEEWASP);
      const upload = await petService.uploadPet(SAMPLE_BEEWASP, 'Test', 'Female');
      expect(upload.status).toBe('success');

      const { getDb } = await import('$lib/services/database.js');
      await getDb().execute('DELETE FROM imported_files');
      // Reset the guard flag so the backfill actually runs.
      await getDb().execute("DELETE FROM settings WHERE key = 'pets.imported_files_backfilled'");
      expect(await petService.hasImportedFile(hash)).toBe(false);

      await petService.backfillImportedFilesIfNeeded();
      expect(await petService.hasImportedFile(hash)).toBe(true);
    });
  });
});
