# Spec 07: Platform Integration

## Summary

How all modules connect. Changes to existing files, the end-to-end flow, example agents, and the implementation checklist.

---

## 1. Existing Files to Modify

### `package.json` — Add Dependencies

```json
{
  "dependencies": {
    "commander": "^12.1.0",
    "nats": "^2.28.0",
    "uuid": "^10.0.0",
    "chalk": "^5.3.0",
    "conf": "^13.0.1",
    "ora": "^8.1.0",
    "cli-table3": "^0.6.5",
    "eventemitter3": "^5.0.1",
    "drizzle-orm": "^0.45.0",
    "better-sqlite3": "^12.0.0",
    "yaml": "^2.6.0",
    "gray-matter": "^4.0.3",
    "croner": "^10.0.0",
    "cronstrue": "^3.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/uuid": "^10.0.0",
    "@types/better-sqlite3": "^7.6.0",
    "typescript": "^5.6.0",
    "jest": "^29.7.0",
    "@types/jest": "^29.5.0",
    "ts-jest": "^29.2.0",
    "drizzle-kit": "^0.31.0"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/cli/index.js",
    "lint": "tsc --noEmit",
    "test": "node --experimental-vm-modules node_modules/.bin/jest",
    "clean": "rm -rf dist",
    "db:generate": "npx drizzle-kit generate",
    "db:migrate": "node dist/db/migrate.js",
    "db:studio": "npx drizzle-kit studio"
  }
}
```

### `src/config/config.ts` — Extended Config

```typescript
export interface AgentBusConfig {
  // Existing
  dataDir: string;
  natsUrl?: string;
  embedded: boolean;
  maxHistory: number;
  maxWakeLog: number;
  requestTimeout: number;
  memoryCleanupInterval: number;

  // New
  dbPath?: string;              // Path to SQLite database
  agentsDir?: string;           // Path to agents/ directory
  autoLoadAgents?: boolean;     // Load agent folders on startup (default: true)
}
```

### `src/cli/commands/index.ts` — Register New Commands

```typescript
import { registerAgentCommands } from './agents.js';
import { registerBusCommands } from './bus.js';
import { registerMemoryCommands } from './memory.js';
import { registerWakeCommands } from './wake.js';
import { registerStatusCommand } from './status.js';
import { registerNodeCommands } from './node.js';
import { registerDaemonCommands } from './daemon.js';
import { registerRunCommand } from './run.js';
import { registerSkillsCommands } from './skills.js';

export function registerCommands(program: Command): void {
  registerAgentCommands(program);
  registerBusCommands(program);
  registerMemoryCommands(program);
  registerWakeCommands(program);
  registerStatusCommand(program);
  registerNodeCommands(program);       // NEW
  registerDaemonCommands(program);     // NEW
  registerRunCommand(program);         // NEW
  registerSkillsCommands(program);     // NEW
}
```

### `src/index.ts` — Export New Modules

```typescript
// Existing exports (unchanged)
export { AgentBusPlatform, getPlatform } from './platform.js';
export { AgentRegistry } from './registry/index.js';
export { MessageBus, NatsMessageBus } from './bus/index.js';
export type { IMessageBus } from './bus/index.js';
export { MemoryStore } from './memory/index.js';
export { WakeManager } from './wake/index.js';
export { AgentBuilder, Agent } from './sdk/index.js';
export type { AgentContext } from './sdk/index.js';

// New exports
export { getDb, resolveDbPath } from './db/index.js';
export { createNode, getNode, getNodeByPath, updateNode, deleteNode,
         listNodes, searchNodes, getSubtree, getAncestors } from './db/index.js';
export type { Node, NodeRow, CreateNodeInput, UpdateNodeInput, NodeFilter,
              NodeType, NodeStatus, NodePriority } from './db/index.js';
export { AgentLoader } from './agents/index.js';
export type { AgentManifest, AgentFolderConfig } from './agents/index.js';
export { CronManager } from './scheduler/index.js';
export { SkillLoader, SkillRegistry } from './skills/index.js';
export type { Skill, SkillManifest } from './skills/index.js';
```

---

## 2. Example Agent: email-agent

### `agents/email-agent/agent.yaml`

