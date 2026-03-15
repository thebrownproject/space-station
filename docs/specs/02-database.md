# Spec 02: Database — Recursive Nodes

## Summary

A single `nodes` table storing all content in the system: spaces, posts, tasks, wiki pages, comments, and reports. Recursive via `parent_id`. SQLite for development, Postgres-ready via Drizzle ORM.

## Files to Create

```
src/db/
  schema.ts              # Drizzle table definitions
  queries.ts             # CRUD operations, tree queries, search
  migrate.ts             # Migration runner
  connection.ts          # Database connection + WAL mode setup
  index.ts               # Public exports
  __tests__/
    queries.test.ts

drizzle.config.ts        # Drizzle Kit configuration (migrations)
data/                    # SQLite database directory (gitignored)
  .gitkeep
```

## New Dependencies

```
drizzle-orm (^0.45.0)        — SQL ORM, supports SQLite + Postgres
better-sqlite3 (^12.0.0)    — SQLite driver for Node.js
@types/better-sqlite3        — TypeScript types
drizzle-kit (^0.31.0)       — Migration tooling (devDependency)
```

---

## Schema (`src/db/schema.ts`)

```typescript
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * The universal node type.
 * Every piece of content in the system is a node.
 */
export const nodes = sqliteTable('nodes', {
  /** UUID primary key */
  id: text('id').primaryKey(),

  /** Parent node ID. NULL = top-level (root space). */
  parentId: text('parent_id').references(() => nodes.id, { onDelete: 'cascade' }),

  /**
   * Node type:
   * - space: Container/category (like a subreddit or Slack channel)
   * - post: General content (discussion, announcement)
   * - task: Actionable item with status lifecycle
   * - page: Wiki/knowledge base article
   * - comment: Reply to any node
   * - report: Agent-generated summary/findings
   */
  type: text('type', {
    enum: ['space', 'post', 'task', 'page', 'comment', 'report'],
  }).notNull(),

  /** Display title (required for all types except comments) */
  title: text('title'),

  /** Markdown content body */
  content: text('content'),

  /** Author — agent name or human username */
  author: text('author'),

  /**
   * Status (primarily for tasks, but available on any node):
   * open → in-progress → review → done → closed
   */
  status: text('status', {
    enum: ['open', 'in-progress', 'review', 'done', 'closed'],
  }),

  /** Priority level */
  priority: text('priority', {
    enum: ['low', 'medium', 'high', 'critical'],
  }),

  /** Assigned agent or user (for tasks) */
  assignee: text('assignee'),

  /**
   * Tags as JSON array string: '["email","urgent","bug"]'
   * Stored as TEXT, parsed in application layer.
   */
  tags: text('tags').default('[]'),

  /**
   * Flexible metadata as JSON string.
   * Examples:
   *   space: { "github_url": "https://github.com/...", "icon": "🚀" }
   *   task: { "due_date": "2026-03-20", "estimate_hours": 4 }
   *   report: { "period": "daily", "metrics": {...} }
   */
  metadata: text('metadata').default('{}'),

  /**
   * Materialized path — slash-separated ancestor slugs.
   * Examples: "engineering", "engineering/space-station", "engineering/space-station/auth-bug"
   * Used for fast path-based lookups and tree queries.
   * Updated when nodes are created or moved.
   */
  path: text('path'),

  /**
   * URL-safe slug derived from title.
   * Unique among siblings (same parent_id).
   */
  slug: text('slug'),

  /** Depth in the tree (0 = root) */
  depth: integer('depth').default(0),

  /** Number of direct children (denormalized for display) */
  childCount: integer('child_count').default(0),

  /** ISO timestamp */
  createdAt: text('created_at').notNull(),

  /** ISO timestamp */
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_parent_id').on(table.parentId),
  index('idx_type').on(table.type),
  index('idx_author').on(table.author),
  index('idx_status').on(table.status),
  index('idx_assignee').on(table.assignee),
  index('idx_path').on(table.path),
  index('idx_created_at').on(table.createdAt),
  index('idx_depth').on(table.depth),
  uniqueIndex('idx_parent_slug').on(table.parentId, table.slug),
]);

/**
 * Node type union for TypeScript.
 */
export type NodeType = 'space' | 'post' | 'task' | 'page' | 'comment' | 'report';
export type NodeStatus = 'open' | 'in-progress' | 'review' | 'done' | 'closed';
export type NodePriority = 'low' | 'medium' | 'high' | 'critical';
```

