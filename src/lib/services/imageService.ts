/**
 * Pet image service for Gorgonetics.
 * Manages uploading, listing, and deleting pet screenshots.
 * Images are stored on the filesystem; metadata in the pet_images table.
 */

import type { PetImage } from '$lib/types/index.js';
import { isTauri } from '$lib/utils/environment.js';
import { getDb, reorderRows } from './database.js';
import { openFileDialog } from './fileService.js';

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
export function pickImageFiles(): Promise<string[]> {
  return openFileDialog('Select Pet Images', 'Images', ALLOWED_EXTENSIONS, true);
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
    const { readFile, writeFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs');

    // Read the source file (dialog-selected paths have temporary read access)
    const fileData = await readFile(sourcePath);
    if (fileData.byteLength > MAX_FILE_SIZE) {
      throw new Error(`Image too large (${Math.round(fileData.byteLength / 1024 / 1024)}MB). Maximum is 20MB.`);
    }

    // Create target directory using relative path + baseDir
    const relativeDir = `images/${petId}`;
    await mkdir(relativeDir, { baseDir: BaseDirectory.AppData, recursive: true });

    // Generate UUID filename and write using relative path + baseDir
    const uuid = crypto.randomUUID();
    const filename = `${uuid}.${ext}`;
    const relativePath = `${relativeDir}/${filename}`;
    await writeFile(relativePath, fileData, { baseDir: BaseDirectory.AppData });

    // Insert DB record — new images append after existing ones
    const db = getDb();
    const originalName = getBasename(sourcePath);
    const ts = now();
    // TODO: This queries all sort_orders per image, making bulk upload O(N*existing).
    // Fix by accepting an optional startOrder param or adding a batch uploadImages() that
    // queries once and increments locally. Not worth optimizing until galleries are large.
    const orderRows = await db.select<{ sort_order: number }[]>(
      'SELECT sort_order FROM pet_images WHERE pet_id = $pet_id',
      { pet_id: petId },
    );
    const nextOrder = orderRows.length > 0 ? Math.max(...orderRows.map((r) => r.sort_order ?? 0)) + 1 : 0;
    const result = await db.execute(
      `INSERT INTO pet_images (pet_id, filename, original_name, caption, tags, created_at, sort_order)
       VALUES ($pet_id, $filename, $original_name, $caption, $tags, $created_at, $sort_order)`,
      {
        pet_id: petId,
        filename,
        original_name: originalName,
        caption: '',
        tags: '[]',
        created_at: ts,
        sort_order: nextOrder,
      },
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
    'SELECT * FROM pet_images WHERE pet_id = $pet_id ORDER BY sort_order, created_at DESC',
    { pet_id: petId },
  );

  const images = rows.map(parseImage);

  if (isTauri()) {
    const urls = await Promise.all(images.map((img) => getImageUrl(img.pet_id, img.filename)));
    for (let i = 0; i < images.length; i++) {
      images[i].url = urls[i];
    }
  }

  return images;
}

/**
 * Resolve a displayable URL for an image file.
 * Uses Tauri's asset protocol — no file reading or blob URLs needed.
 */
async function getImageUrl(petId: number, filename: string): Promise<string> {
  if (!isTauri()) return '';
  const { appDataDir, join } = await import('@tauri-apps/api/path');
  const { convertFileSrc } = await import('@tauri-apps/api/core');
  const baseDir = await appDataDir();
  const fullPath = await join(baseDir, 'images', String(petId), filename);
  return convertFileSrc(fullPath);
}

/**
 * Delete a single image (file + DB record).
 */
export async function deleteImage(imageId: number, petId: number, filename: string): Promise<void> {
  if (isTauri()) {
    try {
      const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      await remove(`images/${petId}/${filename}`, { baseDir: BaseDirectory.AppData });
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
      const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      await remove(`images/${petId}`, { baseDir: BaseDirectory.AppData, recursive: true });
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

export async function getTotalImageCount(): Promise<number> {
  const db = getDb();
  const rows = await db.select<{ cnt: number }[]>('SELECT COUNT(*) as cnt FROM pet_images');
  return rows[0]?.cnt ?? 0;
}

/**
 * Update sort_order for a list of images based on their position in the array.
 */
export function reorderImages(orderedIds: number[]): Promise<void> {
  return reorderRows('pet_images', orderedIds);
}
