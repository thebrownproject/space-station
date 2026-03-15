import { sqliteTable, text, integer, index, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

export const nodes = sqliteTable('nodes', {
  id: text('id').primaryKey(),
  parentId: text('parent_id').references((): AnySQLiteColumn => nodes.id, { onDelete: 'cascade' }),
  type: text('type', {
    enum: ['space', 'post', 'task', 'page', 'comment', 'report'],
  }).notNull(),
  title: text('title'),
  content: text('content'),
  author: text('author'),
  status: text('status', {
    enum: ['open', 'in-progress', 'review', 'done', 'closed'],
  }),
  priority: text('priority', {
    enum: ['low', 'medium', 'high', 'critical'],
  }),
  assignee: text('assignee'),
  tags: text('tags').default('[]'),
  metadata: text('metadata').default('{}'),
  path: text('path'),
  slug: text('slug'),
  depth: integer('depth').default(0),
  childCount: integer('child_count').default(0),
  createdAt: text('created_at').notNull(),
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

export type NodeType = 'space' | 'post' | 'task' | 'page' | 'comment' | 'report';
export type NodeStatus = 'open' | 'in-progress' | 'review' | 'done' | 'closed';
export type NodePriority = 'low' | 'medium' | 'high' | 'critical';
