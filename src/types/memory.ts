/**
 * Types for the shared memory layer.
 */

export type MemoryScope = 'agent' | 'shared' | 'session';

export interface MemoryEntry {
  /** Unique ID for this memory entry */
  id: string;
  /** The scope of this memory */
  scope: MemoryScope;
  /** Owner agent ID (for agent-scoped memory) */
  agentId?: string;
  /** Session ID (for session-scoped memory) */
  sessionId?: string;
  /** The key for this memory entry */
  key: string;
  /** The stored value */
  value: unknown;
  /** Optional tags for categorisation and search */
  tags: string[];
  /** When this memory was created */
  createdAt: string;
  /** When this memory was last updated */
  updatedAt: string;
  /** TTL in seconds (0 = never expires) */
  ttl: number;
}

export interface MemoryQuery {
  scope?: MemoryScope;
  agentId?: string;
  sessionId?: string;
  key?: string;
  tags?: string[];
  /** Text search across keys and values */
  search?: string;
  limit?: number;
  offset?: number;
}

export interface MemoryStats {
  totalEntries: number;
  byScope: Record<MemoryScope, number>;
  byAgent: Record<string, number>;
}