---

## Connection (`src/db/connection.ts`)

```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { join, dirname } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import * as schema from './schema.js';

let db: ReturnType<typeof drizzle> | null = null;

/**
 * Get or create the database connection.
 *
 * Database location resolution order:
 * 1. AGENTBUS_DB env var (absolute path to .db file)
 * 2. Walk up from cwd looking for data/agentbus.db
 * 3. ~/.agentbus/agentbus.db (fallback)
 *
 * Always enables WAL mode for safe concurrent access
 * from CLI, daemon, and web UI.
 */
export function getDb(): ReturnType<typeof drizzle> {
  if (db) return db;

  const dbPath = resolveDbPath();
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');  // 5s retry on lock

  db = drizzle({ client: sqlite, schema });
  return db;
}

/**
 * Resolve the database file path.
 */
export function resolveDbPath(): string {
  // 1. Env var
  if (process.env.AGENTBUS_DB) return process.env.AGENTBUS_DB;

  // 2. Walk up from cwd
  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    const candidate = join(dir, 'data', 'agentbus.db');
    if (existsSync(join(dir, 'data'))) return candidate;
    // Also check for package.json (project root marker)
    if (existsSync(join(dir, 'package.json'))) return join(dir, 'data', 'agentbus.db');
    dir = dirname(dir);
  }

  // 3. Fallback
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp';
  return join(home, '.agentbus', 'agentbus.db');
}

/**
 * Close the database connection.
 */
export function closeDb(): void {
  // drizzle doesn't expose close directly — access the underlying sqlite instance
  db = null;
}
```

---

## Queries (`src/db/queries.ts`)

