/**
 * Reactive controller for the genome add-pet affordances: file-picker upload,
 * drag-and-drop upload, and the manual game-folder auto-scan. The pre-redesign
 * UI inlined all of this in PetList.svelte; the Library + Workspace shell needs
 * the same behaviour, so the orchestration is extracted here (the pure helpers
 * stay in `genomeUpload.ts`). The Library drives it today; PetList keeps its own
 * inline copy until the cutover removes that component.
 *
 * Wire the returned handlers onto a scroll container (drag/drop) and the
 * footer buttons (upload, auto-scan); read the `*` getters for button state and
 * the drop overlay. See docs/design/redesign-library-workspace-v1.md §5.
 */
import { get } from 'svelte/store';
import { pickGenomeFiles, readFileContent } from '$lib/services/fileService.js';
import { autoScanGameFolder } from '$lib/services/gameImport.js';
import { refreshPendingImportCount } from '$lib/stores/gameImport.js';
import { appState, error } from '$lib/stores/pets.js';
import { errorMessage } from '$lib/utils/error.js';
import type { UploadSource } from '$lib/utils/genomeUpload.js';
import { isFileDrag, runGenomeUpload, selectGenomeFiles } from '$lib/utils/genomeUpload.js';
import { getBasename } from '$lib/utils/path.js';

interface Progress {
  current: number;
  total: number;
}

export function createGenomeUploadController() {
  let uploading = $state(false);
  let uploadProgress = $state<Progress | null>(null);
  let autoScanning = $state(false);
  let autoScanProgress = $state<Progress | null>(null);
  let fileDragActive = $state(false);

  async function uploadSources(sources: UploadSource[]): Promise<void> {
    if (sources.length === 0 || uploading || autoScanning) return;
    uploading = true;
    error.set(null);
    try {
      const { total, succeeded, failures } = await runGenomeUpload(sources, {
        upload: (content: string) => appState.uploadPetQuiet(content),
        onProgress: (current: number, t: number) => {
          uploadProgress = { current, total: t };
        },
      });
      await appState.loadPets();
      if (failures.length > 0) {
        error.set(`${succeeded}/${total} uploaded. ${failures.length} failed:\n${failures.join('\n')}`);
      }
    } catch (err) {
      error.set(`Upload failed: ${errorMessage(err)}`);
    } finally {
      uploading = false;
      uploadProgress = null;
    }
  }

  async function handleUpload(): Promise<void> {
    let filePaths: string[];
    try {
      filePaths = await pickGenomeFiles();
    } catch (err) {
      error.set(`Upload failed: ${errorMessage(err)}`);
      return;
    }
    await uploadSources(filePaths.map((path) => ({ name: getBasename(path), read: () => readFileContent(path) })));
  }

  // Drag-and-drop genome upload (#98). External OS file drags carry a 'Files'
  // type; internal drags don't — isFileDrag() tells them apart.
  function handleFileDragOver(e: DragEvent): void {
    if (!isFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    fileDragActive = true;
  }

  function handleFileDragLeave(e: DragEvent & { currentTarget: EventTarget & Element }): void {
    if (!isFileDrag(e.dataTransfer)) return;
    // Ignore leaves into descendant elements; only clear when the cursor leaves
    // the container entirely (relatedTarget is null when leaving the window).
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    fileDragActive = false;
  }

  async function handleFileDrop(e: DragEvent): Promise<void> {
    if (!isFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    fileDragActive = false;
    const dropped = Array.from(e.dataTransfer?.files ?? []);
    if (dropped.length === 0) return;

    const { accepted, rejected } = selectGenomeFiles(dropped);
    if (accepted.length === 0) {
      error.set('No genome files (.txt) in the dropped items.');
      return;
    }
    await uploadSources(accepted.map((file: File) => ({ name: file.name, read: () => file.text() })));
    if (rejected.length > 0 && !get(error)) {
      error.set(`Skipped ${rejected.length} non-genome file${rejected.length === 1 ? '' : 's'}.`);
    }
  }

  async function handleAutoScan(): Promise<void> {
    try {
      autoScanning = true;
      error.set(null);
      const result = await autoScanGameFolder({
        onProgress: (current: number, total: number) => {
          autoScanProgress = { current, total };
        },
      });

      if (result.status === 'not_configured') {
        error.set('Auto-import folder is not configured. Set the path in Settings → Auto-import.');
        return;
      }
      if (result.status === 'folder_missing') {
        error.set(result.message ?? 'Configured game folder was not found.');
        return;
      }
      if (result.status === 'error') {
        error.set(result.message ?? 'Auto-import failed.');
        return;
      }

      // autoScanGameFolder refreshes the pets store itself on a DB change (#253).
      const backfillNote = result.backfilled > 0 ? `, ${result.backfilled} unlocked for sharing` : '';
      const summary = `Auto-import: ${result.imported} new, ${result.skipped} already imported${backfillNote} (of ${result.scanned} files).`;
      if (result.failures.length > 0) {
        const lines = result.failures.map((f: { file: string; reason: string }) => `${f.file}: ${f.reason}`);
        error.set(`${summary}\n${result.failures.length} failed:\n${lines.join('\n')}`);
      } else if (result.imported > 0 || result.backfilled > 0) {
        error.set(summary);
      }
    } catch (err) {
      error.set(`Auto-import failed: ${errorMessage(err)}`);
    } finally {
      autoScanning = false;
      autoScanProgress = null;
      void refreshPendingImportCount();
    }
  }

  return {
    get uploading() {
      return uploading;
    },
    get uploadProgress() {
      return uploadProgress;
    },
    get autoScanning() {
      return autoScanning;
    },
    get autoScanProgress() {
      return autoScanProgress;
    },
    get fileDragActive() {
      return fileDragActive;
    },
    handleUpload,
    handleAutoScan,
    handleFileDragOver,
    handleFileDragLeave,
    handleFileDrop,
  };
}
