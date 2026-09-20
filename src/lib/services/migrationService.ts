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
      // effect doesn't target a real attribute (appearance, potential,
      // no-effect sentinels).
      await db.execute('ALTER TABLE genes ADD COLUMN dominant_attribute TEXT');
      await db.execute('ALTER TABLE genes ADD COLUMN dominant_sign TEXT');
      await db.execute('ALTER TABLE genes ADD COLUMN recessive_attribute TEXT');
      await db.execute('ALTER TABLE genes ADD COLUMN recessive_sign TEXT');

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
  {
    version: 11,
    description: 'Add total_genes/known_genes/unknown_genes columns to pets (backfilled in JS)',
    up: async () => {
      const db = getDb();
      await db.execute('ALTER TABLE pets ADD COLUMN total_genes INTEGER NOT NULL DEFAULT 0');
      await db.execute('ALTER TABLE pets ADD COLUMN known_genes INTEGER NOT NULL DEFAULT 0');
      await db.execute('ALTER TABLE pets ADD COLUMN unknown_genes INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    version: 12,
    description: 'Add imported_files table to skip already-seen files on auto-scan',
    up: async () => {
      const db = getDb();
      // Tracks every genome file ever ingested by content_hash. Survives
      // pet deletion so the auto-scanner doesn't re-import a file the
      // user already chose to discard.
      await db.execute(`
        CREATE TABLE IF NOT EXISTS imported_files (
          content_hash TEXT PRIMARY KEY,
          source_path TEXT,
          imported_at TEXT NOT NULL
        )
      `);
    },
  },
  {
    version: 13,
    description: 'Add genome_text column to pets — raw genome file text needed for community sharing',
    up: async () => {
      // The pre-existing genome_data column stores the JSON-stringified
      // parsed Genome (lossy w.r.t. the original whitespace/line-endings),
      // so its SHA-256 does not equal pets.content_hash. The community
      // share path needs to upload the original raw text whose hash IS
      // content_hash. Going forward, petService.uploadPet writes the raw
      // text here; legacy rows have genome_text='' and their Share button
      // is disabled until the user re-imports the file.
      const db = getDb();
      await db.execute("ALTER TABLE pets ADD COLUMN genome_text TEXT NOT NULL DEFAULT ''");
    },
  },
  {
    version: 14,
    description: 'Add study_corpus — community genomes cached for the genetic study, kept out of pets',
    up: async () => {
      // The study learns from animals; the roster holds animals the player
      // owns. Community entries are evidence, not property, so they get
      // their own table rather than being imported: My Pets and the
      // breeding pool stay exactly as the player left them.
      //
      // The genome is stored as raw text, not projected into per-locus rows
      // the way `pet_genes` is. A few hundred community animals would be
      // most of a million rows, and the study parses the whole corpus in
      // one pass anyway — the projection would cost far more than it saves.
      //
      // `content_hash` is the primary key, so re-fetching an entry the
      // cache already holds replaces it rather than duplicating, and a
      // community entry the player also owns locally can be recognised and
      // dropped (counting one animal twice would invent a disagreement
      // between it and itself).
      const db = getDb();
      await db.execute(`
        CREATE TABLE IF NOT EXISTS study_corpus (
          content_hash TEXT PRIMARY KEY,
          species      TEXT NOT NULL,
          breed        TEXT NOT NULL,
          name         TEXT NOT NULL,
          attributes   TEXT NOT NULL,
          genome_text  TEXT NOT NULL,
          fetched_at   TEXT NOT NULL
        )
      `);
      await db.execute('CREATE INDEX IF NOT EXISTS idx_study_corpus_species ON study_corpus(species)');
    },
  },
  {
    version: 15,
    description: 'Add gene_confirmations — slots the player has checked in game and found correct',
    up: async () => {
      // The study can say a gene's declared effect is disputed, but not who
      // is wrong: the hand-entered table, or an animal's recorded
      // attributes. Only the player can settle that, by looking in the game.
      // Before this there was nowhere to put the answer, so the same handful
      // of genes were re-recommended after every trip — and the commoner
      // outcome, "the table was right", was the one the app could not record
      // at all.
      //
      // `attribute` and `sign` are stored, not just the slot, because a
      // confirmation is about a specific claim. If the gene is later edited
      // in Reference to declare something else, what was confirmed no longer
      // matches what is declared, and the confirmation is stale rather than
      // wrong — see `liveGeneConfirmations`.
      const db = getDb();
      await db.execute(`
        CREATE TABLE IF NOT EXISTS gene_confirmations (
          species      TEXT NOT NULL,
          gene         TEXT NOT NULL,
          expression   TEXT NOT NULL,
          attribute    TEXT NOT NULL,
          sign         INTEGER NOT NULL,
          confirmed_at TEXT NOT NULL,
          PRIMARY KEY (species, gene, expression)
        )
      `);
    },
  },
  {
    version: 16,
    description: 'Add use_for_studies to pets and study_corpus — exclude a mis-recorded animal from inference',
    up: async () => {
      // A failed prediction names two animals and the model forbids
      // disagreement, so one of them is wrong. On the live corpus twelve
      // animals out of 457 accounted for every failure, each producing a
      // constant offset across every equation it appeared in — the
      // fingerprint of one mis-typed attribute.
      //
      // A per-animal flag rather than a list of exclusions elsewhere: "do I
      // learn from this animal" is a property of the animal, it belongs
      // beside `stabled` and `starred`, and it stays visible and reversible
      // where the player already looks. Default on, so nothing changes for
      // an untouched database.
      //
      // Both tables, because the study learns from both, and 95% of the bad
      // records are community animals the player cannot re-read — excluding
      // is the only action available for them.
      const db = getDb();
      await db.execute('ALTER TABLE pets ADD COLUMN use_for_studies INTEGER NOT NULL DEFAULT 1');
      await db.execute('ALTER TABLE study_corpus ADD COLUMN use_for_studies INTEGER NOT NULL DEFAULT 1');
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