```typescript
import { eq, and, like, or, desc, asc, isNull, inArray, sql } from 'drizzle-orm';
import { getDb } from './connection.js';
import { nodes, type NodeType, type NodeStatus, type NodePriority } from './schema.js';
import { v4 as uuid } from 'uuid';

// ── Types ─────────────────────────────────────────────

export interface CreateNodeInput {
  type: NodeType;
  title?: string;
  content?: string;
  author?: string;
  parentId?: string;       // ID of parent node
  parentPath?: string;     // OR path of parent (e.g., "engineering/space-station")
  status?: NodeStatus;
  priority?: NodePriority;
  assignee?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateNodeInput {
  title?: string;
  content?: string;
  status?: NodeStatus;
  priority?: NodePriority;
  assignee?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface NodeFilter {
  type?: NodeType;
  status?: NodeStatus;
  author?: string;
  assignee?: string;
  tags?: string[];         // match any
  priority?: NodePriority;
  parentId?: string;       // direct children of this parent
  path?: string;           // direct children at this path
  search?: string;         // text search across title + content
  depth?: number;          // exact depth
  maxDepth?: number;       // nodes at or above this depth
  limit?: number;          // default: 50
  offset?: number;         // default: 0
  orderBy?: 'created' | 'updated' | 'title' | 'priority';
  orderDir?: 'asc' | 'desc';
}

export interface NodeRow {
  id: string;
  parentId: string | null;
  type: NodeType;
  title: string | null;
  content: string | null;
  author: string | null;
  status: NodeStatus | null;
  priority: NodePriority | null;
  assignee: string | null;
  tags: string;            // JSON array string
  metadata: string;        // JSON object string
  path: string | null;
  slug: string | null;
  depth: number;
  childCount: number;
  createdAt: string;
  updatedAt: string;
}

// Parsed version with JSON fields deserialized
export interface Node extends Omit<NodeRow, 'tags' | 'metadata'> {
  tags: string[];
  metadata: Record<string, unknown>;
}

// ── Helpers ───────────────────────────────────────────

/**
 * Generate a URL-safe slug from a title.
 * Ensures uniqueness among siblings by appending -N if needed.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/**
 * Parse a NodeRow into a Node (deserialize JSON fields).
 */
export function parseNode(row: NodeRow): Node {
  return {
    ...row,
    tags: JSON.parse(row.tags || '[]'),
    metadata: JSON.parse(row.metadata || '{}'),
  };
}

// ── CRUD Operations ───────────────────────────────────

/**
 * Create a new node.
 *
 * 1. Resolve parent (by ID or path)
 * 2. Generate slug from title
 * 3. Ensure slug is unique among siblings
 * 4. Compute path = parent.path + "/" + slug (or just slug if root)
 * 5. Compute depth = parent.depth + 1 (or 0 if root)
 * 6. Insert node
 * 7. Increment parent's childCount
 * 8. Return created node
 */
export async function createNode(input: CreateNodeInput): Promise<Node> {
  const db = getDb();
  const now = new Date().toISOString();
  const id = uuid();

  // Resolve parent
  let parent: NodeRow | undefined;
  if (input.parentId) {
    parent = db.select().from(nodes).where(eq(nodes.id, input.parentId)).get() as NodeRow | undefined;
    if (!parent) throw new Error(`Parent node not found: ${input.parentId}`);
  } else if (input.parentPath) {
    parent = db.select().from(nodes).where(eq(nodes.path, input.parentPath)).get() as NodeRow | undefined;
    if (!parent) throw new Error(`Parent path not found: ${input.parentPath}`);
  }

  // Generate slug
  const rawSlug = slugify(input.title ?? id.slice(0, 8));
  const slug = await ensureUniqueSlug(parent?.id ?? null, rawSlug);

  // Compute path and depth
  const path = parent?.path ? `${parent.path}/${slug}` : slug;
  const depth = parent ? parent.depth + 1 : 0;

  // Insert
  const row = {
    id,
    parentId: parent?.id ?? null,
    type: input.type,
    title: input.title ?? null,
    content: input.content ?? null,
    author: input.author ?? null,
    status: input.status ?? (input.type === 'task' ? 'open' : null),
    priority: input.priority ?? null,
    assignee: input.assignee ?? null,
    tags: JSON.stringify(input.tags ?? []),
    metadata: JSON.stringify(input.metadata ?? {}),
    path,
    slug,
    depth,
    childCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(nodes).values(row).run();

  // Increment parent childCount
  if (parent) {
    db.update(nodes)
      .set({ childCount: parent.childCount + 1 })
      .where(eq(nodes.id, parent.id))
      .run();
  }

  return parseNode(row as NodeRow);
}

/**
 * Get a node by ID.
 */
export function getNode(id: string): Node | undefined {
  const db = getDb();
  const row = db.select().from(nodes).where(eq(nodes.id, id)).get() as NodeRow | undefined;
  return row ? parseNode(row) : undefined;
}

/**
 * Get a node by path (e.g., "engineering/space-station").
 */
export function getNodeByPath(path: string): Node | undefined {
  const db = getDb();
  const row = db.select().from(nodes).where(eq(nodes.path, path)).get() as NodeRow | undefined;
  return row ? parseNode(row) : undefined;
}

/**
 * Update a node.
 */
export function updateNode(id: string, updates: UpdateNodeInput): Node {
  const db = getDb();
  const existing = db.select().from(nodes).where(eq(nodes.id, id)).get() as NodeRow | undefined;
  if (!existing) throw new Error(`Node not found: ${id}`);

  const now = new Date().toISOString();
  const set: Record<string, unknown> = { updatedAt: now };

  if (updates.title !== undefined) set.title = updates.title;
  if (updates.content !== undefined) set.content = updates.content;
  if (updates.status !== undefined) set.status = updates.status;
  if (updates.priority !== undefined) set.priority = updates.priority;
  if (updates.assignee !== undefined) set.assignee = updates.assignee;
  if (updates.tags !== undefined) set.tags = JSON.stringify(updates.tags);
  if (updates.metadata !== undefined) {
    const existingMeta = JSON.parse(existing.metadata || '{}');
    set.metadata = JSON.stringify({ ...existingMeta, ...updates.metadata });
  }

  db.update(nodes).set(set).where(eq(nodes.id, id)).run();

  const updated = db.select().from(nodes).where(eq(nodes.id, id)).get() as NodeRow;
  return parseNode(updated);
}

/**
 * Delete a node and all descendants (cascading via FK).
 */
export function deleteNode(id: string): boolean {
  const db = getDb();
  const existing = db.select().from(nodes).where(eq(nodes.id, id)).get() as NodeRow | undefined;
  if (!existing) return false;

  // Decrement parent childCount
  if (existing.parentId) {
    const parent = db.select().from(nodes).where(eq(nodes.id, existing.parentId)).get() as NodeRow | undefined;
    if (parent) {
      db.update(nodes)
        .set({ childCount: Math.max(0, parent.childCount - 1) })
        .where(eq(nodes.id, existing.parentId))
        .run();
    }
  }

  db.delete(nodes).where(eq(nodes.id, id)).run();
  return true;
}

// ── Querying ──────────────────────────────────────────

/**
 * List nodes with filtering, pagination, and sorting.
 */
export function listNodes(filter?: NodeFilter): Node[] {
  const db = getDb();
  const conditions: any[] = [];

  if (filter?.parentId) conditions.push(eq(nodes.parentId, filter.parentId));
  if (filter?.path) {
    // Get parent by path, then filter by parentId
    const parent = db.select().from(nodes).where(eq(nodes.path, filter.path)).get() as NodeRow | undefined;
    if (!parent) return [];
    conditions.push(eq(nodes.parentId, parent.id));
  }
  if (filter?.type) conditions.push(eq(nodes.type, filter.type));
  if (filter?.status) conditions.push(eq(nodes.status, filter.status));
  if (filter?.author) conditions.push(eq(nodes.author, filter.author));
  if (filter?.assignee) conditions.push(eq(nodes.assignee, filter.assignee));
  if (filter?.priority) conditions.push(eq(nodes.priority, filter.priority));
  if (filter?.depth !== undefined) conditions.push(eq(nodes.depth, filter.depth));

  if (filter?.search) {
    const term = `%${filter.search}%`;
    conditions.push(or(
      like(nodes.title, term),
      like(nodes.content, term),
      like(nodes.tags, term),
    ));
  }

  if (filter?.tags && filter.tags.length > 0) {
    // Match any tag — check if tags JSON contains the tag string
    const tagConditions = filter.tags.map(tag => like(nodes.tags, `%"${tag}"%`));
    conditions.push(or(...tagConditions));
  }

  // If no parent filter specified and no search/type filter, default to root nodes
  if (!filter?.parentId && !filter?.path && !filter?.search && !filter?.type &&
      !filter?.author && !filter?.assignee && !filter?.status && filter?.depth === undefined) {
    conditions.push(isNull(nodes.parentId));
  }

  const limit = filter?.limit ?? 50;
  const offset = filter?.offset ?? 0;

  // Build order
  let orderCol = nodes.createdAt;
  if (filter?.orderBy === 'updated') orderCol = nodes.updatedAt;
  if (filter?.orderBy === 'title') orderCol = nodes.title as any;
  const orderFn = filter?.orderDir === 'asc' ? asc : desc;

  let query = db.select().from(nodes);
  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }
  const rows = query.orderBy(orderFn(orderCol)).limit(limit).offset(offset).all() as NodeRow[];

  return rows.map(parseNode);
}

/**
 * Get all children of a node (direct children only).
 */
export function getChildren(parentId: string): Node[] {
  return listNodes({ parentId });
}

/**
 * Get the full ancestor chain for a node (breadcrumb).
 * Returns [root, ..., grandparent, parent, self].
 */
export function getAncestors(id: string): Node[] {
  const db = getDb();
  const result: Node[] = [];
  let current = db.select().from(nodes).where(eq(nodes.id, id)).get() as NodeRow | undefined;

  while (current) {
    result.unshift(parseNode(current));
    if (!current.parentId) break;
    current = db.select().from(nodes).where(eq(nodes.id, current.parentId)).get() as NodeRow | undefined;
  }

  return result;
}

/**
 * Get a subtree rooted at a node, up to maxDepth levels deep.
 * Returns flat array with depth info for tree rendering.
 */
export function getSubtree(rootId: string, maxDepth: number = 3): Node[] {
  const db = getDb();
  const root = db.select().from(nodes).where(eq(nodes.id, rootId)).get() as NodeRow | undefined;
  if (!root) return [];

  // Use path prefix matching for efficient subtree query
  const pathPrefix = root.path ? `${root.path}/` : '';
  const maxAbsDepth = root.depth + maxDepth;

  const rows = db.select().from(nodes)
    .where(and(
      like(nodes.path, `${pathPrefix}%`),
      sql`${nodes.depth} <= ${maxAbsDepth}`,
    ))
    .orderBy(asc(nodes.path))
    .all() as NodeRow[];

  return [parseNode(root), ...rows.map(parseNode)];
}

/**
 * Full-text search across title, content, and tags.
 */
export function searchNodes(query: string, limit: number = 20): Node[] {
  return listNodes({ search: query, limit });
}

// ── Slug Uniqueness ───────────────────────────────────

/**
 * Ensure slug is unique among siblings.
 * If "auth-bug" exists, try "auth-bug-2", "auth-bug-3", etc.
 */
function ensureUniqueSlug(parentId: string | null, baseSlug: string): string {
  const db = getDb();
  let slug = baseSlug;
  let counter = 2;

  while (true) {
    const condition = parentId
      ? and(eq(nodes.parentId, parentId), eq(nodes.slug, slug))
      : and(isNull(nodes.parentId), eq(nodes.slug, slug));

    const existing = db.select().from(nodes).where(condition).get();
    if (!existing) return slug;

    slug = `${baseSlug}-${counter}`;
    counter++;
  }
}
```

