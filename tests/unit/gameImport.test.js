import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function stubUA(ua) {
      vi.stubGlobal('navigator', { userAgent: ua });
    }

    it('classifies macOS WebKit UA as mac', () => {
      stubUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15');
      expect(gameImport.detectPlatform()).toBe('mac');
    });

    it('classifies a UA containing "darwin" as mac (not windows)', () => {
      // Guard: 'darwin'.includes('win') is true, so a naive Windows
      // check would misclassify Darwin-flavored UAs.
      stubUA('SomeEmbedder/1.0 (Darwin 23.0)');
      expect(gameImport.detectPlatform()).toBe('mac');
    });

    it('classifies Windows 10/11 WebView2 UA as windows', () => {
      stubUA(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      );
      expect(gameImport.detectPlatform()).toBe('windows');
    });

    it('classifies Linux WebKitGTK UA as linux', () => {
      stubUA('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15');
      expect(gameImport.detectPlatform()).toBe('linux');
    });

    it('returns unknown for an unrecognized UA', () => {
      stubUA('CompletelyUnknown/1.0');
      expect(gameImport.detectPlatform()).toBe('unknown');
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
