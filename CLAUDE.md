# Space Station - Multi-Agent Workspace

Local Node.js platform where autonomous AI agents coordinate through a shared SQLite database. Agents are folders with identity files (CLAUDE.md, SOUL.md), scheduled via cron, and invoked as Claude Code sessions. Humans interact through the `spacestation` CLI and a Next.js web UI.

## Commands

```bash
# Core
npm run build          # TypeScript compile (tsc)
npm run dev            # Watch mode (tsc --watch)
npm run test           # Jest (ESM mode, 318 tests)
npm run test -- --testPathPattern=<pattern>  # Run specific tests
npm run lint           # Type-check only (tsc --noEmit)
npm run start          # Run CLI (node dist/cli/index.js)
npm run clean          # Remove dist/
npm run db:generate    # Generate Drizzle migrations

# Web UI
npm run web            # Start Next.js dev server (http://localhost:3000)
npm run web:build      # Build Next.js for production
```

## Architecture

### Core (src/)

| Module | Path | Tests | Purpose |
|--------|------|-------|---------|
| Database | `src/db/` | 70 | SQLite nodes table (Drizzle ORM), CRUD, tree queries |
| Agent Folders | `src/agents/` | 34 | Load agents from filesystem directories |
| Skills | `src/skills/` | 39 | SKILL.md loader and registry |
| Scheduler | `src/scheduler/` | 20 | Cron daemon, Claude Code session spawner |
| Registry | `src/registry/` | 20 | Agent registry (discover, search, resolve) |
| Bus | `src/bus/` | 25 | NATS-style pub/sub message bus |
| Memory | `src/memory/` | 20 | Key-value store with scopes, TTL |
| Wake | `src/wake/` | 15 | Pattern-matched agent waking |
| SDK | `src/sdk/` | - | Fluent AgentBuilder for programmatic agents |
| CLI | `src/cli/` | 50 | Commander.js CLI (integration tests) |

### Web UI (web/)

Next.js + shadcn/ui + Tailwind. Space-themed dark UI. Shares SQLite database with CLI.

| Route | Purpose |
|-------|---------|
| `/` | Mission Control dashboard (stats, activity feed) |
| `/spaces/[path]` | Space browser with create form |
| `/nodes/[id]` | Node detail view with comments |
| `/agents` | Agent dashboard (reads agent.yaml) |
| `/search` | Full-text search |
| `/api/nodes` | REST API for nodes |
| `/api/nodes/create` | Create node API |
| `/api/nodes/update` | Update node API |
| `/api/stats` | Database statistics |

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

### Core model: Everything is a node

Single `nodes` table. Types: space, post, task, page, comment, report. Recursive via parent_id. Materialized paths for tree queries.

## Code Conventions

- **ESM modules**: `"type": "module"`, `.js` extensions in all imports
- **Strict TypeScript**: `strict: true`, ES2022, NodeNext module resolution
- **Tests**: Jest with ts-jest ESM preset. Tests in `__tests__/` alongside source.
- **CLI pattern**: Commander.js, async handlers, `--json` flag for machine output
- **Events**: EventEmitter3 for typed events
- **Singleton platform**: `getPlatform()` returns one instance per process
- **NATS-style subjects**: dot-separated, `*` = one token, `>` = one or more (must be last)

## Key Dependencies

- `drizzle-orm` + `better-sqlite3` for database
- `yaml` for agent.yaml/cron.yaml parsing
- `gray-matter` for SKILL.md frontmatter
- `croner` for cron scheduling
- `commander` for CLI
- `eventemitter3` for typed events
- `next` + `react` for web UI

## Specs

Detailed specs live in `docs/specs/`:
- `00-overview.md` - Architecture overview, tech stack, project structure
- `01-agent-folders.md` - Agent folder structure, AgentLoader, agent.yaml/cron.yaml schemas
- `02-database.md` - Nodes table schema, Drizzle ORM, queries
- `03-cli-nodes.md` - `spacestation node` CLI commands
- `04-scheduler-daemon.md` - Daemon process, cron scheduling, Claude Code spawning
- `05-skills-system.md` - SKILL.md format, SkillLoader, SkillRegistry
- `06-web-ui.md` - Web UI architecture
- `07-platform-integration.md` - Integration, end-to-end flow, example agents
