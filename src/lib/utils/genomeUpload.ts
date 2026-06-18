/**
 * Shared genome-upload helpers used by both the file-picker upload and the
 * drag-and-drop upload in PetList. Kept UI-agnostic so the orchestration and
 * the drop-filtering rules can be unit-tested without a component harness.
 */

/** A pending upload: a display name plus a lazy reader for its text content. */
export interface UploadSource {
  name: string;
  read: () => Promise<string>;
}

export interface UploadResult {
  status: string;
  message?: string;
}

export interface RunUploadOptions {
  /** Persist one genome's text; mirrors `appState.uploadPetQuiet`. */
  upload: (content: string) => Promise<UploadResult>;
  /** Progress callback, 1-based current of total. */
  onProgress?: (current: number, total: number) => void;
}

export interface UploadSummary {
  total: number;
  succeeded: number;
  /** `"<name>: <reason>"` for each source that failed to read or import. */
  failures: string[];
}

/**
 * Upload each source sequentially. A read error or an `error` upload result is
 * collected as a failure rather than aborting the batch — one bad file never
 * blocks the rest. Returns counts the caller can surface to the user.
 */
export async function runGenomeUpload(
  sources: UploadSource[],
  { upload, onProgress }: RunUploadOptions,
): Promise<UploadSummary> {
  const total = sources.length;
  const failures: string[] = [];

  for (let i = 0; i < total; i++) {
    onProgress?.(i + 1, total);
    const { name, read } = sources[i];
    try {
      const content = await read();
      const result = await upload(content);
      if (result.status === 'error') failures.push(`${name}: ${result.message}`);
    } catch (err) {
      failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { total, succeeded: total - failures.length, failures };
}

/** True when a drag carries OS files (vs. an internal card-reorder drag). */
export function isFileDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types).includes('Files');
}

/**
 * Partition dropped files into genome files we accept (`.txt`, matching the
 * file-picker filter) and the rest. Case-insensitive on the extension.
 */
export function selectGenomeFiles(files: File[]): { accepted: File[]; rejected: File[] } {
  const accepted: File[] = [];
  const rejected: File[] = [];
  for (const file of files) {
    if (file.name.toLowerCase().endsWith('.txt')) accepted.push(file);
    else rejected.push(file);
  }
  return { accepted, rejected };
}