---

## Migration (`src/db/migrate.ts`)

```typescript
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getDb } from './connection.js';

/**
 * Run database migrations.
 * Creates tables if they don't exist.
 */
export function runMigrations(): void {
  const db = getDb();
  migrate(db, { migrationsFolder: './drizzle' });
}

/**
 * Initialize database with seed data (default spaces).
 */
export function seedDefaults(): void {
  // Only seed if no nodes exist
  const count = getDb().select().from(nodes).limit(1).all();
  if (count.length > 0) return;

  // Create default root spaces — user can customize later
  // These are just suggestions, not mandatory
}
```

---

## Drizzle Config (`drizzle.config.ts`)

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',                    // migration output directory
  dialect: 'sqlite',
  dbCredentials: {
    url: './data/agentbus.db',
  },
});
```

---

## Database Location

The database file resolution order (handled in `connection.ts`):

| Priority | Source | Path |
|----------|--------|------|
| 1 | `AGENTBUS_DB` env var | Whatever the var points to |
| 2 | Walk up from cwd | First `data/agentbus.db` found walking up to project root |
| 3 | Fallback | `~/.agentbus/agentbus.db` |

**Why this matters:** When the daemon spawns `claude -p` inside `agents/email-agent/`, the agent's cwd is the agent folder. The CLI must still find the database at the project root. The daemon sets `AGENTBUS_DB` in the subprocess environment to make this reliable.

---

## WAL Mode and Concurrent Access

SQLite WAL (Write-Ahead Logging) mode allows:
- Multiple concurrent readers (CLI, web UI, daemon)
- One writer at a time (with automatic retry via `busy_timeout`)
- No corruption risk from concurrent access

Enabled on every connection:
```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

