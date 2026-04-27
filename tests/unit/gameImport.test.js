import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '$lib/services/database.js';
import * as gameImport from '$lib/services/gameImport.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';

const SAMPLE_BEEWASP = readFileSync(resolve('data/Genes_SampleFaeBee.txt'), 'utf-8');

async function sha256(content) {
  const data = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

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
    it('returns a placeholder string for each platform', () => {
      expect(gameImport.getDefaultGameFolder('windows')).toContain('TODO');
      expect(gameImport.getDefaultGameFolder('mac')).toContain('TODO');
      expect(gameImport.getDefaultGameFolder('linux')).toContain('TODO');
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
    it('treats <TODO: ...> as placeholder', () => {
      expect(gameImport.isPlaceholderPath('<TODO: fill me in>')).toBe(true);
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

  describe('imported_files ledger', () => {
    it('records hash on successful upload', async () => {
      const hash = await sha256(SAMPLE_BEEWASP);
      expect(await petService.hasImportedFile(hash)).toBe(false);

      const result = await petService.uploadPet(SAMPLE_BEEWASP, 'Test', 'Female');
      expect(result.status).toBe('success');
      expect(await petService.hasImportedFile(hash)).toBe(true);
    });

    it('keeps the hash recorded after pet deletion', async () => {
      const hash = await sha256(SAMPLE_BEEWASP);
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
      const hash = await sha256(SAMPLE_BEEWASP);
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
