/**
 * Core type definitions for Agent Cards, following the A2A protocol's
 * Agent Card format as a foundation.
 */

export interface AgentCapability {
  name: string;
  description?: string;
  /** NATS subject patterns this capability handles */
  subjects?: string[];
}

export interface AgentCard {
  /** Unique identifier for the agent */
  id: string;
  /** Human-readable name */
  name: string;
  /** What this agent does */
  description: string;
  /** Version of the agent */
  version: string;
  /** Capabilities this agent provides */
  capabilities: AgentCapability[];
  /** NATS subject patterns that wake this agent */
  wakePatterns: string[];
  /** Endpoint for direct communication (optional, for HTTP-based agents) */
  endpoint?: string;
  /** Authentication method */
  auth?: AgentAuth;
  /** Agent status */
  status: AgentStatus;
  /** When the agent was registered */
  registeredAt: string;
  /** Last heartbeat timestamp */
  lastSeenAt: string;
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
}

export type AgentStatus = 'online' | 'offline' | 'sleeping' | 'busy';

export interface AgentAuth {
  type: 'token' | 'mtls' | 'none';
  /** For token auth, the expected token header */
  tokenHeader?: string;
}

export interface AgentRegistration {
  name: string;
  description: string;
  version?: string;
  capabilities: string[] | AgentCapability[];
  wakePatterns?: string[];
  endpoint?: string;
  auth?: AgentAuth;
  metadata?: Record<string, unknown>;
}
