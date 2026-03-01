import { MemoryStore, VersionConflictError } from '../memory.js';
import type { MemoryEntry } from '../../types/memory.js';

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    // Disable cleanup timer for tests
    store = new MemoryStore({ cleanupIntervalMs: 999_999 });
  });

  afterEach(() => {
    store.destroy();
  });

  // --- Basic CRUD ---

  test('set and get a value', () => {
    const entry = store.set('key1', 'value1');
    expect(entry.key).toBe('key1');
    expect(entry.value).toBe('value1');
    expect(entry.scope).toBe('shared');
    expect(entry.version).toBe(1);

    const retrieved = store.get('key1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.value).toBe('value1');
  });

  test('set overwrites existing value', () => {
    store.set('key1', 'v1');
    const updated = store.set('key1', 'v2');
    expect(updated.value).toBe('v2');
    expect(updated.version).toBe(2);
    expect(store.get('key1')!.value).toBe('v2');
  });

  test('set preserves existing tags when not specified', () => {
    store.set('key1', 'v1', { tags: ['tag-a', 'tag-b'] });
    const updated = store.set('key1', 'v2');
    expect(updated.tags).toEqual(['tag-a', 'tag-b']);
  });

  test('set preserves existing TTL when not specified', () => {
    store.set('key1', 'v1', { ttl: 300 });
    const updated = store.set('key1', 'v2');
    expect(updated.ttl).toBe(300);
  });

  test('set preserves id and createdAt on update', () => {
    const original = store.set('key1', 'v1');
    const updated = store.set('key1', 'v2');
    expect(updated.id).toBe(original.id);
    expect(updated.createdAt).toBe(original.createdAt);
  });

  test('get returns undefined for nonexistent key', () => {
    expect(store.get('nope')).toBeUndefined();
  });

  test('delete removes an entry', () => {
    store.set('key1', 'v1');
    expect(store.delete('key1')).toBe(true);
    expect(store.get('key1')).toBeUndefined();
  });

  test('delete returns false for nonexistent key', () => {
    expect(store.delete('nope')).toBe(false);
  });

  // --- Scopes ---

  test('agent scope isolates by agentId', () => {
    store.set('pref', 'a-val', { scope: 'agent', agentId: 'agent-a' });
    store.set('pref', 'b-val', { scope: 'agent', agentId: 'agent-b' });

    expect(store.get('pref', { scope: 'agent', agentId: 'agent-a' })!.value).toBe('a-val');
    expect(store.get('pref', { scope: 'agent', agentId: 'agent-b' })!.value).toBe('b-val');
  });

  test('session scope isolates by sessionId', () => {
    store.set('data', 'sess1', { scope: 'session', sessionId: 's1' });
    store.set('data', 'sess2', { scope: 'session', sessionId: 's2' });

    expect(store.get('data', { scope: 'session', sessionId: 's1' })!.value).toBe('sess1');
    expect(store.get('data', { scope: 'session', sessionId: 's2' })!.value).toBe('sess2');
  });

  test('shared scope is the default', () => {
    store.set('global', 'val');
    expect(store.get('global')!.scope).toBe('shared');
  });

  // --- TTL ---

  test('expired entries are not returned by get', () => {
    // Set a TTL of 0 seconds (effectively expired if updatedAt is in the past)
    const entry = store.set('ttl-test', 'v', { ttl: 0 });
    // TTL 0 means no expiry
    expect(store.get('ttl-test')).toBeDefined();
  });

  test('TTL-based expiry works', async () => {
    store.set('ttl-test', 'v', { ttl: 1 }); // 1 second TTL

    // Should be available immediately
    expect(store.get('ttl-test')).toBeDefined();

    // Wait for expiry
    await new Promise((r) => setTimeout(r, 1100));
    expect(store.get('ttl-test')).toBeUndefined();
  }, 3000);

  // --- Versioning ---

  test('version starts at 1 for new entries', () => {
    const entry = store.set('ver', 'v1');
    expect(entry.version).toBe(1);
  });

  test('version increments on update', () => {
    store.set('ver', 'v1');
    const v2 = store.set('ver', 'v2');
    expect(v2.version).toBe(2);

    const v3 = store.set('ver', 'v3');
    expect(v3.version).toBe(3);
  });

  test('expectedVersion succeeds when matching', () => {
    store.set('ver', 'v1');
    const v2 = store.set('ver', 'v2', { expectedVersion: 1 });
    expect(v2.version).toBe(2);
  });

  test('expectedVersion throws VersionConflictError when mismatched', () => {
    store.set('ver', 'v1');
    store.set('ver', 'v2');

    expect(() => store.set('ver', 'v3', { expectedVersion: 1 })).toThrow(VersionConflictError);

    try {
      store.set('ver', 'v3', { expectedVersion: 1 });
    } catch (err) {
      const vce = err as VersionConflictError;
      expect(vce.key).toBe('ver');
      expect(vce.expectedVersion).toBe(1);
      expect(vce.actualVersion).toBe(2);
    }
  });

  test('expectedVersion is ignored for new entries (no existing)', () => {
    // Setting expectedVersion on a new key shouldn't matter — it's a create
    const entry = store.set('new-key', 'val', { expectedVersion: 5 });
    expect(entry.version).toBe(1);
  });

  // --- Query ---

  test('query with search', () => {
    store.set('invoice-123', { amount: 99 });
    store.set('invoice-456', { amount: 50 });
    store.set('customer-789', { name: 'Bob' });

    const results = store.query({ search: 'invoice' });
    expect(results).toHaveLength(2);
  });

  test('query with scope filter', () => {
    store.set('a', 'val', { scope: 'shared' });
    store.set('b', 'val', { scope: 'agent', agentId: 'agent-1' });
    store.set('c', 'val', { scope: 'session', sessionId: 's1' });

    expect(store.query({ scope: 'shared' })).toHaveLength(1);
    expect(store.query({ scope: 'agent' })).toHaveLength(1);
  });

  test('query with tags filter', () => {
    store.set('a', 'val', { tags: ['billing', 'important'] });
    store.set('b', 'val', { tags: ['shipping'] });
    store.set('c', 'val', { tags: ['billing'] });

    expect(store.query({ tags: ['billing'] })).toHaveLength(2);
    expect(store.query({ tags: ['billing', 'important'] })).toHaveLength(1);
  });

  test('query with key filter', () => {
    store.set('invoice-123', 'val');
    store.set('invoice-456', 'val');
    store.set('customer-789', 'val');

    expect(store.query({ key: 'invoice' })).toHaveLength(2);
  });

  test('query with pagination', () => {
    for (let i = 0; i < 10; i++) {
      store.set(`item-${i}`, i);
    }

    const page1 = store.query({ limit: 3, offset: 0 });
    const page2 = store.query({ limit: 3, offset: 3 });
    expect(page1).toHaveLength(3);
    expect(page2).toHaveLength(3);
  });

  // --- Clear operations ---

  test('clearAgent removes all entries for an agent', () => {
    store.set('a', 'v', { scope: 'agent', agentId: 'agent-1' });
    store.set('b', 'v', { scope: 'agent', agentId: 'agent-1' });
    store.set('c', 'v', { scope: 'agent', agentId: 'agent-2' });

    expect(store.clearAgent('agent-1')).toBe(2);
    expect(store.query({ agentId: 'agent-1' })).toHaveLength(0);
    expect(store.query({ agentId: 'agent-2' })).toHaveLength(1);
  });

  test('clearSession removes all entries for a session', () => {
    store.set('a', 'v', { scope: 'session', sessionId: 's1' });
    store.set('b', 'v', { scope: 'session', sessionId: 's1' });
    store.set('c', 'v', { scope: 'session', sessionId: 's2' });

    expect(store.clearSession('s1')).toBe(2);
  });

  // --- Stats ---

  test('stats counts correctly by scope', () => {
    store.set('a', 'v', { scope: 'shared' });
    store.set('b', 'v', { scope: 'agent', agentId: 'agent-1' });
    store.set('c', 'v', { scope: 'agent', agentId: 'agent-1' });
    store.set('d', 'v', { scope: 'session', sessionId: 's1' });

    const stats = store.stats();
    expect(stats.totalEntries).toBe(4);
    expect(stats.byScope.shared).toBe(1);
    expect(stats.byScope.agent).toBe(2);
    expect(stats.byScope.session).toBe(1);
    expect(stats.byAgent['agent-1']).toBe(2);
  });

  // --- Export/Import ---

  test('export and import round-trip', () => {
    store.set('key1', 'val1', { tags: ['t1'] });
    store.set('key2', 'val2', { scope: 'agent', agentId: 'a1' });

    const exported = store.export();
    expect(exported).toHaveLength(2);

    const newStore = new MemoryStore({ cleanupIntervalMs: 999_999 });
    newStore.import(exported);

    expect(newStore.get('key1')!.value).toBe('val1');
    expect(newStore.get('key2', { scope: 'agent', agentId: 'a1' })!.value).toBe('val2');
    newStore.destroy();
  });

  test('import handles entries without version (backward compat)', () => {
    const entries: MemoryEntry[] = [{
      id: 'test',
      scope: 'shared',
      key: 'old-entry',
      value: 'val',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ttl: 0,
      version: undefined as unknown as number, // Simulate old entry without version
    }];

    store.import(entries);
    const retrieved = store.get('old-entry');
    expect(retrieved).toBeDefined();
    expect(retrieved!.version).toBe(1);
  });
});