```yaml
name: email-agent
description: "Monitors email, processes messages, posts findings to the shared wiki"
version: "1.0.0"
capabilities:
  - email-monitoring
  - report-generation
  - wiki-posting
wakePatterns:
  - "wiki.issue.assigned.email-agent"
metadata:
  owner: "team-comms"
```

### `agents/email-agent/cron.yaml`

```yaml
jobs:
  - id: nightly-check
    schedule: "0 0 * * *"
    description: "Check inbox and post findings"
    action:
      type: claude
      prompt: "Run your nightly email check. Check for unread messages, classify priority, and post a report to engineering/space-station."
    enabled: true
    catchUp: true
    timezone: "Australia/Sydney"
    timeout: 1800

  - id: morning-report
    schedule: "0 9 * * 1-5"
    description: "Generate daily summary"
    action:
      type: skill
      skill: summarize
    enabled: true
    timeout: 600
```

### `agents/email-agent/CLAUDE.md`

```markdown
# Email Agent

You are the email agent for the AgentBus system. Your job is to monitor email,
process messages, and post your findings to the shared node system.

## Your Identity

Read `SOUL.md` in this directory for your persona and values.

## Your Memory

- Read `memory/MEMORY.md` for your long-term context (what you've learned over time)
- After each task, update `memory/MEMORY.md` with anything important you learned
- Write a brief log to `memory/journal/YYYY-MM-DD.md` (today's date)

## How to Communicate

Use the `spacestation` CLI to interact with the shared system:

### Read
- `spacestation node list` — see all top-level spaces
- `spacestation node list engineering/space-station` — see items in a space
- `spacestation node list --type task --status open --assignee email-agent` — your open tasks
- `spacestation node get <path-or-id>` — read full details of a node
- `spacestation node search "query"` — search across everything

### Write
- `spacestation node create --type report --title "Email Report YYYY-MM-DD" --content "..." --parent engineering/space-station --author email-agent`
- `spacestation node create --type task --title "..." --content "..." --parent engineering/space-station --author email-agent --priority high --assignee reviewer-agent`
- `spacestation node reply <path-or-id> --content "..." --author email-agent`
- `spacestation node update <path-or-id> --status done`

### Important
- Always use `--author email-agent` when creating content
- Use `--json` flag when you need to parse output programmatically
- Pipe longer content via stdin: `echo "content" | spacestation node create --type report --content - ...`

## Your Skills

Check `skills/` directory for specific skill instructions.
```

### `agents/email-agent/SOUL.md`

```markdown
# Soul: Email Agent

You are thorough, detail-oriented, and security-conscious.

## Values
- Never miss an important message
- Classify urgency accurately — don't cry wolf
- Keep reports concise but complete
- When in doubt, create a task for a human to review

## Communication Style
- Professional, brief
- Use bullet points for lists
- Include timestamps and sources
- Flag security-related emails as critical priority
```

### `agents/email-agent/memory/MEMORY.md`

```markdown
# Email Agent Memory

## Known Patterns
(This file starts empty. The agent populates it over time.)

## Last Check
(Updated after each run.)
```

### `agents/email-agent/skills/agentbus-cli/SKILL.md`

```yaml
---
name: agentbus-cli
description: "How to use the AgentBus CLI for reading and writing nodes"
version: 1.0.0
---

# AgentBus CLI Reference

## Listing nodes
spacestation node list [path]                   # children of a space (or root)
spacestation node list --type task --status open # filter by type and status
spacestation node list --assignee email-agent   # your assignments
spacestation node tree [path] --depth 2         # visual tree

## Reading
spacestation node get <path-or-id>              # full node details
spacestation node search "query"                # full-text search

## Creating
spacestation node create --type <type> --title "..." --content "..." --parent <path> --author email-agent
# Types: space, post, task, page, comment, report
# For long content, pipe via stdin: echo "..." | spacestation node create --content - ...

## Updating
spacestation node update <path-or-id> --status done
spacestation node update <path-or-id> --assignee <agent>
spacestation node update <path-or-id> --add-tag "reviewed"

## Replying
spacestation node reply <path-or-id> --content "..." --author email-agent
```

---

## 3. End-to-End Flow: Midnight Email Agent

