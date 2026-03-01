import { EventEmitter } from 'eventemitter3';
import { v4 as uuid } from 'uuid';
import { subjectMatches, validateSubject } from '../registry/registry.js';
import type { BusMessage, MessageType, Subscription, MessageFilter } from '../types/message.js';

interface BusEvents {
  message: (msg: BusMessage) => void;
  subscribe: (sub: Subscription) => void;
  unsubscribe: (subId: string) => void;
  error: (err: Error) => void;
}

interface PendingRequest {
  resolve: (msg: BusMessage) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Local message bus implementing NATS-style subject-based routing.
 *
 * This is the in-process implementation. For production, swap this out
 * for a real NATS connection — the API surface is intentionally
 * compatible so the CLI and SDK work identically in both modes.
 *
 * Supports:
 * - Pub/sub with wildcard subject matching (* and >)
 * - Request/reply with timeouts
 * - Queue groups for load-balanced consumption
 * - Message history with JetStream-style replay
 */
export class MessageBus extends EventEmitter<BusEvents> {
  private subscriptions: Map<string, Subscription & { handler: (msg: BusMessage) => void }> =
    new Map();
  private history: BusMessage[] = [];
  private maxHistory: number;
  private pendingRequests: Map<string, PendingRequest> = new Map();

  constructor(options: { maxHistory?: number } = {}) {
    super();
    this.maxHistory = options.maxHistory ?? 10_000;
  }

  /**
   * Publish a message to a subject. All matching subscribers receive it.
   * For queue group subscriptions, only one subscriber per group receives it.
   */
  publish(
    subject: string,
    payload: unknown,
    options: {
      from?: string;
      to?: string;
      type?: MessageType;
      correlationId?: string;
      replyTo?: string;
      headers?: Record<string, string>;
    } = {},
  ): BusMessage {
    // Validate subject — internal subjects (starting with _) skip wildcard checks
    const isInternal = subject.startsWith('_');
    if (!isInternal) {
      const err = validateSubject(subject, false);
      if (err) throw new Error(`Invalid publish subject "${subject}": ${err}`);
    }

    const msg: BusMessage = {
      id: uuid(),
      subject,
      from: options.from ?? 'system',
      to: options.to ?? '*',
      type: options.type ?? 'event',
      payload,
      timestamp: new Date().toISOString(),
      correlationId: options.correlationId,
      replyTo: options.replyTo,
      headers: options.headers,
    };

    this.recordMessage(msg);
    this.routeMessage(msg);
    this.emit('message', msg);

    return msg;
  }

  /**
   * Send a request and wait for a reply. Returns a promise that resolves
   * when a matching reply arrives, or rejects on timeout.
   */
  request(
    subject: string,
    payload: unknown,
    options: {
      from?: string;
      to?: string;
      timeout?: number;
      headers?: Record<string, string>;
    } = {},
  ): Promise<BusMessage> {
    const correlationId = uuid();
    const replySubject = `_reply.${correlationId}`;

    return new Promise<BusMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        replySub.unsubscribe();
        reject(new Error(`Request to "${subject}" timed out after ${options.timeout ?? 30_000}ms`));
      }, options.timeout ?? 30_000);

      this.pendingRequests.set(correlationId, { resolve, reject, timer });

      // Subscribe to the reply subject
      const replySub = {
        unsubscribe: () => {
          // Find and remove the reply subscription
          for (const [id, sub] of this.subscriptions) {
            if (sub.subject === replySubject) {
              this.subscriptions.delete(id);
              break;
            }
          }
        },
      };

      this.subscribe(replySubject, 'system', (msg) => {
        const pending = this.pendingRequests.get(correlationId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(correlationId);
          replySub.unsubscribe();
          pending.resolve(msg);
        }
      });

