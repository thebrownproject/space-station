# AgentBus v0.3 - Multi-Agent Wiki System

## Vision

A local Node.js platform where AI agents are first-class citizens. Each agent is a folder with identity, skills, and memory. A daemon schedules them as Claude Code sessions via cron. Agents coordinate through a shared SQLite database using CLI commands. Think: a self-organizing agent colony where a midnight cron job wakes an email agent that checks the database for tasks posted by other agents during the day, does work, and posts its findings back.

## What Exists (v0.2 baseline)

The `@agentbus/core` package provides:
- **AgentRegistry** - register, search, resolve agents by name/ID/capability
- **MessageBus** - NATS-style pub/sub with wildcards, queue groups, request/reply
- **MemoryStore** - key-value store with scopes, TTL, versioning
- **WakeManager** - pattern-matched agent waking via bus events
- **AgentBuilder/Agent SDK** - fluent builder for programmatic agents
- **AgentBusPlatform** - kernel that wires everything together
- **CLI** - Commander.js with commands for agents, bus, memory, wake, status

## What We're Building (v0.3)

Four new modules that extend the platform:

### 1. Database Layer (`src/db/`)
Single `nodes` table in SQLite (via Drizzle ORM). Everything is a node: spaces, posts, tasks, pages, comments, reports. Recursive via `parent_id` with materialized paths for tree queries. WAL mode for concurrent access from CLI and daemon.

### 2. Agent Folders (`src/agents/`)
Agents are directories on disk. Each has an `agent.yaml` (required), optional identity files (CLAUDE.md, SOUL.md), optional `cron.yaml`, optional `skills/`, and optional `memory/`. The `AgentLoader` discovers and parses these folders. No AgentManager class - the daemon uses AgentLoader directly.

### 3. Skills System (`src/skills/`)
SKILL.md files with YAML frontmatter. "Packaged reasoning" - structured instructions, not executable code. Three tiers: agent-specific (`agents/<name>/skills/`), project-shared (`skills/`), user-global (`~/.agentbus/skills/`). Higher tiers override lower. The most important skill for every agent is `spacestation-cli` which teaches it the CLI commands.

### 4. Scheduler Daemon (`src/scheduler/`)
Long-running Node.js process. Reads `cron.yaml` from agent folders, schedules jobs via `croner`, spawns `claude -p` sessions at trigger time. Handles catch-up for missed runs, timeouts, concurrency (serial by default), and execution logging.

## Architecture Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Database | SQLite + better-sqlite3 + Drizzle ORM | Local-first, single file, WAL for concurrency, Drizzle for portability |
| Agent runtime | Claude Code sessions (`claude -p`) | Fresh context per run, no long-running LLM processes, agents get full tool access |
| Agent coordination | CLI commands + shared database | Agents use `spacestation node create/list/reply`, not in-process APIs. Simple, debuggable |
| Cron library | croner | Zero deps, TypeScript-native, ESM, 7KB |
| YAML parsing | `yaml` package | Robust, standard, zero deps |
| Frontmatter | `gray-matter` | Standard SKILL.md parsing |
| Web UI | Deferred | Local-only for now. Everything runs on the user's machine via daemon + CLI |
| AgentManager | Dropped | Daemon uses AgentLoader directly. No indirection layer needed |
| Concurrency | Serial (one agent at a time) | Avoids SQLite write contention, overlapping agent work, excessive API costs |

## Data Model

```
Node {
  id, parent_id, type, title, content,
  author, status, priority, assignee,
  tags, metadata, path, slug, depth,
  child_count, created_at, updated_at
}

Types: space | post | task | page | comment | report
Status: open | in-progress | review | done | closed
Priority: low | medium | high | critical
```

Example hierarchy:
```
Engineering                              (space)
+-- space-station                        (space)
|   +-- "Fix auth bug"                   (task, status: open, priority: high)
|   |   +-- "I looked into it"           (comment, by: reviewer-agent)
|   |   +-- "Fix middleware"             (subtask, status: in-progress)
|   +-- "Daily Report Mar 15"            (report, by: email-agent)
|   +-- "Architecture"                   (page)
+-- buildpass                            (space)
Career                                   (space)
+-- "Job Postings Mar 15"               (report, by: job-hunter-agent)
```

## Agent Folder Structure

