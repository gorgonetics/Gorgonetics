/**
 * Database migration service for Gorgonetics.
 * Tracks schema version via SQLite PRAGMA user_version.
 * Runs pending migrations on startup.
 */

import { getDb } from './database.js';

interface Migration {
  version: number;
  description: string;
  up: () => Promise<void>;
}

/**
 * Ordered list of migrations.
 * v1 is the baseline (genes + pets tables created by initDatabase).
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Baseline schema: genes + pets tables',
    up: async () => {
      // No-op: tables are created by initDatabase()
    },
  },
  {
    version: 2,
    description: 'Add settings table for user preferences',
    up: async () => {
      const db = getDb();
      await db.execute(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT
        )
      `);
    },
  },
  {
    version: 3,
    description: 'Add pet_images table for pet screenshots',
    up: async () => {
      const db = getDb();
      await db.execute(`
        CREATE TABLE IF NOT EXISTS pet_images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pet_id INTEGER NOT NULL,
          filename TEXT NOT NULL,
          original_name TEXT NOT NULL,
          caption TEXT DEFAULT '',
          tags TEXT DEFAULT '[]',
          created_at TEXT NOT NULL,
          FOREIGN KEY (pet_id) REFERENCES pets(id) ON DELETE CASCADE
        )
      `);
    },
  },
  {
    version: 4,
    description: 'Add sort_order column to pets for drag-and-drop reordering',
    up: async () => {
      const db = getDb();
      await db.execute('ALTER TABLE pets ADD COLUMN sort_order INTEGER DEFAULT 0');
    },
  },
];

/** Derived from the last migration — no manual bookkeeping needed. */
export const CURRENT_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/**
 * Read the current schema version from the database.
 */
export async function getSchemaVersion(): Promise<number> {
  const db = getDb();
  const result = await db.select<{ user_version: number }[]>('PRAGMA user_version');
  return result[0]?.user_version ?? 0;
}

/**
 * Run all pending migrations and update the schema version.
 */
export async function runMigrations(): Promise<void> {
  const db = getDb();
  const currentVersion = await getSchemaVersion();

  const pending = MIGRATIONS.filter((m) => m.version > currentVersion);
  if (pending.length === 0) return;

  for (const migration of pending) {
    console.log(`Running migration v${migration.version}: ${migration.description}`);
    await migration.up();
    await db.execute(`PRAGMA user_version = ${migration.version}`);
  }

  console.log(`Database migrated to v${CURRENT_SCHEMA_VERSION}`);
}
