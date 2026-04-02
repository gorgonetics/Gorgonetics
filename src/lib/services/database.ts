/**
 * Database layer for Gorgonetics.
 * Uses tauri-plugin-sql (SQLite) in the native app.
 * Falls back to an in-memory store when running outside Tauri (e.g., Playwright tests).
 */

let db: DatabaseAdapter | null = null;

interface QueryResult {
  rowsAffected: number;
  lastInsertId: number;
}

interface DatabaseAdapter {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  execute(query: string, bindValues?: unknown[]): Promise<QueryResult>;
  close(): Promise<void>;
}

// --- In-memory adapter for non-Tauri contexts (tests, plain browser) ---

class InMemoryDatabase implements DatabaseAdapter {
  private tables: Record<string, Record<string, unknown>[]> = {};
  private autoIncrements: Record<string, number> = {};
  private userVersion = 0;

  async select<T>(query: string, bindValues: unknown[] = []): Promise<T> {
    // Normalize multi-line SQL to single line for regex matching
    const q = query.replace(/\s+/g, ' ').trim().toLowerCase();

    // PRAGMA user_version (read)
    if (q.includes('pragma user_version')) {
      return [{ user_version: this.userVersion }] as T;
    }

    // COUNT queries
    const countMatch = q.match(/select\s+count\(\*\)\s+as\s+(\w+)\s+from\s+(\w+)/i);
    if (countMatch) {
      const [, alias, table] = countMatch;
      const rows = this.getTable(table);
      const filtered = this.applyWhere(rows, q, bindValues);
      return [{ [alias]: filtered.length }] as T;
    }

    // SELECT DISTINCT column
    const distinctMatch = q.match(/select\s+distinct\s+(\w+)\s+from\s+(\w+)/i);
    if (distinctMatch) {
      const [, col, table] = distinctMatch;
      const rows = this.getTable(table);
      const filtered = this.applyWhere(rows, q, bindValues);
      const unique = [...new Set(filtered.map((r) => r[col]))].sort();
      return unique.map((v) => ({ [col]: v })) as T;
    }

    // SELECT * FROM table
    const selectMatch = q.match(/select\s+.+?\s+from\s+(\w+)/);
    if (selectMatch) {
      const table = selectMatch[1];
      const rows = this.getTable(table);
      let filtered = this.applyWhere(rows, q, bindValues);

      // ORDER BY
      const orderMatch = q.match(/order\s+by\s+(\w+)/);
      if (orderMatch) {
        const col = orderMatch[1];
        filtered.sort((a, b) => String(a[col] ?? '').localeCompare(String(b[col] ?? '')));
      }

      // LIMIT/OFFSET
      const limitMatch = q.match(/limit\s+(\?)\s+offset\s+(\?)/);
      if (limitMatch) {
        const whereParamCount = q.match(/where/i) ? q.split('?').length - 1 - 2 : 0;
        const limit = Number(bindValues[whereParamCount]);
        const offset = Number(bindValues[whereParamCount + 1]);
        filtered = filtered.slice(offset, offset + limit);
      }

      return filtered as T;
    }

    return [] as T;
  }

  async execute(query: string, bindValues: unknown[] = []): Promise<QueryResult> {
    const q = query.replace(/\s+/g, ' ').trim();
    const qLower = q.toLowerCase();

    // PRAGMA user_version = N (write)
    const pragmaMatch = qLower.match(/pragma\s+user_version\s*=\s*(\d+)/);
    if (pragmaMatch) {
      this.userVersion = Number.parseInt(pragmaMatch[1], 10);
      return { rowsAffected: 0, lastInsertId: 0 };
    }

    // CREATE TABLE
    if (qLower.startsWith('create table')) {
      const nameMatch = q.match(/create\s+table\s+if\s+not\s+exists\s+(\w+)/i) ?? q.match(/create\s+table\s+(\w+)/i);
      if (nameMatch) {
        const table = nameMatch[1].toLowerCase();
        if (!this.tables[table]) {
          this.tables[table] = [];
          this.autoIncrements[table] = 0;
        }
      }
      return { rowsAffected: 0, lastInsertId: 0 };
    }

    // INSERT
    if (qLower.startsWith('insert')) {
      const tableMatch = q.match(/insert\s+(?:or\s+replace\s+)?into\s+(\w+)\s*\(([^)]+)\)/i);
      if (tableMatch) {
        const table = tableMatch[1].toLowerCase();
        const cols = tableMatch[2].split(',').map((c) => c.trim());
        if (!this.tables[table]) {
          this.tables[table] = [];
          this.autoIncrements[table] = 0;
        }

        const row: Record<string, unknown> = {};
        let paramIdx = 0;
        for (const col of cols) {
          row[col] = bindValues[paramIdx++];
        }

        // Handle AUTOINCREMENT for 'id' column
        if (!row.id && cols.includes('id') === false) {
          this.autoIncrements[table]++;
          row.id = this.autoIncrements[table];
        } else if (row.id) {
          const idNum = Number(row.id);
          if (idNum > this.autoIncrements[table]) {
            this.autoIncrements[table] = idNum;
          }
        } else {
          this.autoIncrements[table]++;
          row.id = this.autoIncrements[table];
        }

        // INSERT OR REPLACE — remove existing by primary key
        if (qLower.includes('or replace')) {
          const existingIdx = this.tables[table].findIndex(
            (r) => r.animal_type === row.animal_type && r.gene === row.gene,
          );
          if (existingIdx >= 0) {
            this.tables[table][existingIdx] = row;
            return { rowsAffected: 1, lastInsertId: Number(row.id) };
          }
        }

        this.tables[table].push(row);
        return { rowsAffected: 1, lastInsertId: Number(row.id) };
      }
    }

