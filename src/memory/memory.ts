import { v4 as uuid } from 'uuid';
import type { MemoryEntry, MemoryQuery, MemoryScope, MemoryStats } from '../types/memory.js';

export class VersionConflictError extends Error {
  readonly key: string;
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(key: string, expectedVersion: number, actualVersion: number) {
    super(
      `Version conflict on key "${key}": expected version ${expectedVersion}, but current version is ${actualVersion}`,
    );
    this.name = 'VersionConflictError';
    this.key = key;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

/**
 * Shared memory layer for inter-agent context.
 *
 * Three scopes:
 * - agent:   Private to a single agent (e.g., learned preferences)
 * - shared:  Visible to all agents (e.g., "Customer 123 is on Enterprise plan")
 * - session: Ephemeral, tied to a specific multi-agent workflow session
 *
 * In production, back this with Supabase + pgvector for semantic search.
 * This in-memory implementation provides the same API surface.
 */
export class MemoryStore {
  private entries: Map<string, MemoryEntry> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: { cleanupIntervalMs?: number } = {}) {
    const interval = options.cleanupIntervalMs ?? 60_000;
    this.cleanupInterval = setInterval(() => this.cleanup(), interval);
    // Don't let the cleanup timer prevent process exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /** Store a value in memory */
  set(
    key: string,
    value: unknown,
    options: {
      scope?: MemoryScope;
      agentId?: string;
      sessionId?: string;
      tags?: string[];
      ttl?: number;
      expectedVersion?: number;
    } = {},
  ): MemoryEntry {
    const scope = options.scope ?? 'shared';
    const compositeKey = this.compositeKey(key, scope, options.agentId, options.sessionId);

    const existing = this.entries.get(compositeKey);
    const now = new Date().toISOString();

    // Optimistic locking: if expectedVersion is provided, check it matches
    if (options.expectedVersion !== undefined && existing) {
      if (existing.version !== options.expectedVersion) {
        throw new VersionConflictError(key, options.expectedVersion, existing.version);
      }
    }

    const entry: MemoryEntry = {
      id: existing?.id ?? uuid(),
      scope,
      agentId: options.agentId,
      sessionId: options.sessionId,
      key,
      value,
      tags: options.tags ?? existing?.tags ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ttl: options.ttl ?? existing?.ttl ?? 0,
      version: (existing?.version ?? 0) + 1,
    };

    this.entries.set(compositeKey, entry);
    return entry;
  }

  /** Retrieve a value from memory */
  get(
    key: string,
    options: {
      scope?: MemoryScope;
      agentId?: string;
      sessionId?: string;
    } = {},
  ): MemoryEntry | undefined {
    const scope = options.scope ?? 'shared';
    const compositeKey = this.compositeKey(key, scope, options.agentId, options.sessionId);
    const entry = this.entries.get(compositeKey);

    if (entry && this.isExpired(entry)) {
      this.entries.delete(compositeKey);
      return undefined;
    }

    return entry;
  }

  /** Delete a memory entry */
  delete(
    key: string,
    options: {
      scope?: MemoryScope;
      agentId?: string;
      sessionId?: string;
    } = {},
  ): boolean {
    const scope = options.scope ?? 'shared';
    const compositeKey = this.compositeKey(key, scope, options.agentId, options.sessionId);
    return this.entries.delete(compositeKey);
  }

  /** Query memory entries */
  query(query: MemoryQuery = {}): MemoryEntry[] {
    let results: MemoryEntry[] = [];

    for (const entry of this.entries.values()) {
      if (this.isExpired(entry)) continue;

      if (query.scope && entry.scope !== query.scope) continue;
      if (query.agentId && entry.agentId !== query.agentId) continue;
      if (query.sessionId && entry.sessionId !== query.sessionId) continue;
      if (query.key && !entry.key.includes(query.key)) continue;

      if (query.tags && query.tags.length > 0) {
        if (!query.tags.every((t) => entry.tags.includes(t))) continue;
      }

      if (query.search) {
        const searchStr = query.search.toLowerCase();
        const searchable = [
          entry.key,
          typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value),
          ...entry.tags,
        ]
          .join(' ')
          .toLowerCase();

        if (!searchable.includes(searchStr)) continue;
      }

      results.push(entry);
    }

    // Apply pagination
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 100;
    results = results.slice(offset, offset + limit);

    return results;
  }

  /** Delete all memory for an agent */
  clearAgent(agentId: string): number {
    let count = 0;
    for (const [key, entry] of this.entries) {
      if (entry.agentId === agentId) {
        this.entries.delete(key);
        count++;
      }
    }
    return count;
  }

  /** Delete all memory for a session */
  clearSession(sessionId: string): number {
    let count = 0;
    for (const [key, entry] of this.entries) {
      if (entry.sessionId === sessionId) {
        this.entries.delete(key);
        count++;
      }
    }
    return count;
  }

  /** Get memory statistics */
  stats(): MemoryStats {
    const byScope: Record<MemoryScope, number> = { agent: 0, shared: 0, session: 0 };
    const byAgent: Record<string, number> = {};
    let activeCount = 0;

    for (const entry of this.entries.values()) {
      if (this.isExpired(entry)) continue;
      activeCount++;
      byScope[entry.scope]++;
      if (entry.agentId) {
        byAgent[entry.agentId] = (byAgent[entry.agentId] ?? 0) + 1;
      }
    }

    return {
      totalEntries: activeCount,
      byScope,
      byAgent,
    };
  }

  /** Export all entries (for persistence) */
  export(): MemoryEntry[] {
    return Array.from(this.entries.values()).filter((e) => !this.isExpired(e));
  }

  /** Import entries (from persistence) */
  import(entries: MemoryEntry[]): void {
    for (const entry of entries) {
      if (!this.isExpired(entry)) {
        const compositeKey = this.compositeKey(
          entry.key,
          entry.scope,
          entry.agentId,
          entry.sessionId,
        );
        // Backward compatibility: ensure version field exists
        if (entry.version === undefined) {
          (entry as MemoryEntry).version = 1;
        }
        this.entries.set(compositeKey, entry);
      }
    }
  }

  /** Stop the cleanup interval */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  private compositeKey(
    key: string,
    scope: MemoryScope,
    agentId?: string,
    sessionId?: string,
  ): string {
    return `${scope}:${agentId ?? ''}:${sessionId ?? ''}:${key}`;
  }

  private isExpired(entry: MemoryEntry): boolean {
    if (entry.ttl === 0) return false;
    const expiresAt = new Date(entry.updatedAt).getTime() + entry.ttl * 1000;
    return Date.now() > expiresAt;
  }

  private cleanup(): void {
    for (const [key, entry] of this.entries) {
      if (this.isExpired(entry)) {
        this.entries.delete(key);
      }
    }
  }
}
