import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listBundledResources,
  loadBundledResource,
  openFileDialog,
  pickBackupFile,
  pickGenomeFiles,
  readBinaryFile,
  saveExportBinaryFile,
} from '$lib/services/fileService.js';

// All tests run outside Tauri (isTauri() returns false), testing browser fallback paths.

describe('File Service (browser fallbacks)', () => {
  describe('openFileDialog', () => {
    it('returns empty array outside Tauri', async () => {
      const result = await openFileDialog('title', 'filter', ['txt'], false);
      expect(result).toEqual([]);
    });
  });

  describe('pickGenomeFiles', () => {
    it('returns empty array outside Tauri', async () => {
      const result = await pickGenomeFiles();
      expect(result).toEqual([]);
    });
  });

  describe('pickBackupFile', () => {
    it('returns null outside Tauri', async () => {
      const result = await pickBackupFile();
      expect(result).toBeNull();
    });
  });

  describe('readBinaryFile', () => {
    it('throws outside Tauri', async () => {
      await expect(readBinaryFile('/some/path')).rejects.toThrow('Binary file reading not available outside Tauri');
    });
  });

  describe('saveExportBinaryFile', () => {
    let createElementSpy;
    let revokeObjectURLSpy;
    let createObjectURLSpy;

    beforeEach(() => {
      const mockAnchor = { href: '', download: '', click: vi.fn() };
      createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor);
      createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
      revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('creates a download link in browser mode', async () => {
      const data = new Uint8Array([1, 2, 3]);
      const result = await saveExportBinaryFile('backup.zip', data);
      expect(result).toBe(true);
      expect(createElementSpy).toHaveBeenCalledWith('a');
      expect(createObjectURLSpy).toHaveBeenCalled();
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:test');
    });

    it('sets the correct filename on the download link', async () => {
      const mockAnchor = { href: '', download: '', click: vi.fn() };
      createElementSpy.mockReturnValue(mockAnchor);
      await saveExportBinaryFile('my-backup.zip', new Uint8Array([1]));
      expect(mockAnchor.download).toBe('my-backup.zip');
    });
  });

  describe('loadBundledResource', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('fetches from web path with resources/ prefix stripped', async () => {
      const mockResponse = { ok: true, text: () => Promise.resolve('{"data": true}') };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

      const result = await loadBundledResource('resources/assets/beewasp/file.json');
      expect(result).toBe('{"data": true}');
      expect(globalThis.fetch).toHaveBeenCalledWith('/assets/beewasp/file.json');
    });

    it('throws on fetch failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404 });
      await expect(loadBundledResource('resources/missing.json')).rejects.toThrow('404');
    });
  });

  describe('listBundledResources', () => {
    it('returns beewasp gene file list for beewasp directory', async () => {
      const files = await listBundledResources('resources/assets/beewasp');
      expect(files).toHaveLength(10);
      expect(files[0]).toContain('beewasp_genes_chr01.json');
      expect(files[9]).toContain('beewasp_genes_chr10.json');
    });

    it('returns horse gene file list for horse directory', async () => {
      const files = await listBundledResources('resources/assets/horse');
      expect(files).toHaveLength(48);
      expect(files[0]).toContain('horse_genes_chr01.json');
      expect(files[47]).toContain('horse_genes_chr48.json');
    });

    it('returns empty array for unknown directory', async () => {
      const files = await listBundledResources('resources/assets/unknown');
      expect(files).toEqual([]);
    });
  });
});