    // UPDATE
    if (qLower.startsWith('update')) {
      const tableMatch = q.match(/update\s+(\w+)\s+set/i);
      if (tableMatch) {
        const table = tableMatch[1].toLowerCase();
        const rows = this.getTable(table);

        // Parse SET clauses
        const setSection = q.match(/set\s+(.+?)\s+where/i);
        if (!setSection) return { rowsAffected: 0, lastInsertId: 0 };

        const setClauses = setSection[1].split(',').map((c) => c.trim());
        const setParamCount = setClauses.filter((c) => c.includes('?')).length;

        // Parse WHERE conditions
        const whereSection = q.match(/where\s+(.+)$/i);
        const whereParams = bindValues.slice(setParamCount);

        let affected = 0;
        for (const row of rows) {
          if (this.matchesWhere(row, whereSection?.[1] ?? '', whereParams)) {
            let paramIdx = 0;
            for (const clause of setClauses) {
              const [col] = clause.split('=').map((s) => s.trim());
              if (clause.includes('?')) {
                row[col] = bindValues[paramIdx++];
              }
            }
            affected++;
          }
        }
        return { rowsAffected: affected, lastInsertId: 0 };
      }
    }

    // DELETE
    if (qLower.startsWith('delete')) {
      const tableMatch = q.match(/delete\s+from\s+(\w+)/i);
      if (tableMatch) {
        const table = tableMatch[1].toLowerCase();
        const rows = this.getTable(table);
        const before = rows.length;
        this.tables[table] = rows.filter((r) => !this.matchesWhere(r, qLower.split('where')[1] ?? '', bindValues));
        return { rowsAffected: before - this.tables[table].length, lastInsertId: 0 };
      }
    }

    return { rowsAffected: 0, lastInsertId: 0 };
  }

  async close(): Promise<void> {
    this.tables = {};
  }

  private getTable(name: string): Record<string, unknown>[] {
    return this.tables[name.toLowerCase()] ?? [];
  }

  private applyWhere(rows: Record<string, unknown>[], query: string, params: unknown[]): Record<string, unknown>[] {
    const whereMatch = query.match(/where\s+(.+?)(?:\s+order|\s+limit|\s*$)/i);
    if (!whereMatch) return [...rows];
    return rows.filter((r) => this.matchesWhere(r, whereMatch[1], params));
  }

  private matchesWhere(row: Record<string, unknown>, whereClause: string, params: unknown[]): boolean {
    if (!whereClause?.trim()) return true;

    const conditions = whereClause.split(/\s+and\s+/i);
    let paramIdx = 0;
    for (const cond of conditions) {
      const match = cond.trim().match(/(\w+)\s*=\s*\?/);
      if (match) {
        const col = match[1];
        if (String(row[col]) !== String(params[paramIdx])) return false;
        paramIdx++;
      }
    }
    return true;
  }
}

// --- Detect Tauri context ---

function isTauri(): boolean {
  try {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  } catch {
    return false;
  }
}

/**
 * Initialize the database, using SQLite in Tauri or in-memory fallback otherwise.
 */
export async function initDatabase(): Promise<void> {
  if (db) return;

  if (isTauri()) {
    const { default: Database } = await import('@tauri-apps/plugin-sql');
    db = (await Database.load('sqlite:gorgonetics.db')) as unknown as DatabaseAdapter;
  } else {
    console.warn('Not running in Tauri — using in-memory database (test mode)');
    db = new InMemoryDatabase();
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS genes (
      animal_type TEXT NOT NULL,
      chromosome TEXT NOT NULL,
      gene TEXT NOT NULL,
      effectDominant TEXT DEFAULT 'None',
      effectRecessive TEXT DEFAULT 'None',
      appearance TEXT DEFAULT 'None',
      breed TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT,
      updated_at TEXT,
      PRIMARY KEY (animal_type, gene)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS pets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      species TEXT NOT NULL,
      gender TEXT NOT NULL DEFAULT 'Male',
      breed TEXT,
      breeder TEXT,
      content_hash TEXT NOT NULL UNIQUE,
      genome_data TEXT NOT NULL,
      notes TEXT DEFAULT '',
      created_at TEXT,
      updated_at TEXT,
      intelligence INTEGER DEFAULT 50,
      toughness INTEGER DEFAULT 50,
      friendliness INTEGER DEFAULT 50,
      ruggedness INTEGER DEFAULT 50,
      enthusiasm INTEGER DEFAULT 50,
      virility INTEGER DEFAULT 50,
      ferocity INTEGER DEFAULT 50,
      temperament INTEGER DEFAULT 50
    )
  `);
}

/**
 * Get the database instance. Throws if not initialized.
 */
export function getDb(): DatabaseAdapter {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

/**
 * Close the database connection.
 */
export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.close();
    db = null;
  }
}
