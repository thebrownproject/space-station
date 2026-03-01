/**
 * Example: Billing Agent
 *
 * Demonstrates how to build an agent using the AgentBuilder SDK.
 * This agent handles billing-related events and can respond to
 * direct questions via the `agentbus ask` command.
 *
 * Run with: npx tsx examples/billing-agent.ts
 */

import { AgentBuilder } from '../src/sdk/index.js';

const agent = new AgentBuilder('billing-agent')
  .description('Handles invoices, refunds, and payment status queries')
  .version('1.0.0')
  .capabilities(['invoice', 'refund', 'payment-status'])
  .wakeOn(['billing.>', 'payment.>'])

  // Handle invoice creation
  .onMessage('billing.invoice.create', async (msg, ctx) => {
    const { customerId, amount } = msg.payload as { customerId: string; amount: number };
    console.log(`[billing] Creating invoice for ${customerId}: $${amount}`);

    ctx.memory.set(`invoice:${customerId}`, {
      amount,
      status: 'created',
      createdAt: new Date().toISOString(),
    }, { tags: ['invoice', customerId] });

    if (msg.replyTo) {
      ctx.reply(msg, { success: true, invoiceId: `INV-${Date.now()}` });
    }
  })

  // Handle invoice status queries
  .onMessage('billing.invoice.status', async (msg, ctx) => {
    const { invoiceId } = msg.payload as { invoiceId: string };
    console.log(`[billing] Looking up invoice: ${invoiceId}`);

    const invoice = ctx.memory.get(invoiceId, 'shared');
    if (msg.replyTo) {
      ctx.reply(msg, invoice?.value ?? { error: 'Not found' });
    }
  })

  // Handle payment processing
  .onMessage('payment.process', async (msg, ctx) => {
    const { invoiceId, method } = msg.payload as { invoiceId: string; method: string };
    console.log(`[billing] Processing payment for ${invoiceId} via ${method}`);

    if (msg.replyTo) {
      ctx.reply(msg, { success: true, transactionId: `TXN-${Date.now()}` });
    }
  })

  // Handle direct questions from `agentbus ask`
  .onMessage('_ask.billing-agent', async (msg, ctx) => {
    const { message } = msg.payload as { message: string };
    console.log(`[billing] Received question: ${message}`);

    ctx.reply(msg, {
      response: `Billing agent received your question: "${message}". I handle invoices, refunds, and payment status.`,
    });
  })

  .onWake(async (event, _ctx) => {
    console.log(`[billing] Woke up: ${event.reason}`);
  })

  .build();

// --- Start the agent ---

async function main() {
  const card = await agent.start();
  console.log(`Billing agent started (id: ${card.id})`);
  console.log(`Listening for billing.> and payment.> events...`);
  console.log('Press Ctrl+C to stop.\n');

  // Keep alive
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await agent.stop();
    process.exit(0);
  });
}

main().catch(console.error);
