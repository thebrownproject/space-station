import { v4 as uuid } from 'uuid';
import type {
  AgentCard,
  AgentCapability,
  AgentRegistration,
  AgentStatus,
} from '../types/agent.js';

/**
 * In-memory agent registry. In production, this would be backed by
 * Postgres/Supabase with full-text search on capabilities.
 *
 * Agents register themselves with an "Agent Card" describing their
 * capabilities, wake patterns, and metadata. Other agents query the
 * registry to discover who can help with a given task.
 */
export class AgentRegistry {
  private agents: Map<string, AgentCard> = new Map();

  register(registration: AgentRegistration): AgentCard {
    const existing = this.findByName(registration.name);
    if (existing) {
      throw new Error(`Agent "${registration.name}" is already registered (id: ${existing.id})`);
    }

    const now = new Date().toISOString();
    const capabilities: AgentCapability[] = registration.capabilities.map((cap) => {
      if (typeof cap === 'string') {
        return { name: cap };
      }
      return cap;
    });

    const card: AgentCard = {
      id: uuid(),
      name: registration.name,
      description: registration.description,
      version: registration.version ?? '0.1.0',
      capabilities,
      wakePatterns: registration.wakePatterns ?? [],
      endpoint: registration.endpoint,
      auth: registration.auth ?? { type: 'none' },
      status: 'online',
      registeredAt: now,
      lastSeenAt: now,
      metadata: registration.metadata,
    };

    this.agents.set(card.id, card);
    return card;
  }

  unregister(idOrName: string): boolean {
    const agent = this.resolve(idOrName);
    if (!agent) return false;
    return this.agents.delete(agent.id);
  }

  get(id: string): AgentCard | undefined {
    return this.agents.get(id);
  }

  findByName(name: string): AgentCard | undefined {
    for (const agent of this.agents.values()) {
      if (agent.name === name) return agent;
    }
    return undefined;
  }

  /** Resolve an agent by ID or name */
  resolve(idOrName: string): AgentCard | undefined {
    return this.agents.get(idOrName) ?? this.findByName(idOrName);
  }

  /** Find agents by capability name */
  findByCapability(capability: string): AgentCard[] {
    const results: AgentCard[] = [];
    for (const agent of this.agents.values()) {
      if (agent.capabilities.some((c) => c.name === capability)) {
        results.push(agent);
      }
    }
    return results;
  }

  /** Search agents by text query across name, description, and capabilities */
  search(query: string): AgentCard[] {
    const q = query.toLowerCase();
    const results: AgentCard[] = [];
    for (const agent of this.agents.values()) {
      const searchable = [
        agent.name,
        agent.description,
        ...agent.capabilities.map((c) => c.name),
        ...agent.capabilities.map((c) => c.description ?? ''),
      ]
        .join(' ')
        .toLowerCase();

      if (searchable.includes(q)) {
        results.push(agent);
      }
    }
    return results;
  }

  /** List all registered agents, optionally filtered by status */
  list(status?: AgentStatus): AgentCard[] {
    const all = Array.from(this.agents.values());
    if (status) {
      return all.filter((a) => a.status === status);
    }
    return all;
  }

  /** Update an agent's status */
  updateStatus(idOrName: string, status: AgentStatus): AgentCard | undefined {
    const agent = this.resolve(idOrName);
    if (!agent) return undefined;
    agent.status = status;
    agent.lastSeenAt = new Date().toISOString();
    return agent;
  }

  /** Record a heartbeat from an agent */
  heartbeat(idOrName: string): AgentCard | undefined {
    const agent = this.resolve(idOrName);
    if (!agent) return undefined;
    agent.lastSeenAt = new Date().toISOString();
    if (agent.status === 'sleeping' || agent.status === 'offline') {
      agent.status = 'online';
    }
    return agent;
  }

  /** Find agents whose wake patterns match a given subject */
  findByWakePattern(subject: string): AgentCard[] {
    const results: AgentCard[] = [];
    for (const agent of this.agents.values()) {
      if (agent.wakePatterns.some((pattern) => subjectMatches(subject, pattern))) {
        results.push(agent);
      }
    }
    return results;
  }

  /** Get registry statistics */
  stats(): { total: number; byStatus: Record<AgentStatus, number> } {
    const byStatus: Record<AgentStatus, number> = {
      online: 0,
      offline: 0,
      sleeping: 0,
      busy: 0,
    };
    for (const agent of this.agents.values()) {
      byStatus[agent.status]++;
    }
    return { total: this.agents.size, byStatus };
  }

  /** Export all agent cards (for persistence) */
  export(): AgentCard[] {
    return Array.from(this.agents.values());
  }

  /** Import agent cards (for loading from persistence) */
  import(cards: AgentCard[]): void {
    for (const card of cards) {
      this.agents.set(card.id, card);
    }
  }

  clear(): void {
    this.agents.clear();
  }
}

/**
 * Match a NATS-style subject against a pattern.
 * - '*' matches a single token
 * - '>' matches one or more tokens at the end
 * - Exact string matches individual tokens
 *
 * Examples:
 *   subjectMatches("billing.invoice.created", "billing.*") => false
 *   subjectMatches("billing.invoice.created", "billing.>") => true
 *   subjectMatches("billing.invoice", "billing.*") => true
 *   subjectMatches("billing.invoice.created", "billing.*.created") => true
 */
export function subjectMatches(subject: string, pattern: string): boolean {
  const subjectTokens = subject.split('.');
  const patternTokens = pattern.split('.');

  for (let i = 0; i < patternTokens.length; i++) {
    const pt = patternTokens[i];

    if (pt === '>') {
      // '>' must be last token and matches one or more remaining
      return i < subjectTokens.length;
    }

    if (i >= subjectTokens.length) {
      return false;
    }

    if (pt !== '*' && pt !== subjectTokens[i]) {
      return false;
    }
  }

  return subjectTokens.length === patternTokens.length;
}
