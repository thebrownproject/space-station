import { AgentRegistry, subjectMatches, validateSubject, validateAgentName } from '../registry.js';

// --- subjectMatches ---

describe('subjectMatches', () => {
  test('exact match', () => {
    expect(subjectMatches('billing.invoice.created', 'billing.invoice.created')).toBe(true);
  });

  test('no match on different subjects', () => {
    expect(subjectMatches('billing.invoice.created', 'billing.invoice.deleted')).toBe(false);
  });

  test('* matches single token', () => {
    expect(subjectMatches('billing.invoice', 'billing.*')).toBe(true);
  });

  test('* does not match multiple tokens', () => {
    expect(subjectMatches('billing.invoice.created', 'billing.*')).toBe(false);
  });

  test('* in middle position', () => {
    expect(subjectMatches('billing.invoice.created', 'billing.*.created')).toBe(true);
    expect(subjectMatches('billing.payment.created', 'billing.*.created')).toBe(true);
    expect(subjectMatches('billing.invoice.deleted', 'billing.*.created')).toBe(false);
  });

  test('> matches one or more tokens', () => {
    expect(subjectMatches('billing.invoice.created', 'billing.>')).toBe(true);
    expect(subjectMatches('billing.invoice', 'billing.>')).toBe(true);
    expect(subjectMatches('billing.a.b.c.d', 'billing.>')).toBe(true);
  });

  test('> requires at least one token after prefix', () => {
    expect(subjectMatches('billing', 'billing.>')).toBe(false);
  });

  test('> must be last token', () => {
    expect(subjectMatches('billing.invoice.created', 'billing.>.created')).toBe(false);
  });

  test('empty strings return false', () => {
    expect(subjectMatches('', 'billing.*')).toBe(false);
    expect(subjectMatches('billing.invoice', '')).toBe(false);
    expect(subjectMatches('', '')).toBe(false);
  });

  test('empty tokens (consecutive dots) return false', () => {
    expect(subjectMatches('billing..invoice', 'billing.*.invoice')).toBe(false);
    expect(subjectMatches('billing.invoice', 'billing..invoice')).toBe(false);
  });

  test('leading or trailing dots return false', () => {
    expect(subjectMatches('.billing', '*')).toBe(false);
    expect(subjectMatches('billing.', '*')).toBe(false);
  });

  test('single token match', () => {
    expect(subjectMatches('billing', 'billing')).toBe(true);
    expect(subjectMatches('billing', '*')).toBe(true);
    expect(subjectMatches('billing', '>')).toBe(true);
  });
});

// --- validateSubject ---

describe('validateSubject', () => {
  test('valid subjects pass', () => {
    expect(validateSubject('billing.invoice.created')).toBeUndefined();
    expect(validateSubject('a')).toBeUndefined();
    expect(validateSubject('a.b.c.d.e')).toBeUndefined();
  });

  test('empty subject is rejected', () => {
    expect(validateSubject('')).toBeDefined();
  });

  test('leading dot is rejected', () => {
    expect(validateSubject('.billing')).toBeDefined();
  });

  test('trailing dot is rejected', () => {
    expect(validateSubject('billing.')).toBeDefined();
  });

  test('consecutive dots are rejected', () => {
    expect(validateSubject('billing..invoice')).toBeDefined();
  });

  test('wildcards rejected when not allowed', () => {
    expect(validateSubject('billing.*', false)).toBeDefined();
    expect(validateSubject('billing.>', false)).toBeDefined();
  });

  test('wildcards accepted when allowed', () => {
    expect(validateSubject('billing.*', true)).toBeUndefined();
    expect(validateSubject('billing.>', true)).toBeUndefined();
    expect(validateSubject('billing.*.created', true)).toBeUndefined();
  });

  test('> not as last token is rejected even when wildcards allowed', () => {
    expect(validateSubject('billing.>.created', true)).toBeDefined();
  });
});

// --- validateAgentName ---

describe('validateAgentName', () => {
  test('valid names pass', () => {
    expect(validateAgentName('billing-agent')).toBeUndefined();
    expect(validateAgentName('MyAgent123')).toBeUndefined();
  });

  test('empty name is rejected', () => {
    expect(validateAgentName('')).toBeDefined();
    expect(validateAgentName('   ')).toBeDefined();
  });

  test('name with dots is rejected', () => {
    expect(validateAgentName('billing.agent')).toBeDefined();
  });

  test('name with colons is rejected', () => {
    expect(validateAgentName('billing:agent')).toBeDefined();
  });
});

// --- AgentRegistry ---