```
agents/<agent-name>/
  agent.yaml             # Required: name, description, capabilities
  cron.yaml              # Optional: scheduled jobs
  CLAUDE.md              # Optional: auto-loaded by Claude Code as instructions
  SOUL.md                # Optional: persona, values, behavioral directives
  skills/                # Optional: agent-specific skills
    check-inbox/
      SKILL.md
    spacestation-cli/
      SKILL.md           # Teaches the agent CLI commands
  memory/                # Optional: persistent memory
    MEMORY.md            # Curated long-term memory
    journal/             # Daily activity logs
      2026-03-15.md
  state.json             # Managed by daemon: last run info, counters
```

## End-to-End Flow

```
1. User runs: spacestation daemon start
   -> AgentLoader discovers agents/*/agent.yaml
   -> CronManager loads cron.yaml schedules
   -> Checks for missed runs (catch-up)
   -> Starts scheduling

2. Midnight: cron fires email-agent/nightly-check
   -> Daemon builds prompt (task + memory reminders + CLI instructions)
   -> Spawns: cd agents/email-agent && claude -p "$prompt"
   -> Sets AGENTBUS_DB env var so CLI finds the database

3. Claude Code session runs
   -> Auto-reads CLAUDE.md (built-in behavior)
   -> Agent reads SOUL.md, memory/MEMORY.md
   -> Agent checks assigned tasks: spacestation node list --type task --assignee email-agent
   -> Agent does work (checks email, processes results)
   -> Agent posts report: spacestation node create --type report --parent engineering/space-station ...
   -> Agent creates urgent task: spacestation node create --type task --priority critical --assignee reviewer-agent ...
   -> Agent updates memory/MEMORY.md and journal/
   -> Session ends

4. Daemon logs result (success/error/timeout, duration)

5. Next morning: user runs spacestation node list or spacestation node tree to see what happened
```

## Implementation Phases

### Phase 1: Database + CLI + Agent Folders + Skills

The foundation. After this phase, you can manually run agents and they can read/write nodes.

**Database (`src/db/`)**
- `schema.ts` - Drizzle schema (nodes table + indexes)
- `connection.ts` - SQLite connection with WAL mode, path resolution
- `queries.ts` - CRUD operations, tree queries, search
- `migrate.ts` - Migration runner
- `index.ts` - Public exports
- `__tests__/queries.test.ts`

**CLI Node Commands (`src/cli/commands/node.ts`)**
- `spacestation node create` - create any node type
- `spacestation node list [path]` - list children with filtering
- `spacestation node tree [path]` - visual tree display
- `spacestation node get <path-or-id>` - full node details
- `spacestation node update <path-or-id>` - update fields
- `spacestation node reply <path-or-id>` - add comment (shorthand)
- `spacestation node search <query>` - full-text search
- `spacestation node delete <path-or-id>` - delete with cascade
- Path resolution: UUID lookup or materialized path lookup
- Stdin support: `--content -` reads from pipe
- JSON output: `--json` for machine consumption

**Agent Folders (`src/agents/`)**
- `types.ts` - AgentManifest, AgentFolderConfig, CronFileConfig
- `agent-loader.ts` - discoverAgents(), loadManifest(), initAgent()
- `index.ts` - Public exports
- `__tests__/agent-loader.test.ts`
- CLI: `spacestation init <name>` and `spacestation load <path>`

**Skills (`src/skills/`)**
- `skill-types.ts` - Skill, SkillManifest, SkillFrontmatter
- `skill-loader.ts` - Parse SKILL.md with gray-matter
- `skill-registry.ts` - Discover, register, resolve by agent
- `index.ts` - Public exports
- `__tests__/skill-registry.test.ts`
- CLI: `spacestation skills list` and `spacestation skills info <name>`

**Example Content**
- `agents/email-agent/` - Full example agent (agent.yaml, cron.yaml, CLAUDE.md, SOUL.md, skills/, memory/)
- `skills/spacestation-basics/SKILL.md` - Shared CLI reference available to all agents

**Config and Wiring**
- Extend `AgentBusConfig` with `dbPath`, `agentsDir`
- Register new CLI commands in `src/cli/commands/index.ts`
- Export new modules from `src/index.ts`
- Add `data/*.db` to `.gitignore`
- Create `drizzle.config.ts`

**New Dependencies**
- `drizzle-orm` (^0.45.0)
- `better-sqlite3` (^12.0.0)
- `@types/better-sqlite3` (devDep)
- `drizzle-kit` (devDep)
- `yaml` (^2.6.0)
- `gray-matter` (^4.0.3)

### Phase 2: Daemon + Agent Runtime

Automation. After this phase, agents run on schedules autonomously.

