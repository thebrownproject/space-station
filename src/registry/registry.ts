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
    // Validate agent name
    const nameErr = validateAgentName(registration.name);
    if (nameErr) throw new Error(nameErr);

    const existing = this.findByName(registration.name);
    if (existing) {
      throw new Error(`Agent "${registration.name}" is already registered (id: ${existing.id})`);
    }

    // Validate wake patterns
    for (const pattern of registration.wakePatterns ?? []) {
      const patternErr = validateSubject(pattern, true);
      if (patternErr) throw new Error(`Invalid wake pattern "${pattern}": ${patternErr}`);
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
    if (agent.status === 'offline') {
      agent.status = 'online';
    }
    return agent;
  }

  /** Update an existing agent's card (partial update, preserves ID and timestamps) */
  update(
    idOrName: string,
    updates: Partial<Pick<AgentCard, 'description' | 'version' | 'capabilities' | 'wakePatterns' | 'endpoint' | 'auth' | 'metadata'>>,
  ): AgentCard | undefined {
    const agent = this.resolve(idOrName);
    if (!agent) return undefined;

    if (updates.wakePatterns) {
      for (const pattern of updates.wakePatterns) {
        const patternErr = validateSubject(pattern, true);
        if (patternErr) throw new Error(`Invalid wake pattern "${pattern}": ${patternErr}`);
      }
    }

    if (updates.description !== undefined) agent.description = updates.description;
    if (updates.version !== undefined) agent.version = updates.version;
    if (updates.capabilities !== undefined) agent.capabilities = updates.capabilities;
    if (updates.wakePatterns !== undefined) agent.wakePatterns = updates.wakePatterns;
    if (updates.endpoint !== undefined) agent.endpoint = updates.endpoint;
    if (updates.auth !== undefined) agent.auth = updates.auth;
    if (updates.metadata !== undefined) agent.metadata = updates.metadata;
    agent.lastSeenAt = new Date().toISOString();

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

  /** Import agent cards (for loading from persistence). Marks all as offline since they may not be running. */
  import(cards: AgentCard[]): void {
    for (const card of cards) {
      // Skip if an agent with the same name already exists (prevent ghost duplicates)
      if (this.findByName(card.name) && !this.agents.has(card.id)) continue;
      // Mark as offline — agent must heartbeat or re-register to go online
      card.status = 'offline';
      this.agents.set(card.id, card);
    }
  }

  clear(): void {
    this.agents.clear();
  }
}

/**
 * Match a NATS-style subject against a pattern.
 * - '*' matches exactly one non-empty token
 * - '>' matches one or more tokens, must be the last token in the pattern
 * - Exact string matches individual tokens
 *
 * Examples:
 *   subjectMatches("billing.invoice.created", "billing.*") => false
 *   subjectMatches("billing.invoice.created", "billing.>") => true
 *   subjectMatches("billing.invoice", "billing.*") => true
 *   subjectMatches("billing.invoice.created", "billing.*.created") => true
 */
export function subjectMatches(subject: string, pattern: string): boolean {
  if (!subject || !pattern) return false;

  const subjectTokens = subject.split('.');
  const patternTokens = pattern.split('.');

  // Validate: no empty tokens (e.g., "billing..invoice" or ".billing" or "billing.")
  if (subjectTokens.some((t) => t === '')) return false;
  if (patternTokens.some((t) => t === '')) return false;

  // Validate: '>' must only appear as the last token
  const gtIndex = patternTokens.indexOf('>');
  if (gtIndex !== -1 && gtIndex !== patternTokens.length - 1) return false;

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

/**
 * Validate a NATS-style subject string.
 * Returns an error message if invalid, or undefined if valid.
 */
export function validateSubject(subject: string, allowWildcards = false): string | undefined {
  if (!subject) return 'Subject cannot be empty';
  if (subject.startsWith('.') || subject.endsWith('.')) return 'Subject cannot start or end with a dot';
  if (subject.includes('..')) return 'Subject cannot contain empty tokens (consecutive dots)';

  const tokens = subject.split('.');
  for (const token of tokens) {
    if (token === '') return 'Subject contains an empty token';
    if (!allowWildcards && (token === '*' || token === '>')) {
      return 'Wildcards (* and >) are not allowed in publish subjects';
    }
  }

  if (allowWildcards) {
    const gtIndex = tokens.indexOf('>');
    if (gtIndex !== -1 && gtIndex !== tokens.length - 1) {
      return '">" wildcard must be the last token in the pattern';
    }
  }

  return undefined;
}

/**
 * Validate an agent name. Names cannot contain dots (they conflict with
 * NATS subject tokenisation) and cannot be empty.
 */
export function validateAgentName(name: string): string | undefined {
  if (!name || !name.trim()) return 'Agent name cannot be empty';
  if (name.includes('.')) return 'Agent name cannot contain dots (conflicts with NATS subject tokens)';
  if (name.includes(':')) return 'Agent name cannot contain colons (conflicts with memory key separator)';
  return undefined;
}
