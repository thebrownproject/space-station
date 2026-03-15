import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { eq, and, like, or, desc, asc, isNull, sql } from "drizzle-orm";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

// Schema (mirrors src/db/schema.ts)
export const nodes = sqliteTable("nodes", {
  id: text("id").primaryKey(),
  parentId: text("parent_id").references((): AnySQLiteColumn => nodes.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["space", "post", "task", "page", "comment", "report"] }).notNull(),
  title: text("title"),
  content: text("content"),
  author: text("author"),
  status: text("status", { enum: ["open", "in-progress", "review", "done", "closed"] }),
  priority: text("priority", { enum: ["low", "medium", "high", "critical"] }),
  assignee: text("assignee"),
  tags: text("tags").default("[]"),
  metadata: text("metadata").default("{}"),
  path: text("path"),
  slug: text("slug"),
  depth: integer("depth").default(0),
  childCount: integer("child_count").default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("idx_parent_id").on(table.parentId),
  index("idx_type").on(table.type),
  index("idx_author").on(table.author),
  index("idx_status").on(table.status),
  index("idx_path").on(table.path),
]);

export type NodeType = "space" | "post" | "task" | "page" | "comment" | "report";
export type NodeStatus = "open" | "in-progress" | "review" | "done" | "closed";
export type NodePriority = "low" | "medium" | "high" | "critical";

export interface NodeData {
  id: string;
  parentId: string | null;
  type: NodeType;
  title: string | null;
  content: string | null;
  author: string | null;
  status: NodeStatus | null;
  priority: NodePriority | null;
  assignee: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  path: string | null;
  slug: string | null;
  depth: number;
  childCount: number;
  createdAt: string;
  updatedAt: string;
}

function resolveDbPath(): string {
  if (process.env.AGENTBUS_DB) return process.env.AGENTBUS_DB;
  // Walk up from cwd to find data/ directory
  const { dirname } = require("node:path");
  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "data", "agentbus.db"))) return join(dir, "data", "agentbus.db");
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "data"))) return join(dir, "data", "agentbus.db");
    dir = dirname(dir);
  }
  // Fallback
  return join(process.cwd(), "..", "data", "agentbus.db");
}

let dbInstance: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (dbInstance) return dbInstance;
  const dbPath = resolveDbPath();
  const dir = join(dbPath, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  dbInstance = drizzle({ client: sqlite });
  return dbInstance;
}

function parseRow(row: any): NodeData {
  return {
    ...row,
    tags: JSON.parse(row.tags || "[]"),
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export function listNodes(filter?: {
  parentId?: string;
  type?: NodeType;
  status?: NodeStatus;
  author?: string;
  assignee?: string;
  search?: string;
  depth?: number;
  limit?: number;
}): NodeData[] {
  const db = getDb();
  const conditions: any[] = [];

  if (filter?.parentId) conditions.push(eq(nodes.parentId, filter.parentId));
  if (filter?.type) conditions.push(eq(nodes.type, filter.type));
  if (filter?.status) conditions.push(eq(nodes.status, filter.status));
  if (filter?.author) conditions.push(eq(nodes.author, filter.author));
  if (filter?.assignee) conditions.push(eq(nodes.assignee, filter.assignee));
  if (filter?.depth !== undefined) conditions.push(eq(nodes.depth, filter.depth));

  if (filter?.search) {
    const term = `%${filter.search}%`;
    conditions.push(or(like(nodes.title, term), like(nodes.content, term)));
  }

  // Default to root nodes when no scoping filters
  if (!filter?.parentId && !filter?.search && !filter?.type &&
      !filter?.author && !filter?.assignee && !filter?.status &&
      filter?.depth === undefined) {
    conditions.push(isNull(nodes.parentId));
  }

  const limit = filter?.limit ?? 50;
  let query = db.select().from(nodes);
  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }
  const rows = query.orderBy(desc(nodes.createdAt)).limit(limit).all();
  return rows.map(parseRow);
}

export function getNode(id: string): NodeData | undefined {
  const db = getDb();
  const row = db.select().from(nodes).where(eq(nodes.id, id)).get();
  return row ? parseRow(row) : undefined;
}

export function getNodeByPath(path: string): NodeData | undefined {
  const db = getDb();
  const row = db.select().from(nodes).where(eq(nodes.path, path)).get();
  return row ? parseRow(row) : undefined;
}

export function getChildren(parentId: string): NodeData[] {
  return listNodes({ parentId });
}

export function getSubtree(rootId: string, maxDepth: number = 3): NodeData[] {
  const db = getDb();
  const root = db.select().from(nodes).where(eq(nodes.id, rootId)).get();
  if (!root) return [];
  const parsed = parseRow(root);
  const pathPrefix = parsed.path ? `${parsed.path}/` : "";
  const maxAbsDepth = parsed.depth + maxDepth;
  const rows = db.select().from(nodes)
    .where(and(like(nodes.path, `${pathPrefix}%`), sql`${nodes.depth} <= ${maxAbsDepth}`))
    .orderBy(asc(nodes.path))
    .all();
  return [parsed, ...rows.map(parseRow)];
}

export function getStats() {
  const db = getDb();
  const rows = db.all<{ type: string; status: string | null; count: number }>(
    sql`SELECT type, status, COUNT(*) as count FROM nodes GROUP BY type, status`
  );
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    byType[row.type] = (byType[row.type] ?? 0) + row.count;
    if (row.status) byStatus[row.status] = (byStatus[row.status] ?? 0) + row.count;
    total += row.count;
  }
  return { total, byType, byStatus };
}