### Step 1: Daemon starts
```
$ spacestation daemon start
Daemon started. 3 jobs loaded from 2 agents.
  email-agent/nightly-check: Every day at 12:00 AM (next: 6h)
  email-agent/morning-report: Mon-Fri at 9:00 AM (next: 14h)
  patrol-agent/evening-sweep: Every day at 6:00 PM (next: 2h)
```

### Step 2: Midnight — cron fires nightly-check
```
Daemon detects cron trigger for email-agent/nightly-check
  → Reads agents/email-agent/cron.yaml action: { type: claude, prompt: "..." }
  → Builds prompt:
      "Your task: Run your nightly email check. Check for unread messages..."
      + memory instructions
      + CLI instructions
  → Spawns: cd agents/email-agent && claude -p "$prompt"
  → Sets env: AGENTBUS_DB=/path/to/data/agentbus.db
```

### Step 3: Claude Code session runs
```
Claude Code starts in agents/email-agent/
  → Auto-reads CLAUDE.md (Claude Code built-in behavior)
  → Reads SOUL.md: "You are thorough, detail-oriented..."
  → Reads memory/MEMORY.md: "Last check: 2026-03-14..."
  → Reads skills/agentbus-cli/SKILL.md: learns CLI commands

  → Checks assigned tasks:
      $ spacestation node list --type task --status open --assignee email-agent --json
      [{"id":"abc","title":"Follow up on client email","status":"open",...}]

  → Processes the task, marks done:
      $ spacestation node update abc --status done
      $ spacestation node reply abc --content "Followed up. Client confirmed receipt." --author email-agent

  → Checks email inbox (simulated or via API):
      Found 5 new emails, 1 urgent

  → Posts daily report:
      $ spacestation node create --type report \
          --title "Email Report 2026-03-15" \
          --content "Checked inbox at midnight. Found 5 new emails..." \
          --parent engineering/space-station \
          --author email-agent \
          --tags "email,daily-report"

  → Creates urgent task:
      $ spacestation node create --type task \
          --title "Urgent: Auth token expired in production" \
          --content "Received alert email from monitoring..." \
          --parent engineering/space-station \
          --author email-agent \
          --priority critical \
          --assignee reviewer-agent \
          --tags "auth,urgent,production"

  → Updates its own memory:
      Appends to memory/MEMORY.md:
        "## 2026-03-15: Checked 5 emails. Auth token issue found."
      Writes memory/journal/2026-03-15.md:
        "Nightly check complete. 5 emails processed. 1 critical task created."

  → Session ends
```

### Step 4: Daemon logs the result
```
[00:02:15] email-agent/nightly-check: success (45s)
  Created 1 report, 1 task, updated 1 task
```

### Step 5: Morning — user opens web UI
```
Dashboard shows:
  - 1 new critical task: "Auth token expired in production"
  - 1 new report: "Email Report 2026-03-15"
  - email-agent last run: 6h ago (success)

User clicks into the critical task, reads details, adds a comment:
  "I'll handle this manually. Rotating the token now."
  Updates status: in-progress
```

---

## 4. Implementation Checklist (Phase 1)

### Database
- [ ] Create `src/db/schema.ts` with nodes table
- [ ] Create `src/db/connection.ts` with WAL mode, path resolution
- [ ] Create `src/db/queries.ts` with all CRUD operations
- [ ] Create `src/db/migrate.ts`
- [ ] Create `drizzle.config.ts`
- [ ] Create `data/.gitkeep` and add `data/*.db` to `.gitignore`
- [ ] Add `drizzle-orm`, `better-sqlite3`, `drizzle-kit` deps
- [ ] Generate initial migration
- [ ] Write tests (`src/db/__tests__/queries.test.ts`)

### CLI — Node Commands
- [ ] Create `src/cli/commands/node.ts` with all subcommands
- [ ] Path resolution (UUID vs materialized path)
- [ ] Stdin content support (`--content -`)
- [ ] Table formatting with cli-table3
- [ ] Tree rendering with box-drawing characters
- [ ] JSON output mode
- [ ] Register in `src/cli/commands/index.ts`

