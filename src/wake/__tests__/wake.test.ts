import { AgentRegistry } from '../../registry/registry.js';
import { MessageBus } from '../../bus/bus.js';
import { WakeManager } from '../wake.js';
import type { WakeEvent } from '../wake.js';

describe('WakeManager', () => {
  let registry: AgentRegistry;
  let bus: MessageBus;
  let wake: WakeManager;

  beforeEach(() => {
    registry = new AgentRegistry();
    bus = new MessageBus({ maxHistory: 100 });
    wake = new WakeManager(registry, bus, { maxLog: 50 });
    wake.start();
  });

  afterEach(async () => {
    wake.stop();
    await bus.drain();
  });

  test('wake event fires when message matches agent wake pattern', async () => {
    const card = registry.register({
      name: 'billing-agent',
      description: '',
      capabilities: [],
      wakePatterns: ['billing.>'],
    });
    // Set agent offline so it can be woken
    registry.updateStatus(card.id, 'offline');

    const events: WakeEvent[] = [];
    wake.on('wake', (event) => events.push(event));

    bus.publish('billing.invoice.created', { amount: 99 }, { from: 'system' });

    // Allow event propagation
    await new Promise((r) => setTimeout(r, 10));

    expect(events).toHaveLength(1);
    expect(events[0].agentName).toBe('billing-agent');
    expect(events[0].reason).toContain('billing.invoice.created');
  });

  test('online agents are not woken', () => {
    registry.register({
      name: 'online-agent',
      description: '',
      capabilities: [],
      wakePatterns: ['test.>'],
    });
    // Agent is online by default after registration

    const events: WakeEvent[] = [];
    wake.on('wake', (event) => events.push(event));

    bus.publish('test.event', {}, { from: 'system' });

    expect(events).toHaveLength(0);
  });

  test('busy agents are not woken', () => {
    const card = registry.register({
      name: 'busy-agent',
      description: '',
      capabilities: [],
      wakePatterns: ['test.>'],
    });
    registry.updateStatus(card.id, 'busy');

    const events: WakeEvent[] = [];
    wake.on('wake', (event) => events.push(event));

    bus.publish('test.event', {}, { from: 'system' });

    expect(events).toHaveLength(0);
  });

  test('self-wake prevention: agent does not wake from its own messages', () => {
    const card = registry.register({
      name: 'self-agent',
      description: '',
      capabilities: [],
      wakePatterns: ['test.>'],
    });
    registry.updateStatus(card.id, 'offline');

    const events: WakeEvent[] = [];
    wake.on('wake', (event) => events.push(event));

    // Publish from the agent's own ID
    bus.publish('test.event', {}, { from: card.id });
    expect(events).toHaveLength(0);

    // Publish from the agent's own name
    bus.publish('test.event', {}, { from: 'self-agent' });
    expect(events).toHaveLength(0);
  });

  test('reply, heartbeat, and wake message types do not trigger wake', () => {
    const card = registry.register({
      name: 'sleeping-agent',
      description: '',
      capabilities: [],
      wakePatterns: ['test.>'],
    });
    registry.updateStatus(card.id, 'offline');

    const events: WakeEvent[] = [];
    wake.on('wake', (event) => events.push(event));

    bus.publish('test.event', {}, { from: 'other', type: 'reply' });
    bus.publish('test.event', {}, { from: 'other', type: 'heartbeat' });
    bus.publish('test.event', {}, { from: 'other', type: 'wake' });

    expect(events).toHaveLength(0);
  });

  test('manual wake works', async () => {
    const card = registry.register({
      name: 'manual-agent',
      description: '',
      capabilities: [],
    });
    registry.updateStatus(card.id, 'offline');

    const event = await wake.wake('manual-agent', 'Test reason');

    expect(event.agentName).toBe('manual-agent');
    expect(event.reason).toBe('Test reason');
    expect(registry.get(card.id)!.status).toBe('online');
  });

  test('manual wake throws for unknown agent', async () => {
    await expect(wake.wake('unknown-agent', 'reason')).rejects.toThrow(/not found/);
  });

  test('wake handler is invoked', async () => {
    const card = registry.register({
      name: 'handler-agent',
      description: '',
      capabilities: [],
      wakePatterns: ['test.>'],
    });
    registry.updateStatus(card.id, 'offline');

    let handlerCalled = false;
    wake.onWake(card.id, async (_agent, _event) => {
      handlerCalled = true;
    });

    bus.publish('test.event', {}, { from: 'other' });

    await new Promise((r) => setTimeout(r, 50));
    expect(handlerCalled).toBe(true);
  });

  test('removeHandler stops handler invocation', async () => {
    const card = registry.register({
      name: 'rm-handler',
      description: '',
      capabilities: [],
    });

    let called = false;
    wake.onWake(card.id, async () => { called = true; });
    wake.removeHandler(card.id);

    await wake.wake('rm-handler', 'test');
    expect(called).toBe(false);
  });

  test('wake log records events', async () => {
    const card = registry.register({
      name: 'log-agent',
      description: '',
      capabilities: [],
    });
    registry.updateStatus(card.id, 'offline');

    await wake.wake('log-agent', 'reason-1');
    registry.updateStatus(card.id, 'offline');
    await wake.wake('log-agent', 'reason-2');

    const log = wake.getLog();
    expect(log).toHaveLength(2);

    const agentLog = wake.getLog(card.id);
    expect(agentLog).toHaveLength(2);
  });

  test('stop prevents further wake events', () => {
    const card = registry.register({
      name: 'stop-agent',
      description: '',
      capabilities: [],
      wakePatterns: ['test.>'],
    });
    registry.updateStatus(card.id, 'offline');

    wake.stop();

    const events: WakeEvent[] = [];
    wake.on('wake', (event) => events.push(event));

    bus.publish('test.event', {}, { from: 'other' });
    expect(events).toHaveLength(0);
  });

  test('woken agent status changes to online', async () => {
    const card = registry.register({
      name: 'status-agent',
      description: '',
      capabilities: [],
      wakePatterns: ['test.>'],
    });
    registry.updateStatus(card.id, 'offline');

    bus.publish('test.event', {}, { from: 'other' });

    await new Promise((r) => setTimeout(r, 10));
    expect(registry.get(card.id)!.status).toBe('online');
  });
});
