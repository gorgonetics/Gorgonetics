/**
 * User settings service for Gorgonetics.
 * Key-value store backed by the settings SQLite table.
 * Each setting has a typed default; missing keys fall back to defaults.
 */

import { getDb } from './database.js';

const SETTING_DEFAULTS: Record<string, unknown> = {
  'horse.autoSelectBreedFilter': true,
};

function now(): string {
  return new Date().toISOString();
}

export function getDefaultSettings(): Record<string, unknown> {
  return { ...SETTING_DEFAULTS };
}

export async function getSetting<T = unknown>(key: string): Promise<T> {
  const db = getDb();
  const rows = await db.select<{ value: string }[]>('SELECT value FROM settings WHERE key = $key', { key });
  if (rows.length === 0) {
    return SETTING_DEFAULTS[key] as T;
  }
  try {
    return JSON.parse(rows[0].value) as T;
  } catch {
    return rows[0].value as T;
  }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = getDb();
  const serialized = JSON.stringify(value);
  const ts = now();
  await db.execute('DELETE FROM settings WHERE key = $key', { key });
  await db.execute('INSERT INTO settings (key, value, updated_at) VALUES ($key, $value, $updated_at)', {
    key,
    value: serialized,
    updated_at: ts,
  });
}

export async function getAllSettings(): Promise<Record<string, unknown>> {
  const db = getDb();
  const rows = await db.select<{ key: string; value: string }[]>('SELECT key, value FROM settings');
  const result = { ...SETTING_DEFAULTS };
  for (const row of rows) {
    try {
      result[row.key] = JSON.parse(row.value);
    } catch {
      result[row.key] = row.value;
    }
  }
  return result;
}

export async function resetSetting(key: string): Promise<void> {
  const db = getDb();
  await db.execute('DELETE FROM settings WHERE key = $key', { key });
}