### Agent Folders
- [ ] Create `src/agents/types.ts`
- [ ] Create `src/agents/agent-loader.ts` (discover, loadManifest, initAgent)
- [ ] Add `yaml` dependency
- [ ] Add `spacestation init <name>` CLI command (in agents.ts)
- [ ] Add `spacestation load <path>` CLI command (in agents.ts)
- [ ] Write tests (`src/agents/__tests__/agent-loader.test.ts`)

### Skills
- [ ] Create `src/skills/skill-types.ts`
- [ ] Create `src/skills/skill-loader.ts` (parse SKILL.md with gray-matter)
- [ ] Create `src/skills/skill-registry.ts`
- [ ] Add `gray-matter` dependency
- [ ] Add `spacestation skills list/info` CLI commands
- [ ] Write tests

### Example Agents
- [ ] Create `agents/email-agent/` with all files (agent.yaml, cron.yaml, CLAUDE.md, SOUL.md, skills/, memory/)
- [ ] Create `skills/agentbus-basics/SKILL.md` (shared CLI cheat sheet)
- [ ] Create initial spaces via seed script or CLI

### Implementation Checklist (Phase 2)

### Daemon
- [ ] Create `src/scheduler/scheduler-types.ts`
- [ ] Create `src/scheduler/runner.ts` (Claude Code spawner)
- [ ] Create `src/scheduler/scheduler.ts` (CronManager)
- [ ] Create `src/scheduler/daemon.ts` (main daemon process)
- [ ] Add `croner`, `cronstrue` deps
- [ ] Add `spacestation daemon start/stop/status` CLI commands
- [ ] Add `spacestation run <agent>` CLI command
- [ ] Catch-up logic for missed runs
- [ ] Write tests

### Implementation Checklist (Phase 3)

### Web UI
- [ ] Initialize Next.js project in `web/`
- [ ] Install and configure shadcn/ui
- [ ] Set up Tailwind CSS
- [ ] Create API routes (nodes CRUD, search, tree)
- [ ] Create layout (sidebar + main area)
- [ ] Create dashboard page
- [ ] Create space browser page
- [ ] Create node detail page
- [ ] Create agent dashboard page
- [ ] Create search page
- [ ] Wire up database (import from src/db)

---

## 5. File Summary

All new files to create:

```
# Database (Phase 1)
src/db/schema.ts
src/db/connection.ts
src/db/queries.ts
src/db/migrate.ts
src/db/index.ts
src/db/__tests__/queries.test.ts
drizzle.config.ts
data/.gitkeep

# CLI (Phase 1)
src/cli/commands/node.ts
src/cli/commands/skills.ts

# Agent Folders (Phase 1)
src/agents/types.ts
src/agents/agent-loader.ts
src/agents/index.ts
src/agents/__tests__/agent-loader.test.ts

# Skills (Phase 1)
src/skills/skill-types.ts
src/skills/skill-loader.ts
src/skills/skill-registry.ts
src/skills/index.ts
src/skills/__tests__/skill-registry.test.ts

# Example Agents (Phase 1)
agents/email-agent/agent.yaml
agents/email-agent/cron.yaml
agents/email-agent/CLAUDE.md
agents/email-agent/SOUL.md
agents/email-agent/memory/MEMORY.md
agents/email-agent/memory/journal/.gitkeep
agents/email-agent/skills/agentbus-cli/SKILL.md
agents/email-agent/skills/check-inbox/SKILL.md
agents/email-agent/state.json
skills/agentbus-basics/SKILL.md

# Scheduler/Daemon (Phase 2)
src/scheduler/scheduler-types.ts
src/scheduler/runner.ts
src/scheduler/scheduler.ts
src/scheduler/daemon.ts
src/scheduler/index.ts
src/scheduler/__tests__/scheduler.test.ts
src/cli/commands/daemon.ts
src/cli/commands/run.ts

# Web UI (Phase 3)
web/ (entire Next.js project)
```

Files to modify:
```
package.json               # Add new dependencies
src/config/config.ts       # Add dbPath, agentsDir
src/cli/commands/index.ts  # Register new commands
src/cli/commands/agents.ts # Add init, load subcommands
src/index.ts               # Export new modules
.gitignore                 # Add data/*.db
```