---

## Postgres Migration Path

To switch from SQLite to Postgres later:

1. Change `drizzle.config.ts` dialect from `sqlite` to `postgresql`
2. Change `connection.ts` to use `drizzle-orm/node-postgres` instead of `better-sqlite3`
3. Re-generate migrations with `npx drizzle-kit generate`
4. The schema and queries remain identical — Drizzle abstracts the differences

The only SQLite-specific code is in `connection.ts` (the `Database` import and WAL pragma). Everything else is portable.

---

## Tests (`src/db/__tests__/queries.test.ts`)

```typescript
import { createNode, getNode, getNodeByPath, updateNode, deleteNode,
         listNodes, getChildren, getAncestors, getSubtree, searchNodes,
         slugify } from '../queries.js';

// Use in-memory SQLite for tests
// Override getDb() to return a fresh in-memory database

describe('slugify', () => {
  test('converts title to lowercase slug');
  test('replaces spaces with hyphens');
  test('removes special characters');
  test('trims leading/trailing hyphens');
  test('limits to 60 characters');
});

describe('createNode', () => {
  test('creates root space');
  test('creates child node with parentId');
  test('creates child node with parentPath');
  test('generates slug from title');
  test('ensures unique slug among siblings');
  test('computes path correctly (parent.path/slug)');
  test('computes depth correctly');
  test('increments parent childCount');
  test('defaults task status to open');
  test('stores tags as JSON array');
  test('stores metadata as JSON object');
  test('throws on non-existent parentId');
  test('throws on non-existent parentPath');
});

describe('getNode', () => {
  test('returns node by ID');
  test('returns undefined for non-existent ID');
  test('deserializes tags and metadata');
});

describe('getNodeByPath', () => {
  test('returns node by path');
  test('returns undefined for non-existent path');
});

describe('updateNode', () => {
  test('updates title');
  test('updates content');
  test('updates status');
  test('updates priority');
  test('updates assignee');
  test('updates tags');
  test('merges metadata (does not overwrite)');
  test('updates updatedAt timestamp');
  test('preserves unchanged fields');
  test('throws on non-existent node');
});

describe('deleteNode', () => {
  test('deletes node');
  test('cascades to children');
  test('decrements parent childCount');
  test('returns false for non-existent node');
});

describe('listNodes', () => {
  test('returns root nodes when no filter');
  test('filters by parentId');
  test('filters by path');
  test('filters by type');
  test('filters by status');
  test('filters by author');
  test('filters by assignee');
  test('filters by priority');
  test('filters by tags (any match)');
  test('text search across title and content');
  test('applies limit');
  test('applies offset');
  test('sorts by createdAt desc by default');
  test('sorts by title asc');
  test('combines multiple filters (AND logic)');
  test('returns empty array for no matches');
});

describe('getChildren', () => {
  test('returns direct children');
  test('returns empty for leaf node');
});

describe('getAncestors', () => {
  test('returns [root, ..., parent, self]');
  test('returns [self] for root node');
});

describe('getSubtree', () => {
  test('returns subtree up to maxDepth');
  test('respects maxDepth limit');
  test('returns empty for non-existent root');
  test('orders by path for consistent tree rendering');
});

describe('searchNodes', () => {
  test('finds by title');
  test('finds by content');
  test('case-insensitive');
  test('respects limit');
});
```

### Expected Test Count: ~45-50 tests

---

## Implementation Notes

### JSON Fields (tags, metadata)

SQLite doesn't have native JSON columns. We store JSON as TEXT and parse in the application layer. Drizzle handles this transparently. For search, we use `LIKE '%"tag"%'` which is sufficient for our scale.

If we move to Postgres later, we can use `jsonb` columns for native JSON querying.

### Materialized Path vs Closure Table

We use **materialized paths** (`path` column) for the tree structure. This is simpler than a closure table and sufficient for our query patterns:
- Fast: `WHERE path LIKE 'engineering/space-station/%'` for subtree queries
- Simple: path is human-readable, doubles as URL path
- Tradeoff: moving a node requires updating all descendant paths

For our use case (nodes rarely move, reads far outnumber writes), materialized paths are the right choice.

### childCount Denormalization

`childCount` is denormalized (incremented on insert, decremented on delete) to avoid `COUNT(*)` subqueries when listing nodes. This is critical for the CLI `spacestation node list` display where we show "3 children" next to each space.
