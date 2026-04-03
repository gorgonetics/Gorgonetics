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
