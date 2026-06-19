/**
 * Unit tests for updateService — mocks the Tauri core/process plugins so we can
 * assert the download → backup → install → relaunch ordering and the
 * best-effort backup behaviour without a desktop runtime.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installUpdateWithBackup } from '$lib/services/updateService.js';

// Shared step log so every actor — the Update, the backup command, and
// relaunch — records into the same ordering across a run.
let order = [];
const invoke = vi.fn();
const relaunch = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args) => invoke(...args) }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: (...args) => relaunch(...args) }));

/** A fake Update that records call order and drives the progress callback. */
function makeUpdate() {
  return {
    version: '0.7.0',
    download: vi.fn(async (onEvent) => {
      order.push('download');
      onEvent?.({ event: 'Started', data: { contentLength: 200 } });
      onEvent?.({ event: 'Progress', data: { chunkLength: 100 } });
      onEvent?.({ event: 'Progress', data: { chunkLength: 100 } });
    }),
    install: vi.fn(async () => {
      order.push('install');
    }),
  };
}

describe('installUpdateWithBackup', () => {
  beforeEach(() => {
    order = [];
    invoke.mockReset().mockImplementation(async () => {
      order.push('backup');
    });
    relaunch.mockReset().mockImplementation(async () => {
      order.push('relaunch');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('backs up between download and install, then relaunches', async () => {
    const update = makeUpdate();

    await installUpdateWithBackup(update);

    expect(invoke).toHaveBeenCalledWith('backup_before_update', { toVersion: '0.7.0' });
    // The backup must land after the download finishes and before the install
    // swap; relaunch happens last. The full sequence is asserted so the test
    // fails if any step is reordered.
    expect(order).toEqual(['download', 'backup', 'install', 'relaunch']);
    expect(update.download).toHaveBeenCalledOnce();
    expect(update.install).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it('reports download progress as a percentage', async () => {
    const onProgress = vi.fn();
    await installUpdateWithBackup(makeUpdate(), onProgress);

    // 200-byte total, two 100-byte chunks → 50% then 100%.
    expect(onProgress).toHaveBeenNthCalledWith(1, 50);
    expect(onProgress).toHaveBeenNthCalledWith(2, 100);
  });

  it('proceeds with install when the backup fails', async () => {
    invoke.mockRejectedValueOnce(new Error('disk full'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const update = makeUpdate();

    await installUpdateWithBackup(update);

    expect(warn).toHaveBeenCalled();
    // Backup failed (no 'backup' entry) but install and relaunch still ran.
    expect(order).toEqual(['download', 'install', 'relaunch']);
    expect(update.install).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it('aborts without installing when the download fails', async () => {
    const update = {
      version: '0.7.0',
      download: vi.fn(async () => {
        throw new Error('network');
      }),
      install: vi.fn(),
    };

    await expect(installUpdateWithBackup(update)).rejects.toThrow('network');
    expect(invoke).not.toHaveBeenCalled();
    expect(update.install).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
  });
});
