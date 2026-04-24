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
  {
    version: 5,
    description: 'Add sort_order column and pet_id index to pet_images',
    up: async () => {
      const db = getDb();
      await db.execute('ALTER TABLE pet_images ADD COLUMN sort_order INTEGER DEFAULT 0');
      await db.execute('CREATE INDEX IF NOT EXISTS idx_pet_images_pet_id ON pet_images(pet_id)');
    },
  },
  {
    version: 6,
    description: 'Add tags column to pets for user-defined labels',
    up: async () => {
      const db = getDb();
      await db.execute("ALTER TABLE pets ADD COLUMN tags TEXT DEFAULT '[]'");
    },
  },
  {
    version: 7,
    description: 'Migrate pet tags from JSON column to junction table',
    up: async () => {
      const db = getDb();
      await db.execute(`
        CREATE TABLE IF NOT EXISTS pet_tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pet_id INTEGER NOT NULL,
          tag TEXT NOT NULL,
          UNIQUE(pet_id, tag),
          FOREIGN KEY (pet_id) REFERENCES pets(id) ON DELETE CASCADE
        )
      `);
      await db.execute('CREATE INDEX IF NOT EXISTS idx_pet_tags_tag ON pet_tags(tag)');
      await db.execute('CREATE INDEX IF NOT EXISTS idx_pet_tags_pet_id ON pet_tags(pet_id)');

      // Migrate existing JSON tags into junction table
      const rows = await db.select<{ id: number; tags: string }[]>(
        "SELECT id, tags FROM pets WHERE tags IS NOT NULL AND tags != '[]'",
      );
      for (const row of rows) {
        try {
          const tags = JSON.parse(row.tags);
          if (Array.isArray(tags)) {
            for (const tag of tags) {
              if (typeof tag === 'string' && tag.trim()) {
                await db.execute('INSERT OR IGNORE INTO pet_tags (pet_id, tag) VALUES ($pet_id, $tag)', {
                  pet_id: row.id,
                  tag: tag.trim().toLowerCase(),
                });
              }
            }
          }
        } catch {
          // Skip rows with invalid JSON
        }
      }
    },
  },
  {
    version: 8,
    description: 'Add starred, stabled, is_pet_quality flags to pets',
    up: async () => {
      const db = getDb();
      await db.execute('ALTER TABLE pets ADD COLUMN starred INTEGER NOT NULL DEFAULT 0');
      await db.execute('ALTER TABLE pets ADD COLUMN stabled INTEGER NOT NULL DEFAULT 1');
      await db.execute('ALTER TABLE pets ADD COLUMN is_pet_quality INTEGER NOT NULL DEFAULT 0');
      // Existing rows default to stabled=1 via column DEFAULT — the default view
      // would otherwise be empty for users upgrading with a populated database.
    },
  },
  {
    version: 9,
    description: 'Add positive_genes column to pets (backfilled in JS after migrations run)',
    up: async () => {
      const db = getDb();
      await db.execute('ALTER TABLE pets ADD COLUMN positive_genes INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    version: 10,
    description: 'Add parsed-effect columns to genes + pet_genes table for fast SQL-side stats',
    up: async () => {
      const db = getDb();
      // Pre-parsed attribute + sign per effect direction. NULL means the
      // effect is absent or doesn't target a real attribute (appearance,
      // potential, no-effect sentinels).
      await db.execute('ALTER TABLE genes ADD COLUMN dominant_attribute TEXT');
      await db.execute('ALTER TABLE genes ADD COLUMN dominant_sign TEXT');
      await db.execute('ALTER TABLE genes ADD COLUMN recessive_attribute TEXT');
      await db.execute('ALTER TABLE genes ADD COLUMN recessive_sign TEXT');

      // One row per (pet, gene position) — the pet's genome projected into
      // queryable rows. Populated in a later migration step; M1 only creates
      // the table so subsequent PRs can write into it without another ALTER.
      await db.execute(`
        CREATE TABLE IF NOT EXISTS pet_genes (
          pet_id    INTEGER NOT NULL,
          gene_id   TEXT    NOT NULL,
          gene_type TEXT    NOT NULL,
          PRIMARY KEY (pet_id, gene_id),
          FOREIGN KEY (pet_id) REFERENCES pets(id) ON DELETE CASCADE
        )
      `);
      await db.execute('CREATE INDEX IF NOT EXISTS idx_pet_genes_pet ON pet_genes(pet_id)');
      await db.execute('CREATE INDEX IF NOT EXISTS idx_pet_genes_lookup ON pet_genes(gene_id, gene_type)');
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
