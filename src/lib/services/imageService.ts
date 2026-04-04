/**
 * Pet image service for Gorgonetics.
 * Manages uploading, listing, and deleting pet screenshots.
 * Images are stored on the filesystem; metadata in the pet_images table.
 */

import type { PetImage } from '$lib/types/index.js';
import { isTauri } from '$lib/utils/environment.js';
import { getDb } from './database.js';

const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

function now(): string {
  return new Date().toISOString();
}

function getExtension(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : '';
}

function getBasename(path: string): string {
  const sep = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return sep >= 0 ? path.slice(sep + 1) : path;
}

function parseImage(row: Record<string, unknown>): PetImage {
  let tags: string[] = [];
  if (typeof row.tags === 'string') {
    try {
      tags = JSON.parse(row.tags);
    } catch {
      tags = [];
    }
  }
  return {
    ...(row as unknown as PetImage),
    tags,
  };
}

/**
 * Open a native file dialog to pick image files.
 */
export async function pickImageFiles(): Promise<string[] | null> {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({
    multiple: true,
    filters: [{ name: 'Images', extensions: ALLOWED_EXTENSIONS }],
    title: 'Select Pet Images',
  });
  if (!result) return null;
  return Array.isArray(result) ? result : [result];
}

/**
 * Upload an image for a pet. Copies the file to app data and inserts a DB record.
 */
export async function uploadImage(petId: number, sourcePath: string): Promise<PetImage> {
  const ext = getExtension(sourcePath);
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported image format: .${ext}`);
  }

  if (isTauri()) {
    const { readFile, writeFile, mkdir } = await import('@tauri-apps/plugin-fs');
    const { appDataDir, join } = await import('@tauri-apps/api/path');

    // Read the source file (dialog-selected paths have temporary read access)
    const fileData = await readFile(sourcePath);
    if (fileData.byteLength > MAX_FILE_SIZE) {
      throw new Error(`Image too large (${Math.round(fileData.byteLength / 1024 / 1024)}MB). Maximum is 20MB.`);
    }

    // Create target directory
    const baseDir = await appDataDir();
    const imageDir = await join(baseDir, 'images', String(petId));
    await mkdir(imageDir, { recursive: true });

    // Generate UUID filename and write
    const uuid = crypto.randomUUID();
    const filename = `${uuid}.${ext}`;
    const targetPath = await join(imageDir, filename);
    await writeFile(targetPath, fileData);

    // Insert DB record
    const db = getDb();
    const originalName = getBasename(sourcePath);
    const ts = now();
    const result = await db.execute(
      `INSERT INTO pet_images (pet_id, filename, original_name, caption, tags, created_at)
       VALUES ($pet_id, $filename, $original_name, $caption, $tags, $created_at)`,
      { pet_id: petId, filename, original_name: originalName, caption: '', tags: '[]', created_at: ts },
    );

    return {
      id: result.lastInsertId,
      pet_id: petId,
      filename,
      original_name: originalName,
      caption: '',
      tags: [],
      created_at: ts,
      url: await getImageUrl(petId, filename),
    };
  }

  throw new Error('Image upload not available outside Tauri');
}

/**
 * Get all images for a pet, with resolved URLs.
 */
export async function getImagesForPet(petId: number): Promise<PetImage[]> {
  const db = getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    'SELECT * FROM pet_images WHERE pet_id = $pet_id ORDER BY created_at DESC',
    { pet_id: petId },
  );

  const images = rows.map(parseImage);

  if (isTauri()) {
    for (const img of images) {
      img.url = await getImageUrl(img.pet_id, img.filename);
    }
  }

  return images;
}

/**
 * Resolve a displayable URL for an image file.
 * Reads the file bytes and creates a blob URL the webview can render.
 */
async function getImageUrl(petId: number, filename: string): Promise<string> {
  if (!isTauri()) return '';
  const { readFile } = await import('@tauri-apps/plugin-fs');
  const { appDataDir, join } = await import('@tauri-apps/api/path');
  const baseDir = await appDataDir();
  const fullPath = await join(baseDir, 'images', String(petId), filename);
  const data = await readFile(fullPath);
  const ext = getExtension(filename);
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const blob = new Blob([data], { type: mime });
  return URL.createObjectURL(blob);
}

/**
 * Delete a single image (file + DB record).
 */
export async function deleteImage(imageId: number, petId: number, filename: string): Promise<void> {
  if (isTauri()) {
    try {
      const { remove } = await import('@tauri-apps/plugin-fs');
      const { appDataDir, join } = await import('@tauri-apps/api/path');
      const baseDir = await appDataDir();
      const filePath = await join(baseDir, 'images', String(petId), filename);
      await remove(filePath);
    } catch {
      // File may already be gone — still remove the DB record
    }
  }

  const db = getDb();
  await db.execute('DELETE FROM pet_images WHERE id = $id', { id: imageId });
}

/**
 * Delete all images for a pet (directory + DB records).
 * Call this BEFORE deleting the pet row.
 */
export async function deleteAllImagesForPet(petId: number): Promise<void> {
  if (isTauri()) {
    try {
      const { remove } = await import('@tauri-apps/plugin-fs');
      const { appDataDir, join } = await import('@tauri-apps/api/path');
      const baseDir = await appDataDir();
      const petDir = await join(baseDir, 'images', String(petId));
      await remove(petDir, { recursive: true });
    } catch {
      // Directory may not exist
    }
  }

  const db = getDb();
  await db.execute('DELETE FROM pet_images WHERE pet_id = $pet_id', { pet_id: petId });
}

/**
 * Update image metadata (caption and/or tags).
 */
export async function updateImageMetadata(
  imageId: number,
  updates: { caption?: string; tags?: string[] },
): Promise<void> {
  const db = getDb();
  const setClauses: string[] = [];
  const params: Record<string, unknown> = { id: imageId };

  if (updates.caption !== undefined) {
    setClauses.push('caption = $caption');
    params.caption = updates.caption;
  }
  if (updates.tags !== undefined) {
    setClauses.push('tags = $tags');
    params.tags = JSON.stringify(updates.tags);
  }

  if (setClauses.length === 0) return;
  await db.execute(`UPDATE pet_images SET ${setClauses.join(', ')} WHERE id = $id`, params);
}

/**
 * Get image count for a pet (for badges/display).
 */
export async function getImageCount(petId: number): Promise<number> {
  const db = getDb();
  const rows = await db.select<{ cnt: number }[]>('SELECT COUNT(*) as cnt FROM pet_images WHERE pet_id = $pet_id', {
    pet_id: petId,
  });
  return rows[0]?.cnt ?? 0;
}
