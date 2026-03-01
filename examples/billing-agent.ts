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