      // Publish the request
      this.publish(subject, payload, {
        from: options.from,
        to: options.to,
        type: 'request',
        correlationId,
        replyTo: replySubject,
        headers: options.headers,
      });
    });
  }

  /**
   * Reply to a request message.
   */
  reply(originalMessage: BusMessage, payload: unknown, from?: string): BusMessage {
    const replySubject = originalMessage.replyTo;
    if (!replySubject) {
      throw new Error('Cannot reply: original message has no replyTo subject');
    }

    return this.publish(replySubject, payload, {
      from: from ?? 'system',
      to: originalMessage.from,
      type: 'reply',
      correlationId: originalMessage.correlationId,
    });
  }

  /**
   * Subscribe to messages matching a subject pattern.
   * Supports NATS-style wildcards: * (single token) and > (tail match).
   */
  subscribe(
    subject: string,
    agentId: string,
    handler: (msg: BusMessage) => void,
    queueGroup?: string,
  ): Subscription {
    // Validate subject pattern — internal subjects (starting with _) skip validation
    const isInternal = subject.startsWith('_');
    if (!isInternal) {
      const err = validateSubject(subject, true);
      if (err) throw new Error(`Invalid subscribe pattern "${subject}": ${err}`);
    }

    const sub: Subscription = {
      id: uuid(),
      agentId,
      subject,
      queueGroup,
      createdAt: new Date().toISOString(),
    };

    this.subscriptions.set(sub.id, { ...sub, handler });
    this.emit('subscribe', sub);
    return sub;
  }

  unsubscribe(subscriptionId: string): boolean {
    const existed = this.subscriptions.has(subscriptionId);
    this.subscriptions.delete(subscriptionId);
    if (existed) {
      this.emit('unsubscribe', subscriptionId);
    }
    return existed;
  }

  /** Unsubscribe all subscriptions for an agent */
  unsubscribeAll(agentId: string): number {
    let count = 0;
    for (const [id, sub] of this.subscriptions) {
      if (sub.agentId === agentId) {
        this.subscriptions.delete(id);
        count++;
      }
    }
    return count;
  }

  /** Query message history */
  queryHistory(filter: MessageFilter = {}, limit = 100): BusMessage[] {
    let results = this.history;

    if (filter.subject) {
      results = results.filter((m) => subjectMatches(m.subject, filter.subject!));
    }
    if (filter.from) {
      results = results.filter((m) => m.from === filter.from);
    }
    if (filter.to) {
      results = results.filter((m) => m.to === filter.to);
    }
    if (filter.type) {
      results = results.filter((m) => m.type === filter.type);
    }
    if (filter.since) {
      const since = new Date(filter.since).getTime();
      results = results.filter((m) => new Date(m.timestamp).getTime() >= since);
    }

    return results.slice(-limit);
  }

  /** Get all active subscriptions */
  listSubscriptions(agentId?: string): Subscription[] {
    const subs = Array.from(this.subscriptions.values()).map(
      ({ handler: _h, ...sub }) => sub,
    );
    if (agentId) {
      return subs.filter((s) => s.agentId === agentId);
    }
    return subs;
  }

  /** Get bus statistics */
  stats(): {
    totalMessages: number;
    activeSubscriptions: number;
    pendingRequests: number;
  } {
    return {
      totalMessages: this.history.length,
      activeSubscriptions: this.subscriptions.size,
      pendingRequests: this.pendingRequests.size,
    };
  }

  /** Drain all pending requests and clear state */
  async drain(): Promise<void> {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Bus is draining'));
      this.pendingRequests.delete(id);
    }
    this.subscriptions.clear();
    this.removeAllListeners();
  }

  private recordMessage(msg: BusMessage): void {
    this.history.push(msg);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  }

  private routeMessage(msg: BusMessage): void {
    // Group subscriptions by queue group for load balancing
    const directSubs: Array<(msg: BusMessage) => void> = [];
    const queueGroups: Map<string, Array<(msg: BusMessage) => void>> = new Map();

    for (const sub of this.subscriptions.values()) {
      if (!subjectMatches(msg.subject, sub.subject)) continue;

      if (sub.queueGroup) {
        const group = queueGroups.get(sub.queueGroup) ?? [];
        group.push(sub.handler);
        queueGroups.set(sub.queueGroup, group);
      } else {
        directSubs.push(sub.handler);
      }
    }

    const safeCall = (handler: (msg: BusMessage) => void) => {
      try {
        // Wrap in Promise.resolve to catch both sync throws and async rejections
        Promise.resolve(handler(msg)).catch((err: unknown) => {
          this.emit('error', err instanceof Error ? err : new Error(String(err)));
        });
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    };

    // Deliver to all direct subscribers
    for (const handler of directSubs) {
      safeCall(handler);
    }

    // For each queue group, pick one random subscriber
    for (const handlers of queueGroups.values()) {
      const idx = Math.floor(Math.random() * handlers.length);
      safeCall(handlers[idx]);
    }
  }
}
