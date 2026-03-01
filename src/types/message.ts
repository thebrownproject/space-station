/**
 * Message types for the agent message bus.
 */

export interface BusMessage {
  /** Unique message ID */
  id: string;
  /** NATS-style subject (e.g., "billing.invoice.created") */
  subject: string;
  /** The agent that sent this message */
  from: string;
  /** Target agent (for direct messages) or "*" for broadcast */
  to: string;
  /** Message type */
  type: MessageType;
  /** The actual payload */
  payload: unknown;
  /** When the message was created */
  timestamp: string;
  /** Correlation ID for request/reply chains */
  correlationId?: string;
  /** Reply-to subject for request/reply pattern */
  replyTo?: string;
  /** Arbitrary message headers */
  headers?: Record<string, string>;
}

export type MessageType =
  | 'event'      // Fire-and-forget event
  | 'request'    // Request expecting a reply
  | 'reply'      // Reply to a request
  | 'wake'       // Wake-up signal
  | 'heartbeat'; // Agent heartbeat

export interface MessageFilter {
  subject?: string;
  from?: string;
  to?: string;
  type?: MessageType;
  since?: string;
}

export interface Subscription {
  id: string;
  agentId: string;
  subject: string;
  /** Whether this is a queue group subscription (load-balanced) */
  queueGroup?: string;
  createdAt: string;
}