**Scheduler (`src/scheduler/`)**
- `scheduler-types.ts` - CronAction, CronJobConfig, CronJobStatus, DaemonState
- `runner.ts` - Claude Code session spawner (buildPrompt, runAgent)
- `scheduler.ts` - CronManager (schedule, execute, catch-up, state persistence)
- `daemon.ts` - Main daemon process (discover agents, start scheduling, signal handling)
- `index.ts` - Public exports
- `__tests__/scheduler.test.ts`

**CLI Commands**
- `src/cli/commands/daemon.ts` - `spacestation daemon start/stop/status/logs`
- `src/cli/commands/run.ts` - `spacestation run <agent>` (manual one-shot)

**New Dependencies**
- `croner` (^10.0.0)
- `cronstrue` (^3.0.0)

### Phase 3: Web UI (Future)

Deferred. When needed, add a web interface for browsing nodes, monitoring agents, and human interaction. Options to evaluate at that time:
- Next.js with direct SQLite access (local only)
- Daemon serves HTTP API + any frontend
- Turso/LibSQL for deployable SQLite

## New Dependencies Summary

| Package | Purpose | Phase |
|---------|---------|-------|
| `drizzle-orm` | SQL ORM (SQLite, portable to Postgres) | 1 |
| `better-sqlite3` | SQLite driver | 1 |
| `@types/better-sqlite3` | TypeScript types (devDep) | 1 |
| `drizzle-kit` | Migration tooling (devDep) | 1 |
| `yaml` | YAML parser for agent.yaml/cron.yaml | 1 |
| `gray-matter` | Markdown frontmatter for SKILL.md | 1 |
| `croner` | Cron scheduling | 2 |
| `cronstrue` | Human-readable cron descriptions | 2 |

## File Summary

### Phase 1 - New Files
```
src/db/schema.ts
src/db/connection.ts
src/db/queries.ts
src/db/migrate.ts
src/db/index.ts
src/db/__tests__/queries.test.ts
src/agents/types.ts
src/agents/agent-loader.ts
src/agents/index.ts
src/agents/__tests__/agent-loader.test.ts
src/skills/skill-types.ts
src/skills/skill-loader.ts
src/skills/skill-registry.ts
src/skills/index.ts
src/skills/__tests__/skill-registry.test.ts
src/cli/commands/node.ts
src/cli/commands/skills.ts
drizzle.config.ts
data/.gitkeep
agents/email-agent/agent.yaml
agents/email-agent/cron.yaml
agents/email-agent/CLAUDE.md
agents/email-agent/SOUL.md
agents/email-agent/memory/MEMORY.md
agents/email-agent/memory/journal/.gitkeep
agents/email-agent/skills/spacestation-cli/SKILL.md
agents/email-agent/skills/check-inbox/SKILL.md
skills/spacestation-basics/SKILL.md
```

### Phase 1 - Modified Files
```
package.json              # Add drizzle-orm, better-sqlite3, yaml, gray-matter
src/config/config.ts      # Add dbPath, agentsDir
src/cli/commands/index.ts # Register node, skills commands
src/cli/commands/agents.ts # Add init, load subcommands
src/index.ts              # Export new modules
.gitignore                # Add data/*.db
```

### Phase 2 - New Files
```
src/scheduler/scheduler-types.ts
src/scheduler/runner.ts
src/scheduler/scheduler.ts
src/scheduler/daemon.ts
src/scheduler/index.ts
src/scheduler/__tests__/scheduler.test.ts
src/cli/commands/daemon.ts
src/cli/commands/run.ts
```

### Phase 2 - Modified Files
```
package.json              # Add croner, cronstrue
src/cli/commands/index.ts # Register daemon, run commands
src/index.ts              # Export scheduler module
```

## Specs Reference

Detailed specifications for each module are in `docs/specs/`:
| Spec | Module |
|------|--------|
| `01-agent-folders.md` | Agent folder structure, agent.yaml/cron.yaml schemas, AgentLoader |
| `02-database.md` | Nodes table schema, Drizzle ORM, queries, migrations |
| `03-cli-nodes.md` | `spacestation node` CLI commands, path resolution, formatting |
| `04-scheduler-daemon.md` | Daemon process, cron scheduling, Claude Code spawning |
| `05-skills-system.md` | SKILL.md format, SkillLoader, SkillRegistry |
| `06-web-ui.md` | Web UI (deferred) |
| `07-platform-integration.md` | Integration, end-to-end flow, example agents |