describe('AgentRegistry', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  test('register creates an agent card', () => {
    const card = registry.register({
      name: 'test-agent',
      description: 'A test agent',
      capabilities: ['test'],
      wakePatterns: ['test.>'],
    });

    expect(card.id).toBeDefined();
    expect(card.name).toBe('test-agent');
    expect(card.status).toBe('online');
    expect(card.capabilities).toHaveLength(1);
    expect(card.capabilities[0].name).toBe('test');
    expect(card.wakePatterns).toEqual(['test.>']);
  });

  test('register rejects duplicate names', () => {
    registry.register({ name: 'agent-a', description: '', capabilities: [] });
    expect(() =>
      registry.register({ name: 'agent-a', description: '', capabilities: [] }),
    ).toThrow(/already registered/);
  });

  test('register validates agent name', () => {
    expect(() =>
      registry.register({ name: 'bad.name', description: '', capabilities: [] }),
    ).toThrow(/dots/);
  });

  test('register validates wake patterns', () => {
    expect(() =>
      registry.register({
        name: 'agent',
        description: '',
        capabilities: [],
        wakePatterns: ['billing.>.invalid'],
      }),
    ).toThrow(/must be the last token/);
  });

  test('unregister removes an agent', () => {
    const card = registry.register({ name: 'agent-rm', description: '', capabilities: [] });
    expect(registry.unregister(card.id)).toBe(true);
    expect(registry.get(card.id)).toBeUndefined();
  });

  test('unregister by name works', () => {
    registry.register({ name: 'agent-rm', description: '', capabilities: [] });
    expect(registry.unregister('agent-rm')).toBe(true);
  });

  test('resolve by ID and name', () => {
    const card = registry.register({ name: 'finder', description: '', capabilities: [] });
    expect(registry.resolve(card.id)?.name).toBe('finder');
    expect(registry.resolve('finder')?.id).toBe(card.id);
  });

  test('findByCapability returns matching agents', () => {
    registry.register({ name: 'a', description: '', capabilities: ['billing'] });
    registry.register({ name: 'b', description: '', capabilities: ['shipping'] });
    registry.register({ name: 'c', description: '', capabilities: ['billing', 'refund'] });

    const results = registry.findByCapability('billing');
    expect(results).toHaveLength(2);
    expect(results.map((a) => a.name).sort()).toEqual(['a', 'c']);
  });

  test('search across name, description, capabilities', () => {
    registry.register({ name: 'billing-agent', description: 'Handles invoices', capabilities: ['invoice'] });
    registry.register({ name: 'shipping-agent', description: 'Handles shipping', capabilities: ['tracking'] });

    expect(registry.search('invoice')).toHaveLength(1);
    expect(registry.search('billing')).toHaveLength(1);
    expect(registry.search('Handles')).toHaveLength(2);
  });

  test('list with status filter', () => {
    const a = registry.register({ name: 'a', description: '', capabilities: [] });
    registry.register({ name: 'b', description: '', capabilities: [] });
    registry.updateStatus(a.id, 'offline');

    expect(registry.list()).toHaveLength(2);
    expect(registry.list('online')).toHaveLength(1);
    expect(registry.list('offline')).toHaveLength(1);
  });

  test('update modifies agent fields', () => {
    const card = registry.register({ name: 'upd', description: 'old', capabilities: [] });
    registry.update(card.id, { description: 'new', version: '2.0.0' });

    const updated = registry.get(card.id)!;
    expect(updated.description).toBe('new');
    expect(updated.version).toBe('2.0.0');
  });

  test('heartbeat updates lastSeenAt and brings offline agents online', async () => {
    const card = registry.register({ name: 'hb', description: '', capabilities: [] });
    registry.updateStatus(card.id, 'offline');

    const before = registry.get(card.id)!.lastSeenAt;
    // Small delay to ensure timestamp difference
    await new Promise((r) => setTimeout(r, 5));
    registry.heartbeat(card.id);

    const after = registry.get(card.id)!;
    expect(after.status).toBe('online');
    expect(new Date(after.lastSeenAt).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });

  test('findByWakePattern returns agents whose patterns match', () => {
    registry.register({ name: 'a', description: '', capabilities: [], wakePatterns: ['billing.>'] });
    registry.register({ name: 'b', description: '', capabilities: [], wakePatterns: ['shipping.*'] });

    const matches = registry.findByWakePattern('billing.invoice.created');
    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe('a');
  });

  test('export and import round-trip', () => {
    registry.register({ name: 'a', description: 'desc-a', capabilities: ['c1'] });
    registry.register({ name: 'b', description: 'desc-b', capabilities: ['c2'] });

    const exported = registry.export();
    expect(exported).toHaveLength(2);

    const newRegistry = new AgentRegistry();
    newRegistry.import(exported);
    expect(newRegistry.list()).toHaveLength(2);

    // Imported agents should be offline
    for (const agent of newRegistry.list()) {
      expect(agent.status).toBe('offline');
    }
  });

  test('import skips duplicates by name', () => {
    registry.register({ name: 'existing', description: '', capabilities: [] });
    const otherRegistry = new AgentRegistry();
    otherRegistry.register({ name: 'existing', description: 'other', capabilities: [] });

    registry.import(otherRegistry.export());
    // Should still have only 1 agent named 'existing'
    expect(registry.search('existing')).toHaveLength(1);
  });

  test('stats counts by status', () => {
    const a = registry.register({ name: 'a', description: '', capabilities: [] });
    registry.register({ name: 'b', description: '', capabilities: [] });
    registry.updateStatus(a.id, 'busy');

    const stats = registry.stats();
    expect(stats.total).toBe(2);
    expect(stats.byStatus.busy).toBe(1);
    expect(stats.byStatus.online).toBe(1);
  });
});
