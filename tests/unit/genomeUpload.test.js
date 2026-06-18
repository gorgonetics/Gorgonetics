import { describe, expect, it, vi } from 'vitest';
import { isFileDrag, runGenomeUpload, selectGenomeFiles } from '$lib/utils/genomeUpload.js';

// Minimal stand-in for an upload source; `read` resolves to genome text.
function source(name, content) {
  return { name, read: () => Promise.resolve(content) };
}

describe('runGenomeUpload', () => {
  it('uploads every source and reports all successful', async () => {
    const upload = vi.fn().mockResolvedValue({ status: 'success' });
    const summary = await runGenomeUpload([source('a.txt', 'A'), source('b.txt', 'B')], { upload });

    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenNthCalledWith(1, 'A');
    expect(summary).toEqual({ total: 2, succeeded: 2, failures: [] });
  });

  it('reports per-file progress, 1-based', async () => {
    const upload = vi.fn().mockResolvedValue({ status: 'success' });
    const onProgress = vi.fn();
    await runGenomeUpload([source('a.txt', 'A'), source('b.txt', 'B')], { upload, onProgress });

    expect(onProgress).toHaveBeenNthCalledWith(1, 1, 2);
    expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2);
  });

  it('collects upload-error results without aborting the batch', async () => {
    const upload = vi
      .fn()
      .mockResolvedValueOnce({ status: 'error', message: 'bad genome' })
      .mockResolvedValueOnce({ status: 'success' });
    const summary = await runGenomeUpload([source('bad.txt', 'X'), source('ok.txt', 'Y')], { upload });

    expect(upload).toHaveBeenCalledTimes(2);
    expect(summary).toEqual({ total: 2, succeeded: 1, failures: ['bad.txt: bad genome'] });
  });

  it('treats a read failure as a failure for that file only', async () => {
    const upload = vi.fn().mockResolvedValue({ status: 'success' });
    const sources = [
      { name: 'unreadable.txt', read: () => Promise.reject(new Error('EACCES')) },
      source('ok.txt', 'Y'),
    ];
    const summary = await runGenomeUpload(sources, { upload });

    expect(upload).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({ total: 2, succeeded: 1, failures: ['unreadable.txt: EACCES'] });
  });

  it('returns an empty summary for no sources', async () => {
    const upload = vi.fn();
    const summary = await runGenomeUpload([], { upload });

    expect(upload).not.toHaveBeenCalled();
    expect(summary).toEqual({ total: 0, succeeded: 0, failures: [] });
  });
});

describe('isFileDrag', () => {
  it('is true when the drag carries OS files', () => {
    expect(isFileDrag({ types: ['Files'] })).toBe(true);
    expect(isFileDrag({ types: ['text/plain', 'Files'] })).toBe(true);
  });

  it('is false for internal drags without files', () => {
    expect(isFileDrag({ types: ['text/plain'] })).toBe(false);
    expect(isFileDrag({ types: [] })).toBe(false);
    expect(isFileDrag(null)).toBe(false);
  });
});

describe('selectGenomeFiles', () => {
  const file = (name) => ({ name });

  it('accepts .txt files case-insensitively and rejects the rest', () => {
    const { accepted, rejected } = selectGenomeFiles([
      file('pet1.txt'),
      file('pet2.TXT'),
      file('image.png'),
      file('notes.md'),
    ]);

    expect(accepted.map((f) => f.name)).toEqual(['pet1.txt', 'pet2.TXT']);
    expect(rejected.map((f) => f.name)).toEqual(['image.png', 'notes.md']);
  });

  it('returns empty partitions for no files', () => {
    expect(selectGenomeFiles([])).toEqual({ accepted: [], rejected: [] });
  });
});
