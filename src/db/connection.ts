import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { join, dirname } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import * as schema from './schema.js';

let db: ReturnType<typeof drizzle> | null = null;
let sqliteInstance: InstanceType<typeof Database> | null = null;

/**
 * Get or create the database connection.
 *
 * Resolution order:
 * 1. AGENTBUS_DB env var (absolute path to .db file)
 * 2. Walk up from cwd looking for data/agentbus.db
 * 3. ~/.agentbus/agentbus.db (fallback)
 */
export function getDb(): ReturnType<typeof drizzle> {
  if (db) return db;

  const dbPath = resolveDbPath();
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  sqliteInstance = sqlite;
  db = drizzle({ client: sqlite, schema });
  return db;
}

export function resolveDbPath(): string {
  if (process.env.AGENTBUS_DB) return process.env.AGENTBUS_DB;

  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    const candidate = join(dir, 'data', 'agentbus.db');
    if (existsSync(join(dir, 'data'))) return candidate;
    if (existsSync(join(dir, 'package.json'))) return join(dir, 'data', 'agentbus.db');
    dir = dirname(dir);
  }

  const home = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp';
  return join(home, '.agentbus', 'agentbus.db');
}

export function closeDb(): void {
  if (sqliteInstance) {
    sqliteInstance.close();
    sqliteInstance = null;
  }
  db = null;
}
