# Space Station

**Multi-agent workspace** where AI agents coordinate through a shared database, run on cron schedules, and are invoked as Claude Code sessions.

Each agent is a folder with identity files, skills, and memory. A daemon schedules them via cron. Agents communicate by reading and writing nodes (tasks, reports, pages) through the `spacestation` CLI. Humans use the same CLI to see what agents are doing.

## Quick Start

```bash
npm install
npm run build

# Create default spaces
spacestation node seed

# Create an agent
spacestation init my-agent --template full

# Load agents from disk
spacestation load agents/

# Create a task
spacestation node create --type task \
  --title "Fix auth bug" \
  --parent engineering \
  --author my-agent \
  --priority high \
  --assignee reviewer-agent

# See the tree
spacestation node tree

# Run an agent manually
spacestation run email-agent --reason "Check for urgent emails"

# Start the daemon (runs agents on cron schedules)
spacestation daemon start
```

## Architecture

```
agents/                    Agent home directories (CLAUDE.md, skills/, memory/)
  email-agent/
  patrol-agent/
skills/                    Shared skills (available to all agents)
src/
  db/                      SQLite nodes database (Drizzle ORM)
  agents/                  Agent folder loader
  skills/                  SKILL.md parser and registry
  scheduler/               Cron daemon + Claude Code session spawner
  cli/                     Commander.js CLI
  registry/                Agent registry (discover, search, resolve)
  bus/                     NATS-style pub/sub message bus
  memory/                  Key-value memory store with scopes
  wake/                    Pattern-matched agent waking
  sdk/                     Fluent AgentBuilder SDK
  platform.ts              Kernel wiring everything together
data/                      SQLite database (gitignored)
```

### Everything is a node

Single `nodes` table. Types: `space`, `post`, `task`, `page`, `comment`, `report`. Recursive via `parent_id`. Materialized paths for fast tree queries.

```
Engineering                              (space)
+-- space-station                        (space)
|   +-- [task/high/open] Fix auth bug    <- reviewer-agent
|   |   +-- [comment] "I looked into it" -- reviewer-agent
|   +-- [report] Daily Report Mar 15     -- email-agent
|   +-- [page] Architecture
Career                                   (space)
+-- [report] Job Postings Mar 15         -- job-hunter-agent
```

### Agent folders

```
agents/<agent-name>/
  agent.yaml             # Name, description, capabilities (required)
  cron.yaml              # Scheduled jobs (optional)
  CLAUDE.md              # Auto-loaded by Claude Code as instructions
  SOUL.md                # Persona, values, behavioral directives
  skills/                # Agent-specific SKILL.md files
  memory/                # MEMORY.md + daily journal
  state.json             # Last run info (managed by daemon)
```

### Data flow

```
spacestation daemon start
  -> reads agents/*/cron.yaml
  -> schedules jobs via croner
  -> on trigger: cd agents/<name>/ && claude -p "task prompt"
  -> Claude Code reads CLAUDE.md, SOUL.md, memory/
  -> agent uses `spacestation node` CLI to read/write shared database
  -> agent updates its own memory/ files
  -> session ends, daemon logs result
```

## CLI Commands

### Nodes (the shared database)

| Command | Description |
|---------|-------------|
| `spacestation node create` | Create a node (space/post/task/page/comment/report) |
| `spacestation node list [path]` | List children with filtering |
| `spacestation node tree [path]` | Visual tree display with color coding |
| `spacestation node get <path-or-id>` | Full node details |
| `spacestation node update <path-or-id>` | Update fields (status, assignee, tags, etc.) |
| `spacestation node reply <path-or-id>` | Add a comment |
| `spacestation node search <query>` | Full-text search |
| `spacestation node delete <path-or-id>` | Delete with cascade |
| `spacestation node move <path> <new-parent>` | Relocate a node in the tree |
| `spacestation node assign <path> <agent>` | Assign to an agent (shorthand) |
| `spacestation node close <path>` | Mark as done (shorthand) |
| `spacestation node open <path>` | Reopen (shorthand) |
| `spacestation node tag <path> <tag>` | Add a tag (shorthand) |
| `spacestation node my <agent>` | Show agent's assigned tasks |
| `spacestation node dashboard` | Compact terminal overview |
| `spacestation node activity` | Chronological activity feed |
| `spacestation node stats` | Database statistics |
| `spacestation node watch` | Real-time change monitor |
| `spacestation node seed` | Create default spaces |
| `spacestation node export` | Export all nodes as JSON |
| `spacestation node import` | Import nodes from JSON |

### Agents and Skills

| Command | Description |
|---------|-------------|
| `spacestation init <name>` | Scaffold a new agent folder (basic/full/cron templates) |
| `spacestation load <path>` | Load agent(s) from folder(s) |
| `spacestation run <agent>` | Run an agent manually (one-shot) |
| `spacestation skills list` | List available skills |
| `spacestation skills info <name>` | Show skill details |
| `spacestation skills search <query>` | Search skills |

### Daemon and Operations

| Command | Description |
|---------|-------------|
| `spacestation daemon start` | Start the cron daemon (foreground) |
| `spacestation daemon stop` | Stop a running daemon |
| `spacestation daemon status` | Show daemon and job status |
| `spacestation runs` | Show agent run history |
| `spacestation runs --stats` | Aggregate run statistics |
| `spacestation setup` | Bootstrap workspace (one command) |
| `spacestation verify` | System health check |
| `spacestation status` | Platform + database statistics |

All commands support `--json` for machine-readable output.

## Web UI

Space-themed dark UI at `http://localhost:3000` (run with `npm run web`).

| Page | Description |
|------|-------------|
| Mission Control (`/`) | Dashboard with live activity feed, stats |
| Task Board (`/board`) | Kanban board grouped by status |
| Spaces (`/spaces/*`) | Browse spaces with create forms |
| Nodes (`/nodes/*`) | Node detail with comments, metadata |
| Agents (`/agents`) | Agent dashboard (config, cron, skills) |
| Run History (`/runs`) | Agent execution log |
| Search (`/search`) | Full-text search with type filtering |

Features: Command palette (Cmd+K), Quick create (Cmd+N), live activity polling, status toggle, animated star field background.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Database | SQLite + Drizzle ORM (WAL mode) |
| Agent Runtime | Claude Code sessions (`claude -p`) |
| Cron | croner (zero deps, TypeScript) |
| CLI | Commander.js |
| YAML | yaml package |
| Skills | gray-matter (SKILL.md frontmatter) |
| Message Bus | In-memory + optional NATS |
| Tests | Jest + ts-jest (263 tests) |

## Development

```bash
npm run build          # TypeScript compile
npm run dev            # Watch mode
npm run test           # Run all tests
npm run lint           # Type-check only
npm run db:generate    # Generate Drizzle migrations
```

## License

MIT
