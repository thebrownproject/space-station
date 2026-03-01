import { MessageBus } from '../bus.js';
import type { BusMessage } from '../../types/message.js';

describe('MessageBus', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus({ maxHistory: 100 });
  });

  afterEach(async () => {
    await bus.drain();
  });

  // --- Publish ---

  test('publish returns a BusMessage with correct fields', () => {
    const msg = bus.publish('billing.invoice.created', { amount: 100 }, { from: 'agent-1' });

    expect(msg.id).toBeDefined();
    expect(msg.subject).toBe('billing.invoice.created');
    expect(msg.from).toBe('agent-1');
    expect(msg.type).toBe('event');
    expect(msg.payload).toEqual({ amount: 100 });
    expect(msg.timestamp).toBeDefined();
  });

  test('publish validates subject', () => {
    expect(() => bus.publish('billing..invalid', {})).toThrow(/Invalid publish subject/);
  });

  test('publish allows internal subjects (starting with _)', () => {
    expect(() => bus.publish('_reply.abc', {})).not.toThrow();
    expect(() => bus.publish('_wake.billing', {})).not.toThrow();
  });

  test('publish emits message event', () => {
    const received: BusMessage[] = [];
    bus.on('message', (msg) => received.push(msg));

    bus.publish('test.subject', { data: 1 });
    expect(received).toHaveLength(1);
    expect(received[0].subject).toBe('test.subject');
  });

  // --- Subscribe ---

  test('subscribe delivers messages to handlers', () => {
    const received: BusMessage[] = [];
    bus.subscribe('billing.*', 'agent-1', (msg) => received.push(msg));

    bus.publish('billing.invoice', { data: 1 });
    bus.publish('billing.payment', { data: 2 });
    bus.publish('shipping.order', { data: 3 }); // Should not match

    expect(received).toHaveLength(2);
  });

  test('subscribe validates subject pattern', () => {
    expect(() =>
      bus.subscribe('billing..invalid', 'agent-1', () => {}),
    ).toThrow(/Invalid subscribe pattern/);
  });

  test('subscribe supports wildcard *', () => {
    const received: BusMessage[] = [];
    bus.subscribe('billing.*', 'agent-1', (msg) => received.push(msg));

    bus.publish('billing.invoice', {});
    bus.publish('billing.invoice.detail', {}); // Won't match
    expect(received).toHaveLength(1);
  });

  test('subscribe supports wildcard >', () => {
    const received: BusMessage[] = [];
    bus.subscribe('billing.>', 'agent-1', (msg) => received.push(msg));

    bus.publish('billing.invoice', {});
    bus.publish('billing.invoice.detail', {});
    bus.publish('billing.a.b.c', {});
    expect(received).toHaveLength(3);
  });

  test('subscribe to exact subject', () => {
    const received: BusMessage[] = [];
    bus.subscribe('billing.invoice.created', 'agent-1', (msg) => received.push(msg));

    bus.publish('billing.invoice.created', {});
    bus.publish('billing.invoice.deleted', {});
    expect(received).toHaveLength(1);
  });

  // --- Unsubscribe ---

  test('unsubscribe stops message delivery', () => {
    const received: BusMessage[] = [];
    const sub = bus.subscribe('test.>', 'agent-1', (msg) => received.push(msg));

    bus.publish('test.a', {});
    expect(received).toHaveLength(1);

    bus.unsubscribe(sub.id);
    bus.publish('test.b', {});
    expect(received).toHaveLength(1);
  });

  test('unsubscribeAll removes all subs for an agent', () => {
    const received: BusMessage[] = [];
    bus.subscribe('a.>', 'agent-1', (msg) => received.push(msg));
    bus.subscribe('b.>', 'agent-1', (msg) => received.push(msg));
    bus.subscribe('c.>', 'agent-2', (msg) => received.push(msg));

    expect(bus.unsubscribeAll('agent-1')).toBe(2);

    bus.publish('a.test', {});
    bus.publish('b.test', {});
    bus.publish('c.test', {});
    // Only agent-2's subscription should fire
    expect(received).toHaveLength(1);
    expect(received[0].subject).toBe('c.test');
  });

  // --- Queue Groups ---

  test('queue group delivers to only one subscriber', () => {
    const counts = { a: 0, b: 0 };
    bus.subscribe('test.subject', 'agent-a', () => { counts.a++; }, 'workers');
    bus.subscribe('test.subject', 'agent-b', () => { counts.b++; }, 'workers');

    // Publish multiple messages — each should go to exactly one subscriber
    for (let i = 0; i < 100; i++) {
      bus.publish('test.subject', { i });
    }

    // Total across both should be 100
    expect(counts.a + counts.b).toBe(100);
    // Both should receive some (probabilistic, but with 100 messages it's very unlikely for one to get 0)
    // We won't assert exact distribution, just that total is correct
  });

  test('non-queue subscribers each get every message', () => {
    const counts = { a: 0, b: 0 };
    bus.subscribe('test.subject', 'agent-a', () => { counts.a++; });
    bus.subscribe('test.subject', 'agent-b', () => { counts.b++; });

    bus.publish('test.subject', {});
    expect(counts.a).toBe(1);
    expect(counts.b).toBe(1);
  });

  // --- Request/Reply ---

  test('request/reply works with timeout', async () => {
    // Set up a responder
    bus.subscribe('math.add', 'calculator', (msg) => {
      const { a, b } = msg.payload as { a: number; b: number };
      bus.reply(msg, { result: a + b }, 'calculator');
    });

    const reply = await bus.request('math.add', { a: 3, b: 4 }, { timeout: 1000 });
    expect(reply.payload).toEqual({ result: 7 });
    expect(reply.type).toBe('reply');
  });

  test('request times out when no reply', async () => {
    await expect(
      bus.request('no.responder', {}, { timeout: 50 }),
    ).rejects.toThrow(/timed out/);
  });

  test('reply throws when no replyTo on original message', () => {
    const msg: BusMessage = {
      id: 'test',
      subject: 'test',
      from: 'agent',
      to: '*',
      type: 'event',
      payload: {},
      timestamp: new Date().toISOString(),
    };

    expect(() => bus.reply(msg, {})).toThrow(/no replyTo/);
  });

  // --- History ---

  test('queryHistory returns published messages', () => {
    bus.publish('a.b', { x: 1 });
    bus.publish('a.c', { x: 2 });
    bus.publish('d.e', { x: 3 });

    const all = bus.queryHistory();
    expect(all.length).toBeGreaterThanOrEqual(3);

    const filtered = bus.queryHistory({ subject: 'a.>' });
    expect(filtered).toHaveLength(2);
  });

  test('queryHistory respects limit', () => {
    for (let i = 0; i < 10; i++) {
      bus.publish('test.item', { i });
    }
    const results = bus.queryHistory({}, 3);
    expect(results).toHaveLength(3);
  });

  test('queryHistory filters by type', () => {
    bus.publish('a.b', {}, { type: 'event' });
    bus.publish('a.c', {}, { type: 'wake' });

    const events = bus.queryHistory({ type: 'event' });
    expect(events.every((m) => m.type === 'event')).toBe(true);
  });

  test('history is trimmed at maxHistory', () => {
    const smallBus = new MessageBus({ maxHistory: 5 });
    for (let i = 0; i < 10; i++) {
      smallBus.publish('test.item', { i });
    }
    expect(smallBus.queryHistory({}, 100)).toHaveLength(5);
    smallBus.drain();
  });

  // --- Subscriptions list ---

  test('listSubscriptions returns all or by agentId', () => {
    bus.subscribe('a.>', 'agent-1', () => {});
    bus.subscribe('b.>', 'agent-2', () => {});
    bus.subscribe('c.>', 'agent-1', () => {});

    expect(bus.listSubscriptions()).toHaveLength(3);
    expect(bus.listSubscriptions('agent-1')).toHaveLength(2);
    expect(bus.listSubscriptions('agent-2')).toHaveLength(1);
  });

  // --- Stats ---

  test('stats returns correct counts', () => {
    bus.subscribe('a.>', 'agent-1', () => {});
    bus.publish('a.test', {});

    const stats = bus.stats();
    expect(stats.activeSubscriptions).toBe(1);
    expect(stats.totalMessages).toBeGreaterThanOrEqual(1);
    expect(stats.pendingRequests).toBe(0);
  });

  // --- Error handling ---

  test('sync handler errors are emitted as error events', () => {
    const errors: Error[] = [];
    bus.on('error', (err) => errors.push(err));

    bus.subscribe('test.subject', 'agent', () => {
      throw new Error('handler failed');
    });

    bus.publish('test.subject', {});
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('handler failed');
  });

  test('async handler errors are emitted as error events', async () => {
    const errors: Error[] = [];
    bus.on('error', (err) => errors.push(err));

    bus.subscribe('test.subject', 'agent', async () => {
      throw new Error('async handler failed');
    });

    bus.publish('test.subject', {});

    // Wait for promise rejection to propagate
    await new Promise((r) => setTimeout(r, 10));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('async handler failed');
  });

  // --- Drain ---

  test('drain rejects pending requests', async () => {
    const requestPromise = bus.request('test.subject', {}, { timeout: 10_000 });
    await bus.drain();

    await expect(requestPromise).rejects.toThrow(/draining/);
  });
});
