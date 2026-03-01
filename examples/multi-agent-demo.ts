/**
 * Example: Multi-Agent Demo
 *
 * Demonstrates multiple agents communicating via the message bus,
 * waking each other up, and sharing memory.
 *
 * Run with: npx tsx examples/multi-agent-demo.ts
 */

import { AgentBusPlatform } from '../src/platform.js';
import { AgentBuilder } from '../src/sdk/index.js';

async function main() {
  // Create a fresh platform instance for this demo
  const platform = new AgentBusPlatform({ embedded: true });
  platform.start();

  // --- Agent 1: Billing ---
  const billingAgent = new AgentBuilder('billing')
    .description('Handles invoices and payments')
    .capabilities(['invoice', 'payment'])
    .wakeOn(['billing.>'])
    .onMessage('billing.invoice.create', async (msg, ctx) => {
      const payload = msg.payload as { customerId: string; amount: number };
      console.log(`[billing] Creating invoice for customer ${payload.customerId}: $${payload.amount}`);

      // Store in shared memory
      ctx.memory.set(`invoice:${payload.customerId}`, {
        amount: payload.amount,
        status: 'pending',
        createdAt: new Date().toISOString(),
      }, { tags: ['invoice', payload.customerId] });

      // Notify audit agent
      ctx.emit('audit.event', {
        action: 'invoice_created',
        customerId: payload.customerId,
        amount: payload.amount,
      });

      // Reply if this was a request
      if (msg.replyTo) {
        ctx.reply(msg, { success: true, invoiceId: `INV-${Date.now()}` });
      }
    })
    .onWake(async (event, ctx) => {
      console.log(`[billing] Woke up: ${event.reason}`);
    })
    .usePlatform(platform)
    .build();

  // --- Agent 2: Audit ---
  const auditAgent = new AgentBuilder('audit')
    .description('Logs and audits all financial events')
    .capabilities(['audit-log', 'compliance'])
    .wakeOn(['audit.>', 'billing.>'])
    .onMessage('audit.event', async (msg, ctx) => {
      const payload = msg.payload as { action: string; customerId: string };
      console.log(`[audit] Logged event: ${payload.action} for customer ${payload.customerId}`);

      // Store audit entry
      ctx.memory.set(`audit:${Date.now()}`, payload, {
        tags: ['audit', payload.action],
      });
    })
    .onWake(async (event, ctx) => {
      console.log(`[audit] Woke up: ${event.reason}`);
    })
    .usePlatform(platform)
    .build();

  // --- Agent 3: Notifications ---
  const notifyAgent = new AgentBuilder('notifications')
    .description('Sends customer notifications')
    .capabilities(['email', 'sms', 'push'])
    .wakeOn(['notify.>'])
    .onMessage('notify.send', async (msg, ctx) => {
      const payload = msg.payload as { to: string; channel: string; message: string };
      console.log(`[notifications] Sending ${payload.channel} to ${payload.to}: "${payload.message}"`);
    })
    .usePlatform(platform)
    .build();

  // --- Start all agents ---
  await billingAgent.start();
  await auditAgent.start();
  await notifyAgent.start();

  console.log('\n--- All agents started ---\n');

  // List all agents
  const agents = platform.registry.list();
  console.log('Registered agents:');
  for (const a of agents) {
    console.log(`  ${a.name} (${a.status}) - ${a.capabilities.map(c => c.name).join(', ')}`);
  }
  console.log('');

  // --- Simulate some activity ---

  // 1. Create an invoice (this will wake billing and audit agents)
  console.log('--- Publishing billing.invoice.create ---');
  platform.bus.publish('billing.invoice.create', {
    customerId: 'cust-123',
    amount: 99.99,
  }, { from: 'system' });

  // Small delay to let async handlers fire
  await new Promise((r) => setTimeout(r, 100));

  // 2. Send a notification
  console.log('\n--- Publishing notify.send ---');
  platform.bus.publish('notify.send', {
    to: 'cust-123',
    channel: 'email',
    message: 'Your invoice has been created.',
  }, { from: 'billing' });

  await new Promise((r) => setTimeout(r, 100));

  // 3. Check shared memory
  console.log('\n--- Shared Memory ---');
  const memories = platform.memory.query({ search: 'cust-123' });
  for (const m of memories) {
    console.log(`  ${m.key} = ${JSON.stringify(m.value)}`);
  }

  // 4. Check wake log
  console.log('\n--- Wake Log ---');
  const wakeEvents = platform.wake.getLog();
  for (const e of wakeEvents) {
    console.log(`  ${e.agentName}: ${e.reason}`);
  }

  // 5. Platform status
  console.log('\n--- Platform Status ---');
  const regStats = platform.registry.stats();
  const busStats = platform.bus.stats();
  const memStats = platform.memory.stats();
  console.log(`  Agents: ${regStats.total} (${regStats.byStatus.online} online)`);
  console.log(`  Messages: ${busStats.totalMessages}`);
  console.log(`  Memory entries: ${memStats.totalEntries}`);

  // Cleanup
  await billingAgent.stop();
  await auditAgent.stop();
  await notifyAgent.stop();
  await platform.shutdown();

  console.log('\n--- Demo complete ---');
}

main().catch(console.error);
