# AgentBus

**Agent Message Bus** — discover, communicate, wake, and remember across heterogeneous AI agents.

AgentBus is a CLI-first platform where dozens or hundreds of enterprise agents can discover each other, communicate asynchronously, wake each other up via events, and share persistent context. Think "Slack for agents" with a CLI as the primary interface.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                   AgentBus Platform                   │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌────────┐  ┌───────┐ │
│  │ Registry │  │   Bus    │  │ Memory │  │ Wake  │ │
│  │          │  │ (pub/sub │  │ (shared│  │ (event│ │
│  │ Agent    │  │  req/rep │  │  state)│  │  wake)│ │
│  │ Cards    │  │  queue)  │  │        │  │       │ │
│  └──────────┘  └──────────┘  └────────┘  └───────┘ │
│                                                      │
│  ┌──────────────────────┐  ┌───────────────────────┐ │
│  │         CLI          │  │         SDK           │ │
│  │  agentbus ls/emit/   │  │  AgentBuilder API     │ │
│  │  ask/wake/memory     │  │  for building agents  │ │
│  └──────────────────────┘  └───────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Register an agent
agentbus register \
  --name "billing-agent" \
  --description "Handles invoices and payments" \
  --capabilities "invoice,refund,payment-status" \
  --wake-on "billing.*"

# List agents
agentbus ls

# Publish an event
agentbus emit billing.invoice.created --payload '{"customer_id": "123", "amount": 99.99}'

# Wake an agent manually
agentbus wake billing-agent --reason "anomaly detected"

# Store shared memory
agentbus memory set "customer:123:plan" '"Enterprise"' --tags customer,plan

# Search memory
agentbus memory search "customer 123"

# Check platform status
agentbus status
```

## Core Concepts

### Agent Registry
Every agent registers an "Agent Card" describing its capabilities, endpoints, and wake conditions. Other agents query the registry to find who can help with what.

### Message Bus
NATS-style subject-based routing with support for:
- **Pub/Sub** — Broadcast events to all interested agents
- **Request/Reply** — Ask an agent a question and wait for an answer
- **Queue Groups** — Load-balance messages across agent instances
- **Message History** — Query past messages for replay/audit

Subject wildcards follow NATS conventions:
- `*` matches a single token (`billing.*` matches `billing.invoice` but not `billing.invoice.created`)
- `>` matches one or more tokens (`billing.>` matches `billing.invoice` and `billing.invoice.created`)

### Wake System
Agents subscribe to subject patterns via `wakePatterns`. When a matching event fires on the bus, sleeping agents are automatically woken up.

### Shared Memory
Three scopes of memory:
- **agent** — Private to a single agent
- **shared** — Visible to all agents (cross-agent facts)
- **session** — Ephemeral, tied to a specific workflow

## Building Agents with the SDK

```typescript
import { AgentBuilder } from '@agentbus/core';

const agent = new AgentBuilder('billing-agent')
  .description('Handles all billing operations')
  .capabilities(['invoice', 'refund', 'payment-status'])
  .wakeOn(['billing.>'])
  .onMessage('billing.invoice.create', async (msg, ctx) => {
    // Process the invoice
    const result = await processInvoice(msg.payload);

    // Store in shared memory
    ctx.memory.set('last-invoice', result, { tags: ['invoice'] });

    // Notify other agents
    ctx.emit('audit.event', { action: 'invoice_created' });

    // Reply if this was a request
    if (msg.headers?.['reply-to']) {
      ctx.reply(msg, { success: true });
    }
  })
  .onWake(async (event, ctx) => {
    console.log(`Woke up: ${event.reason}`);
  })
  .build();

await agent.start();
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `agentbus ls` | List all registered agents |
| `agentbus register` | Register a new agent |
| `agentbus unregister <name>` | Remove an agent |
| `agentbus info <name>` | Show agent details |
| `agentbus search <query>` | Search agents by text/capability |
| `agentbus emit <subject>` | Publish an event |
| `agentbus ask <agent> <msg>` | Send a request and wait for reply |
| `agentbus subscribe <subject>` | Subscribe and print messages |
| `agentbus logs` | Show message history |
| `agentbus wake <agent>` | Manually wake an agent |
| `agentbus wake-log` | Show wake event history |
| `agentbus memory set` | Store a value |
| `agentbus memory get` | Retrieve a value |
| `agentbus memory search` | Search memory |
| `agentbus memory delete` | Delete a value |
| `agentbus memory stats` | Show memory statistics |
| `agentbus status` | Show platform status |

All commands support `--json` for machine-readable output.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Message Bus | In-memory (NATS-compatible API) → swap to real NATS for production |
| Agent Registry | In-memory → swap to Supabase Postgres |
| Memory Layer | In-memory → swap to Supabase pgvector |
| CLI | Commander.js (TypeScript) |
| Agent SDK | TypeScript |

## Project Structure

```
src/
├── types/          # Core type definitions (AgentCard, BusMessage, MemoryEntry)
├── registry/       # Agent registry (register, discover, search)
├── bus/            # Message bus (pub/sub, request/reply, queue groups)
├── memory/         # Shared memory store (agent, shared, session scopes)
├── wake/           # Wake/event system (pattern matching, wake handlers)
├── sdk/            # AgentBuilder SDK for creating agents
├── cli/            # CLI commands (agentbus)
├── config/         # Configuration management
├── platform.ts     # Platform kernel (ties everything together)
└── index.ts        # Public API exports
examples/
├── billing-agent.ts      # Simple single-agent example
└── multi-agent-demo.ts   # Multi-agent communication demo
```

## License

MIT
