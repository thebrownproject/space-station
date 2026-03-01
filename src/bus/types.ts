import type { EventEmitter } from 'eventemitter3';
import type { BusMessage, MessageType, Subscription, MessageFilter } from '../types/message.js';

export interface BusEvents {
  message: (msg: BusMessage) => void;
  subscribe: (sub: Subscription) => void;
  unsubscribe: (subId: string) => void;
  error: (err: Error) => void;
}

/**
 * Message bus interface — the contract that both the in-memory MessageBus
 * and NatsMessageBus implement. Allows swapping implementations based
 * on config without changing consuming code.
 */
export interface IMessageBus extends EventEmitter<BusEvents> {
  /** Publish a message to a subject */
  publish(
    subject: string,
    payload: unknown,
    options?: {
      from?: string;
      to?: string;
      type?: MessageType;
      correlationId?: string;
      replyTo?: string;
      headers?: Record<string, string>;
    },
  ): BusMessage;

  /** Subscribe to messages matching a subject pattern */
  subscribe(
    subject: string,
    agentId: string,
    handler: (msg: BusMessage) => void,
    queueGroup?: string,
  ): Subscription;

  /** Unsubscribe by subscription ID */
  unsubscribe(subscriptionId: string): boolean;

  /** Unsubscribe all subscriptions for an agent */
  unsubscribeAll(agentId: string): number;

  /** Send a request and wait for a reply */
  request(
    subject: string,
    payload: unknown,
    options?: {
      from?: string;
      to?: string;
      timeout?: number;
      headers?: Record<string, string>;
    },
  ): Promise<BusMessage>;

  /** Reply to a request message */
  reply(originalMessage: BusMessage, payload: unknown, from?: string): BusMessage;

  /** Query message history */
  queryHistory(filter?: MessageFilter, limit?: number): BusMessage[];

  /** Get all active subscriptions */
  listSubscriptions(agentId?: string): Subscription[];

  /** Get bus statistics */
  stats(): {
    totalMessages: number;
    activeSubscriptions: number;
    pendingRequests: number;
  };

  /** Drain all pending requests and clear state */
  drain(): Promise<void>;

  /** Connect to the backing transport (no-op for in-memory) */
  connect?(): Promise<void>;
}
