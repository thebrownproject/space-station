import { getDb } from './connection.js';
import { sql } from 'drizzle-orm';
import { nodes } from './schema.js';

/**
 * Ensure the database schema exists.
 * Uses CREATE IF NOT EXISTS so it's safe to call multiple times.
 *
 * Note: We use direct DDL instead of drizzle-kit's migrator because
 * drizzle-orm 0.45.x has a bug where the internal __drizzle_migrations
 * table uses SERIAL (Postgres syntax) on SQLite.
 */
let _migrated = false;

export function runMigrations(): void {
  if (_migrated) return;
  const db = getDb();

  // Create tables and indexes one statement at a time
  // (drizzle's db.run() does not support multi-statement SQL)
  // All statements use IF NOT EXISTS so this is safe to call repeatedly.
  const statements = [
    `CREATE TABLE IF NOT EXISTS \`nodes\` (
      \`id\` text PRIMARY KEY NOT NULL,
      \`parent_id\` text,
      \`type\` text NOT NULL,
      \`title\` text,
      \`content\` text,
      \`author\` text,
      \`status\` text,
      \`priority\` text,
      \`assignee\` text,
      \`tags\` text DEFAULT '[]',
      \`metadata\` text DEFAULT '{}',
      \`path\` text,
      \`slug\` text,
      \`depth\` integer DEFAULT 0,
      \`child_count\` integer DEFAULT 0,
      \`created_at\` text NOT NULL,
      \`updated_at\` text NOT NULL,
      FOREIGN KEY (\`parent_id\`) REFERENCES \`nodes\`(\`id\`) ON UPDATE no action ON DELETE cascade
    )`,
    `CREATE INDEX IF NOT EXISTS \`idx_parent_id\` ON \`nodes\` (\`parent_id\`)`,
    `CREATE INDEX IF NOT EXISTS \`idx_type\` ON \`nodes\` (\`type\`)`,
    `CREATE INDEX IF NOT EXISTS \`idx_author\` ON \`nodes\` (\`author\`)`,
    `CREATE INDEX IF NOT EXISTS \`idx_status\` ON \`nodes\` (\`status\`)`,
    `CREATE INDEX IF NOT EXISTS \`idx_assignee\` ON \`nodes\` (\`assignee\`)`,
    `CREATE INDEX IF NOT EXISTS \`idx_path\` ON \`nodes\` (\`path\`)`,
    `CREATE INDEX IF NOT EXISTS \`idx_created_at\` ON \`nodes\` (\`created_at\`)`,
    `CREATE INDEX IF NOT EXISTS \`idx_depth\` ON \`nodes\` (\`depth\`)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS \`idx_parent_slug\` ON \`nodes\` (\`parent_id\`,\`slug\`)`,

    // Agent runs table (observability)
    `CREATE TABLE IF NOT EXISTS \`agent_runs\` (
      \`id\` text PRIMARY KEY NOT NULL,
      \`agent_name\` text NOT NULL,
      \`job_id\` text,
      \`trigger\` text NOT NULL,
      \`status\` text NOT NULL,
      \`prompt\` text,
      \`exit_code\` integer,
      \`duration_ms\` integer,
      \`error\` text,
      \`nodes_created\` integer DEFAULT 0,
      \`nodes_updated\` integer DEFAULT 0,
      \`started_at\` text NOT NULL,
      \`completed_at\` text
    )`,
    `CREATE INDEX IF NOT EXISTS \`idx_run_agent\` ON \`agent_runs\` (\`agent_name\`)`,
    `CREATE INDEX IF NOT EXISTS \`idx_run_status\` ON \`agent_runs\` (\`status\`)`,
    `CREATE INDEX IF NOT EXISTS \`idx_run_started\` ON \`agent_runs\` (\`started_at\`)`,
  ];

  for (const stmt of statements) {
    db.run(sql.raw(stmt));
  }
  _migrated = true;
}

export function seedDefaults(): void {
  const count = getDb().select().from(nodes).limit(1).all();
  if (count.length > 0) return;
}
