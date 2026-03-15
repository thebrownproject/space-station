import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getDb } from './connection.js';
import { nodes } from './schema.js';

export function runMigrations(): void {
  const db = getDb();
  migrate(db, { migrationsFolder: './drizzle' });
}

export function seedDefaults(): void {
  const count = getDb().select().from(nodes).limit(1).all();
  if (count.length > 0) return;
  // Default root spaces created by CLI or daemon, not here
}
