import { EventEmitter } from 'eventemitter3';
import { v4 as uuid } from 'uuid';
import { connect, StringCodec, type NatsConnection, type Subscription as NatsSub } from 'nats';
import { validateSubject } from '../registry/registry.js';
import { subjectMatches } from '../registry/registry.js';
import type { BusMessage, MessageType, Subscription, MessageFilter } from '../types/message.js';
import type { BusEvents, IMessageBus } from './types.js';

const sc = StringCodec();

interface NatsSubscriptionEntry {
  sub: Subscription;
  handler: (msg: BusMessage) => void;
  natsSub: NatsSub;
}

/**
 * NATS-backed message bus implementation.
 *
 * Connects to a real NATS server for cross-process communication.
 * Implements the same IMessageBus interface as the in-memory MessageBus,
 * so all consuming code (SDK, CLI, wake manager) works identically.
 *
 * Key differences from the in-memory bus:
 * - Messages are routed by the NATS server (wildcard matching is native)
 * - Subscriptions and history are tracked locally for API compatibility
 * - connect() must be called before use
 */
export class NatsMessageBus extends EventEmitter<BusEvents> implements IMessageBus {
  private nc: NatsConnection | null = null;
  private subscriptions: Map<string, NatsSubscriptionEntry> = new Map();
  private history: BusMessage[] = [];
  private maxHistory: number;
  private pendingRequests: Map<string, {
    resolve: (msg: BusMessage) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = new Map();
  private servers: string;
  private connected = false;

  constructor(options: { servers: string; maxHistory?: number }) {
    super();
    this.servers = options.servers;
    this.maxHistory = options.maxHistory ?? 10_000;
  }

  /** Connect to the NATS server. Must be called before publish/subscribe. */
  async connect(): Promise<void> {
    if (this.connected) return;
    this.nc = await connect({ servers: this.servers });
    this.connected = true;
  }

  private ensureConnected(): NatsConnection {
    if (!this.nc || !this.connected) {
      throw new Error('NatsMessageBus is not connected. Call connect() first.');
    }
    return this.nc;
  }

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
    const nc = this.ensureConnected();

    // Validate subject — internal subjects skip validation
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

    // Publish the full BusMessage envelope as JSON over NATS
    nc.publish(subject, sc.encode(JSON.stringify(msg)));

    this.recordMessage(msg);
    this.emit('message', msg);

    return msg;
  }

  subscribe(
    subject: string,
    agentId: string,
    handler: (msg: BusMessage) => void,
    queueGroup?: string,
  ): Subscription {
    const nc = this.ensureConnected();

    // Validate subject pattern — internal subjects skip validation
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

    // Create NATS subscription (with optional queue group)
    const natsSub = nc.subscribe(subject, {
      queue: queueGroup,
      callback: (_err, natsMsg) => {
        try {
          const data = sc.decode(natsMsg.data);
          const busMsg: BusMessage = JSON.parse(data);
          handler(busMsg);
        } catch (err) {
          this.emit('error', err instanceof Error ? err : new Error(String(err)));
        }
      },
    });

    this.subscriptions.set(sub.id, { sub, handler, natsSub });
    this.emit('subscribe', sub);
    return sub;
  }

  unsubscribe(subscriptionId: string): boolean {
    const entry = this.subscriptions.get(subscriptionId);
    if (!entry) return false;

    entry.natsSub.unsubscribe();
    this.subscriptions.delete(subscriptionId);
    this.emit('unsubscribe', subscriptionId);
    return true;
  }

  unsubscribeAll(agentId: string): number {
    let count = 0;
    for (const [id, entry] of this.subscriptions) {
      if (entry.sub.agentId === agentId) {
        entry.natsSub.unsubscribe();
        this.subscriptions.delete(id);
        count++;
      }
    }
    return count;
  }

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
    const nc = this.ensureConnected();
    const timeout = options.timeout ?? 30_000;
    const correlationId = uuid();
    const replySubject = `_reply.${correlationId}`;

    return new Promise<BusMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        replySub.unsubscribe();
        reject(new Error(`Request to "${subject}" timed out after ${timeout}ms`));
      }, timeout);

      this.pendingRequests.set(correlationId, { resolve, reject, timer });

      // Subscribe to the reply subject
      const replySub = nc.subscribe(replySubject, {
        callback: (_err, natsMsg) => {
          const pending = this.pendingRequests.get(correlationId);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(correlationId);
            replySub.unsubscribe();
            try {
              const data = sc.decode(natsMsg.data);
              const busMsg: BusMessage = JSON.parse(data);
              pending.resolve(busMsg);
            } catch (err) {
              pending.reject(err instanceof Error ? err : new Error(String(err)));
            }
          }
        },
      });

      // Build and publish the request message
      const msg: BusMessage = {
        id: uuid(),
        subject,
        from: options.from ?? 'system',
        to: options.to ?? '*',
        type: 'request',
        payload,
        timestamp: new Date().toISOString(),
        correlationId,
        replyTo: replySubject,
        headers: options.headers,
      };

      nc.publish(subject, sc.encode(JSON.stringify(msg)));
      this.recordMessage(msg);
      this.emit('message', msg);
    });
  }

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

  listSubscriptions(agentId?: string): Subscription[] {
    const subs = Array.from(this.subscriptions.values()).map((e) => e.sub);
    if (agentId) {
      return subs.filter((s) => s.agentId === agentId);
    }
    return subs;
  }

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

  async drain(): Promise<void> {
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Bus is draining'));
      this.pendingRequests.delete(id);
    }

    // Unsubscribe all NATS subscriptions
    for (const [, entry] of this.subscriptions) {
      entry.natsSub.unsubscribe();
    }
    this.subscriptions.clear();

    // Drain and close the NATS connection
    if (this.nc) {
      await this.nc.drain();
      this.nc = null;
      this.connected = false;
    }

    this.removeAllListeners();
  }

  private recordMessage(msg: BusMessage): void {
    this.history.push(msg);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  }
}
