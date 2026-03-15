import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../schema.js';
import { _setDbForTesting } from '../connection.js';
import {
  slugify, parseNode,
  createNode, getNode, getNodeByPath, updateNode, deleteNode,
  listNodes, getChildren, getAncestors, getSubtree, searchNodes,
  type NodeRow,
} from '../queries.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DDL_PATH = join(__dirname, '..', '..', '..', 'drizzle', '0000_nosy_slyde.sql');

function setupTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const ddl = readFileSync(DDL_PATH, 'utf-8');
  // Split on statement-breakpoint comments and run each statement
  const statements = ddl.split('--> statement-breakpoint');
  for (const stmt of statements) {
    const trimmed = stmt.trim();
    if (trimmed) sqlite.exec(trimmed);
  }
  const db = drizzle({ client: sqlite, schema });
  _setDbForTesting(db);
  return { sqlite, db };
}

describe('queries', () => {
  let sqlite: InstanceType<typeof Database>;

  beforeEach(() => {
    const result = setupTestDb();
    sqlite = result.sqlite;
  });

  afterEach(() => {
    sqlite.close();
  });

  // -- slugify --

  describe('slugify', () => {
    test('converts title to lowercase kebab', () => {
      expect(slugify('Hello World')).toBe('hello-world');
    });

    test('strips special characters', () => {
      expect(slugify('Auth Bug #123!')).toBe('auth-bug-123');
    });

    test('trims leading/trailing hyphens', () => {
      expect(slugify('---hello---')).toBe('hello');
    });

    test('truncates to 60 chars', () => {
      const long = 'a'.repeat(100);
      expect(slugify(long).length).toBeLessThanOrEqual(60);
    });

    test('collapses multiple hyphens', () => {
      expect(slugify('foo   bar   baz')).toBe('foo-bar-baz');
    });
  });

  // -- parseNode --

  describe('parseNode', () => {
    test('deserializes tags and metadata JSON', () => {
      const row: NodeRow = {
        id: '1', parentId: null, type: 'task', title: 'Test',
        content: null, author: null, status: 'open', priority: null,
        assignee: null, tags: '["a","b"]', metadata: '{"x":1}',
        path: 'test', slug: 'test', depth: 0, childCount: 0,
        createdAt: '', updatedAt: '',
      };
      const node = parseNode(row);
      expect(node.tags).toEqual(['a', 'b']);
      expect(node.metadata).toEqual({ x: 1 });
    });

    test('handles empty tags/metadata', () => {
      const row: NodeRow = {
        id: '1', parentId: null, type: 'space', title: null,
        content: null, author: null, status: null, priority: null,
        assignee: null, tags: '', metadata: '',
        path: null, slug: null, depth: 0, childCount: 0,
        createdAt: '', updatedAt: '',
      };
      const node = parseNode(row);
      expect(node.tags).toEqual([]);
      expect(node.metadata).toEqual({});
    });
  });

  // -- createNode --

  describe('createNode', () => {
    test('creates a root node with generated slug and path', () => {
      const node = createNode({ type: 'space', title: 'Engineering' });
      expect(node.id).toBeDefined();
      expect(node.slug).toBe('engineering');
      expect(node.path).toBe('engineering');
      expect(node.depth).toBe(0);
      expect(node.parentId).toBeNull();
    });

    test('tasks default to status open', () => {
      const node = createNode({ type: 'task', title: 'Fix bug' });
      expect(node.status).toBe('open');
    });

    test('non-task nodes default to null status', () => {
      const node = createNode({ type: 'space', title: 'Eng' });
      expect(node.status).toBeNull();
    });

    test('creates child node with correct path and depth', () => {
      const parent = createNode({ type: 'space', title: 'Engineering' });
      const child = createNode({ type: 'post', title: 'Update', parentId: parent.id });
      expect(child.parentId).toBe(parent.id);
      expect(child.path).toBe('engineering/update');
      expect(child.depth).toBe(1);
    });

    test('increments parent childCount', () => {
      const parent = createNode({ type: 'space', title: 'Root' });
      createNode({ type: 'post', title: 'A', parentId: parent.id });
      createNode({ type: 'post', title: 'B', parentId: parent.id });
      const updated = getNode(parent.id)!;
      expect(updated.childCount).toBe(2);
    });

    test('resolves parent by path', () => {
      createNode({ type: 'space', title: 'Engineering' });
      const child = createNode({ type: 'task', title: 'Deploy', parentPath: 'engineering' });
      expect(child.path).toBe('engineering/deploy');
      expect(child.depth).toBe(1);
    });

    test('throws if parentId not found', () => {
      expect(() => createNode({ type: 'task', title: 'X', parentId: 'nonexistent' }))
        .toThrow('Parent node not found');
    });

    test('throws if parentPath not found', () => {
      expect(() => createNode({ type: 'task', title: 'X', parentPath: 'nope' }))
        .toThrow('Parent path not found');
    });

    test('stores tags and metadata', () => {
      const node = createNode({
        type: 'task', title: 'Tagged',
        tags: ['bug', 'urgent'],
        metadata: { sprint: 5 },
      });
      expect(node.tags).toEqual(['bug', 'urgent']);
      expect(node.metadata).toEqual({ sprint: 5 });
    });

    test('generates slug from id prefix when no title', () => {
      const node = createNode({ type: 'space' });
      expect(node.slug).toBeDefined();
      expect(node.slug!.length).toBeGreaterThan(0);
    });

    test('ensures unique slugs among siblings', () => {
      const a = createNode({ type: 'space', title: 'Alpha' });
      const b = createNode({ type: 'space', title: 'Alpha' });
      expect(a.slug).toBe('alpha');
      expect(b.slug).toBe('alpha-2');
      expect(b.path).toBe('alpha-2');
    });

    test('unique slug numbering increments', () => {
      createNode({ type: 'space', title: 'Beta' });
      createNode({ type: 'space', title: 'Beta' });
      const c = createNode({ type: 'space', title: 'Beta' });
      expect(c.slug).toBe('beta-3');
    });

    test('same slug allowed under different parents', () => {
      const p1 = createNode({ type: 'space', title: 'Parent One' });
      const p2 = createNode({ type: 'space', title: 'Parent Two' });
      const c1 = createNode({ type: 'task', title: 'Item', parentId: p1.id });
      const c2 = createNode({ type: 'task', title: 'Item', parentId: p2.id });
      expect(c1.slug).toBe('item');
      expect(c2.slug).toBe('item');
    });
  });

  // -- getNode / getNodeByPath --

  describe('getNode', () => {
    test('returns node by ID', () => {
      const created = createNode({ type: 'space', title: 'Lookup' });
      const found = getNode(created.id);
      expect(found).toBeDefined();
      expect(found!.title).toBe('Lookup');
    });

    test('returns undefined for missing ID', () => {
      expect(getNode('nonexistent')).toBeUndefined();
    });
  });

  describe('getNodeByPath', () => {
    test('returns node by path', () => {
      createNode({ type: 'space', title: 'My Space' });
      const found = getNodeByPath('my-space');
      expect(found).toBeDefined();
      expect(found!.title).toBe('My Space');
    });

    test('returns undefined for missing path', () => {
      expect(getNodeByPath('does/not/exist')).toBeUndefined();
    });
  });

  // -- updateNode --

  describe('updateNode', () => {
    test('updates title', () => {
      const node = createNode({ type: 'space', title: 'Old' });
      const updated = updateNode(node.id, { title: 'New' });
      expect(updated.title).toBe('New');
    });

    test('updates status and priority', () => {
      const node = createNode({ type: 'task', title: 'T' });
      const updated = updateNode(node.id, { status: 'done', priority: 'high' });
      expect(updated.status).toBe('done');
      expect(updated.priority).toBe('high');
    });

    test('merges metadata without overwriting', () => {
      const node = createNode({
        type: 'task', title: 'M',
        metadata: { a: 1, b: 2 },
      });
      const updated = updateNode(node.id, { metadata: { b: 99, c: 3 } });
      expect(updated.metadata).toEqual({ a: 1, b: 99, c: 3 });
    });

    test('replaces tags array', () => {
      const node = createNode({ type: 'task', title: 'T', tags: ['old'] });
      const updated = updateNode(node.id, { tags: ['new1', 'new2'] });
      expect(updated.tags).toEqual(['new1', 'new2']);
    });

    test('updates updatedAt timestamp', async () => {
      const node = createNode({ type: 'space', title: 'TS' });
      const before = node.updatedAt;
      await new Promise(r => setTimeout(r, 10));
      const updated = updateNode(node.id, { title: 'TS2' });
      expect(updated.updatedAt).not.toBe(before);
    });

    test('throws for nonexistent node', () => {
      expect(() => updateNode('missing', { title: 'X' }))
        .toThrow('Node not found');
    });

    test('does not update slug/path on title change', () => {
      const node = createNode({ type: 'space', title: 'Original' });
      const updated = updateNode(node.id, { title: 'Changed' });
      expect(updated.slug).toBe('original');
      expect(updated.path).toBe('original');
    });
  });

  // -- deleteNode --

  describe('deleteNode', () => {
    test('deletes existing node', () => {
      const node = createNode({ type: 'space', title: 'Gone' });
      expect(deleteNode(node.id)).toBe(true);
      expect(getNode(node.id)).toBeUndefined();
    });

    test('returns false for nonexistent node', () => {
      expect(deleteNode('nope')).toBe(false);
    });

    test('decrements parent childCount', () => {
      const parent = createNode({ type: 'space', title: 'Parent' });
      const child = createNode({ type: 'post', title: 'Child', parentId: parent.id });
      expect(getNode(parent.id)!.childCount).toBe(1);
      deleteNode(child.id);
      expect(getNode(parent.id)!.childCount).toBe(0);
    });

    test('cascade deletes children', () => {
      const parent = createNode({ type: 'space', title: 'P' });
      const child = createNode({ type: 'post', title: 'C', parentId: parent.id });
      const grandchild = createNode({ type: 'task', title: 'GC', parentId: child.id });
      deleteNode(parent.id);
      expect(getNode(child.id)).toBeUndefined();
      expect(getNode(grandchild.id)).toBeUndefined();
    });
  });

  // -- listNodes --

  describe('listNodes', () => {
    test('returns root nodes by default', () => {
      createNode({ type: 'space', title: 'Root1' });
      createNode({ type: 'space', title: 'Root2' });
      const parent = createNode({ type: 'space', title: 'Root3' });
      createNode({ type: 'post', title: 'Child', parentId: parent.id });

      const roots = listNodes();
      expect(roots.length).toBe(3);
    });

    test('filters by type', () => {
      createNode({ type: 'space', title: 'S' });
      createNode({ type: 'task', title: 'T' });
      createNode({ type: 'task', title: 'T2' });

      const tasks = listNodes({ type: 'task' });
      expect(tasks.length).toBe(2);
      expect(tasks.every(n => n.type === 'task')).toBe(true);
    });

    test('filters by status', () => {
      createNode({ type: 'task', title: 'A', status: 'open' });
      createNode({ type: 'task', title: 'B', status: 'done' });
      createNode({ type: 'task', title: 'C', status: 'open' });

      const open = listNodes({ status: 'open' });
      expect(open.length).toBe(2);
    });

    test('filters by author', () => {
      createNode({ type: 'post', title: 'A', author: 'alice' });
      createNode({ type: 'post', title: 'B', author: 'bob' });

      const alice = listNodes({ author: 'alice' });
      expect(alice.length).toBe(1);
      expect(alice[0].author).toBe('alice');
    });

    test('filters by assignee', () => {
      createNode({ type: 'task', title: 'A', assignee: 'alice' });
      createNode({ type: 'task', title: 'B', assignee: 'bob' });

      const bob = listNodes({ assignee: 'bob' });
      expect(bob.length).toBe(1);
    });

    test('filters by priority', () => {
      createNode({ type: 'task', title: 'L', priority: 'low' });
      createNode({ type: 'task', title: 'H', priority: 'high' });

      const high = listNodes({ priority: 'high' });
      expect(high.length).toBe(1);
      expect(high[0].priority).toBe('high');
    });

    test('filters by tags (match any)', () => {
      createNode({ type: 'task', title: 'A', tags: ['bug', 'urgent'] });
      createNode({ type: 'task', title: 'B', tags: ['feature'] });
      createNode({ type: 'task', title: 'C', tags: ['bug'] });

      const bugs = listNodes({ tags: ['bug'] });
      expect(bugs.length).toBe(2);
    });

    test('filters by parentId', () => {
      const parent = createNode({ type: 'space', title: 'P' });
      createNode({ type: 'post', title: 'C1', parentId: parent.id });
      createNode({ type: 'post', title: 'C2', parentId: parent.id });
      createNode({ type: 'space', title: 'Other' });

      const children = listNodes({ parentId: parent.id });
      expect(children.length).toBe(2);
    });

    test('filters by path (children at path)', () => {
      const parent = createNode({ type: 'space', title: 'Eng' });
      createNode({ type: 'post', title: 'P1', parentId: parent.id });
      createNode({ type: 'post', title: 'P2', parentId: parent.id });

      const children = listNodes({ path: 'eng' });
      expect(children.length).toBe(2);
    });

    test('returns empty for nonexistent path', () => {
      expect(listNodes({ path: 'nonexistent' })).toEqual([]);
    });

    test('search across title, content, tags', () => {
      createNode({ type: 'post', title: 'Auth Bug Report', content: 'Details here' });
      createNode({ type: 'post', title: 'Other', content: 'auth related issue' });
      createNode({ type: 'post', title: 'Unrelated', content: 'nothing' });

      const results = searchNodes('auth');
      expect(results.length).toBe(2);
    });

    test('pagination with limit and offset', () => {
      for (let i = 0; i < 10; i++) {
        createNode({ type: 'space', title: `Item ${i}` });
      }
      const page1 = listNodes({ limit: 3, offset: 0, depth: 0 });
      const page2 = listNodes({ limit: 3, offset: 3, depth: 0 });
      expect(page1.length).toBe(3);
      expect(page2.length).toBe(3);
      // Pages should not overlap
      const ids1 = page1.map(n => n.id);
      const ids2 = page2.map(n => n.id);
      expect(ids1.some(id => ids2.includes(id))).toBe(false);
    });

    test('sorts by created desc by default', () => {
      createNode({ type: 'space', title: 'First' });
      createNode({ type: 'space', title: 'Second' });
      createNode({ type: 'space', title: 'Third' });

      const nodes = listNodes();
      // desc order: newest first
      expect(nodes[0].title).toBe('Third');
    });

    test('sorts ascending when specified', () => {
      createNode({ type: 'space', title: 'C' });
      createNode({ type: 'space', title: 'A' });
      createNode({ type: 'space', title: 'B' });

      const nodes = listNodes({ orderBy: 'title', orderDir: 'asc' });
      expect(nodes[0].title).toBe('A');
      expect(nodes[1].title).toBe('B');
      expect(nodes[2].title).toBe('C');
    });

    test('filters by depth', () => {
      const root = createNode({ type: 'space', title: 'Root' });
      const child = createNode({ type: 'post', title: 'Child', parentId: root.id });
      createNode({ type: 'task', title: 'Grandchild', parentId: child.id });

      const depthOne = listNodes({ depth: 1 });
      expect(depthOne.length).toBe(1);
      expect(depthOne[0].title).toBe('Child');
    });
  });

  // -- getChildren --

  describe('getChildren', () => {
    test('returns direct children', () => {
      const parent = createNode({ type: 'space', title: 'Parent' });
      createNode({ type: 'post', title: 'A', parentId: parent.id });
      createNode({ type: 'post', title: 'B', parentId: parent.id });

      const children = getChildren(parent.id);
      expect(children.length).toBe(2);
    });

    test('does not return grandchildren', () => {
      const root = createNode({ type: 'space', title: 'Root' });
      const child = createNode({ type: 'post', title: 'Child', parentId: root.id });
      createNode({ type: 'task', title: 'Grandchild', parentId: child.id });

      const children = getChildren(root.id);
      expect(children.length).toBe(1);
      expect(children[0].title).toBe('Child');
    });
  });

  // -- getAncestors --

  describe('getAncestors', () => {
    test('returns full ancestor chain including self', () => {
      const root = createNode({ type: 'space', title: 'Root' });
      const mid = createNode({ type: 'space', title: 'Mid', parentId: root.id });
      const leaf = createNode({ type: 'task', title: 'Leaf', parentId: mid.id });

      const ancestors = getAncestors(leaf.id);
      expect(ancestors.length).toBe(3);
      expect(ancestors[0].title).toBe('Root');
      expect(ancestors[1].title).toBe('Mid');
      expect(ancestors[2].title).toBe('Leaf');
    });

    test('returns just self for root node', () => {
      const root = createNode({ type: 'space', title: 'Solo' });
      const ancestors = getAncestors(root.id);
      expect(ancestors.length).toBe(1);
      expect(ancestors[0].id).toBe(root.id);
    });

    test('returns empty for nonexistent node', () => {
      expect(getAncestors('nonexistent')).toEqual([]);
    });
  });

  // -- getSubtree --

  describe('getSubtree', () => {
    test('returns root and descendants', () => {
      const root = createNode({ type: 'space', title: 'Org' });
      const child = createNode({ type: 'space', title: 'Eng', parentId: root.id });
      createNode({ type: 'task', title: 'Task1', parentId: child.id });

      const tree = getSubtree(root.id);
      expect(tree.length).toBe(3);
      expect(tree[0].title).toBe('Org');
    });

    test('respects maxDepth', () => {
      const root = createNode({ type: 'space', title: 'R' });
      const c1 = createNode({ type: 'space', title: 'L1', parentId: root.id });
      const c2 = createNode({ type: 'space', title: 'L2', parentId: c1.id });
      createNode({ type: 'task', title: 'L3', parentId: c2.id });

      const tree = getSubtree(root.id, 1);
      // root (depth 0) + L1 (depth 1) only, not L2 (depth 2) or L3 (depth 3)
      expect(tree.length).toBe(2);
    });

    test('returns empty for nonexistent root', () => {
      expect(getSubtree('nonexistent')).toEqual([]);
    });

    test('subtree ordered by path', () => {
      const root = createNode({ type: 'space', title: 'R' });
      createNode({ type: 'space', title: 'B', parentId: root.id });
      createNode({ type: 'space', title: 'A', parentId: root.id });

      const tree = getSubtree(root.id);
      // root first, then children sorted by path
      expect(tree[0].title).toBe('R');
      expect(tree[1].title).toBe('A');
      expect(tree[2].title).toBe('B');
    });
  });

  // -- searchNodes --

  describe('searchNodes', () => {
    test('searches title', () => {
      createNode({ type: 'post', title: 'GraphQL API Design' });
      createNode({ type: 'post', title: 'REST API Patterns' });
      createNode({ type: 'post', title: 'Database Schema' });

      const results = searchNodes('API');
      expect(results.length).toBe(2);
    });

    test('searches content', () => {
      createNode({ type: 'post', title: 'Note', content: 'Contains secret keyword' });
      createNode({ type: 'post', title: 'Other', content: 'Nothing here' });

      const results = searchNodes('secret');
      expect(results.length).toBe(1);
    });

    test('searches tags', () => {
      createNode({ type: 'task', title: 'A', tags: ['deployment'] });
      createNode({ type: 'task', title: 'B', tags: ['testing'] });

      const results = searchNodes('deployment');
      expect(results.length).toBe(1);
    });

    test('respects limit', () => {
      for (let i = 0; i < 10; i++) {
        createNode({ type: 'post', title: `Match ${i}` });
      }
      const results = searchNodes('Match', 3);
      expect(results.length).toBe(3);
    });
  });

  // -- Edge cases --

  describe('edge cases', () => {
    test('deeply nested path construction', () => {
      const l0 = createNode({ type: 'space', title: 'L0' });
      const l1 = createNode({ type: 'space', title: 'L1', parentId: l0.id });
      const l2 = createNode({ type: 'space', title: 'L2', parentId: l1.id });
      const l3 = createNode({ type: 'task', title: 'L3', parentId: l2.id });

      expect(l3.path).toBe('l0/l1/l2/l3');
      expect(l3.depth).toBe(3);
    });

    test('childCount not negative after extra deletes', () => {
      const parent = createNode({ type: 'space', title: 'P' });
      const child = createNode({ type: 'post', title: 'C', parentId: parent.id });
      deleteNode(child.id);
      // childCount should be 0, not negative
      expect(getNode(parent.id)!.childCount).toBe(0);
    });
  });
});
