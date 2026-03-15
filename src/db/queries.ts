import { eq, and, like, or, desc, asc, isNull, sql } from 'drizzle-orm';
import { getDb } from './connection.js';
import { nodes, type NodeType, type NodeStatus, type NodePriority } from './schema.js';
import { v4 as uuid } from 'uuid';

export interface CreateNodeInput {
  type: NodeType;
  title?: string;
  content?: string;
  author?: string;
  parentId?: string;
  parentPath?: string;
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
  tags?: string[];
  priority?: NodePriority;
  parentId?: string;
  path?: string;
  search?: string;
  depth?: number;
  maxDepth?: number;
  limit?: number;
  offset?: number;
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
  tags: string;
  metadata: string;
  path: string | null;
  slug: string | null;
  depth: number;
  childCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Node extends Omit<NodeRow, 'tags' | 'metadata'> {
  tags: string[];
  metadata: Record<string, unknown>;
}

// -- Helpers --

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export function parseNode(row: NodeRow): Node {
  return {
    ...row,
    tags: JSON.parse(row.tags || '[]'),
    metadata: JSON.parse(row.metadata || '{}'),
  };
}

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

// -- CRUD --

export function createNode(input: CreateNodeInput): Node {
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

  const rawSlug = slugify(input.title ?? id.slice(0, 8));
  const slug = ensureUniqueSlug(parent?.id ?? null, rawSlug);

  const path = parent?.path ? `${parent.path}/${slug}` : slug;
  const depth = parent ? parent.depth + 1 : 0;

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

  if (parent) {
    db.update(nodes)
      .set({ childCount: parent.childCount + 1 })
      .where(eq(nodes.id, parent.id))
      .run();
  }

  return parseNode(row as NodeRow);
}

export function getNode(id: string): Node | undefined {
  const db = getDb();
  const row = db.select().from(nodes).where(eq(nodes.id, id)).get() as NodeRow | undefined;
  return row ? parseNode(row) : undefined;
}

export function getNodeByPath(path: string): Node | undefined {
  const db = getDb();
  const row = db.select().from(nodes).where(eq(nodes.path, path)).get() as NodeRow | undefined;
  return row ? parseNode(row) : undefined;
}

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
 * Move a node to a new parent. Updates path, depth, and childCounts
 * for both old and new parents, and recursively updates descendant paths.
 */
export function moveNode(id: string, newParentId: string | null): Node {
  const db = getDb();
  const existing = db.select().from(nodes).where(eq(nodes.id, id)).get() as NodeRow | undefined;
  if (!existing) throw new Error(`Node not found: ${id}`);

  // Resolve new parent
  let newParent: NodeRow | undefined;
  if (newParentId) {
    newParent = db.select().from(nodes).where(eq(nodes.id, newParentId)).get() as NodeRow | undefined;
    if (!newParent) throw new Error(`New parent not found: ${newParentId}`);
  }

  const oldPath = existing.path;
  const newSlug = ensureUniqueSlug(newParentId, existing.slug ?? existing.id.slice(0, 8));
  const newPath = newParent?.path ? `${newParent.path}/${newSlug}` : newSlug;
  const newDepth = newParent ? newParent.depth + 1 : 0;
  const now = new Date().toISOString();

  // Update the node itself
  db.update(nodes).set({
    parentId: newParentId,
    path: newPath,
    slug: newSlug,
    depth: newDepth,
    updatedAt: now,
  }).where(eq(nodes.id, id)).run();

  // Decrement old parent childCount
  if (existing.parentId) {
    const oldParent = db.select().from(nodes).where(eq(nodes.id, existing.parentId)).get() as NodeRow | undefined;
    if (oldParent) {
      db.update(nodes)
        .set({ childCount: Math.max(0, oldParent.childCount - 1) })
        .where(eq(nodes.id, existing.parentId))
        .run();
    }
  }

  // Increment new parent childCount
  if (newParent) {
    db.update(nodes)
      .set({ childCount: newParent.childCount + 1 })
      .where(eq(nodes.id, newParent.id))
      .run();
  }

  // Update all descendant paths
  if (oldPath) {
    const descendants = db.select().from(nodes)
      .where(like(nodes.path, `${oldPath}/%`))
      .all() as NodeRow[];
    for (const desc of descendants) {
      if (!desc.path) continue;
      const updatedPath = newPath + desc.path.slice(oldPath.length);
      const depthDiff = newDepth - existing.depth;
      db.update(nodes).set({
        path: updatedPath,
        depth: desc.depth + depthDiff,
      }).where(eq(nodes.id, desc.id)).run();
    }
  }

  const result = db.select().from(nodes).where(eq(nodes.id, id)).get() as NodeRow;
  return parseNode(result);
}

export function deleteNode(id: string): boolean {
  const db = getDb();
  const existing = db.select().from(nodes).where(eq(nodes.id, id)).get() as NodeRow | undefined;
  if (!existing) return false;

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

// -- Querying --

export function listNodes(filter?: NodeFilter): Node[] {
  const db = getDb();
  const conditions: any[] = [];

  if (filter?.parentId) conditions.push(eq(nodes.parentId, filter.parentId));
  if (filter?.path) {
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
    const tagConditions = filter.tags.map(tag => like(nodes.tags, `%"${tag}"%`));
    conditions.push(or(...tagConditions));
  }

  // Default to root nodes when no scoping filters given
  if (!filter?.parentId && !filter?.path && !filter?.search && !filter?.type &&
      !filter?.author && !filter?.assignee && !filter?.status && filter?.depth === undefined &&
      !filter?.priority && (!filter?.tags || filter.tags.length === 0)) {
    conditions.push(isNull(nodes.parentId));
  }

  const limit = filter?.limit ?? 50;
  const offset = filter?.offset ?? 0;

  let orderCol: any = nodes.createdAt;
  if (filter?.orderBy === 'updated') orderCol = nodes.updatedAt;
  if (filter?.orderBy === 'title') orderCol = nodes.title;
  if (filter?.orderBy === 'priority') orderCol = nodes.priority;
  const orderFn = filter?.orderDir === 'asc' ? asc : desc;

  let query = db.select().from(nodes);
  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }
  const rows = query.orderBy(orderFn(orderCol)).limit(limit).offset(offset).all() as NodeRow[];

  return rows.map(parseNode);
}

export function getChildren(parentId: string): Node[] {
  return listNodes({ parentId });
}

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

export function getSubtree(rootId: string, maxDepth: number = 3): Node[] {
  const db = getDb();
  const root = db.select().from(nodes).where(eq(nodes.id, rootId)).get() as NodeRow | undefined;
  if (!root) return [];

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

export function searchNodes(query: string, limit: number = 20): Node[] {
  return listNodes({ search: query, limit });
}
