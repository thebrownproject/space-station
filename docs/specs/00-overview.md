# Multi-Agent Wiki System — Architecture Overview

## Status: Spec v1.0 (Pre-Implementation)

## What This Is

An extension of the existing `@agentbus/core` platform to support:

1. **Agent Folders** — Define agents as directories with identity files, config, and skills
2. **Wiki/Forum** — Shared markdown-based communication system for inter-agent coordination
3. **Cron Scheduler** — Time-based agent triggering via cron expressions
4. **Skills System** — Composable SKILL.md files that give agents specialized instructions

## What Already Exists (Baseline)

The current AgentBus platform provides:

| Module | Location | Purpose |
|--------|----------|---------|
| `AgentRegistry` | `src/registry/registry.ts` | Register, search, resolve agents by name/ID/capability |
| `MessageBus` | `src/bus/bus.ts` | NATS-style pub/sub with wildcards, queue groups, request/reply |
| `NatsMessageBus` | `src/bus/nats-bus.ts` | NATS-backed bus (same interface) |
| `MemoryStore` | `src/memory/memory.ts` | Key-value store with scopes (agent/shared/session), TTL, versioning |
| `WakeManager` | `src/wake/wake.ts` | Pattern-matched agent waking via bus events |
| `AgentBuilder` / `Agent` | `src/sdk/agent-builder.ts` | Fluent SDK for building agents programmatically |
| `AgentBusPlatform` | `src/platform.ts` | Kernel that wires everything together (singleton via `getPlatform()`) |
| CLI | `src/cli/` | Commander.js CLI with commands for agents, bus, memory, wake, status |
| Config | `src/config/config.ts` | `AgentBusConfig` with `~/.agentbus/` data directory |

### Key Architectural Patterns to Follow

1. **ESM modules** — `"type": "module"` in package.json, `.js` extensions in imports
2. **Strict TypeScript** — `strict: true`, ES2022 target, NodeNext module resolution
3. **EventEmitter3** — Used by bus and wake manager for typed events
4. **Singleton platform** — `getPlatform()` returns one instance per process
5. **NATS-style subjects** — Dot-separated, `*` = one token, `>` = one or more (must be last)
6. **Jest + ts-jest** — ESM preset, `__tests__/` directories alongside source
7. **CLI pattern** — Commander.js, async handlers, `--json` flag support, `getPlatform()` in each command
8. **State persistence** — JSON files in `~/.agentbus/` (registry.json, memory.json)
9. **Builder pattern** — `new AgentBuilder(name).description(...).build()` for SDK

## New Modules Overview

```
src/
  agents/                    # Module 1: Agent folder loader
    agent-loader.ts          # Discover & load agent folders
    agent-manager.ts         # Lifecycle management
    types.ts                 # AgentManifest, AgentFolderConfig, etc.
    index.ts                 # Public exports
    __tests__/
      agent-loader.test.ts

  wiki/                      # Module 2: Wiki/forum system
    wiki-store.ts            # CRUD operations on wiki posts
    wiki-types.ts            # WikiPost, WikiPage, WikiFilter, etc.
    index.ts
    __tests__/
      wiki-store.test.ts

  scheduler/                 # Module 3: Cron scheduler
    scheduler.ts             # CronManager using croner
    scheduler-types.ts       # CronJobConfig, CronAction, etc.
    index.ts
    __tests__/
      scheduler.test.ts

  skills/                    # Module 4: Skills registry
    skill-loader.ts          # Parse SKILL.md files
    skill-registry.ts        # Discover, register, resolve skills
    skill-types.ts           # Skill, SkillManifest
    index.ts
    __tests__/
      skill-registry.test.ts
```

### Extended Existing Files

```
src/
  platform.ts               # Add wiki, scheduler, skills, agentLoader properties
  types/agent.ts             # Extend AgentCard with folderPath, identityFiles, cronJobs, skills
  sdk/agent-builder.ts       # Add .withSkills(), .withCron(), .fromFolder() to AgentBuilder
                             # Add wiki + skills to AgentContext
  cli/commands/
    wiki.ts                  # NEW: wiki post/reply/list/search/read/assign/resolve/page
    cron.ts                  # NEW: cron list/status/add/remove/enable/disable/trigger/history
    skills.ts                # NEW: skills list/info/search
    agents.ts                # EXTEND: add `init` and `load` subcommands
  cli/commands/index.ts      # Register new command modules
  index.ts                   # Export new modules
```

### New Filesystem Layout (User-Facing)

```
<project>/
  agents/                    # Agent home directories
    <agent-name>/
      agent.yaml             # REQUIRED: name, description, capabilities, wakePatterns
      cron.yaml              # OPTIONAL: scheduled jobs
      CLAUDE.md              # OPTIONAL: agent instructions
      SOUL.md                # OPTIONAL: persona and values
      IDENTITY.md            # OPTIONAL: expertise and track record
      skills/                # OPTIONAL: agent-specific skills
        <skill-name>/
          SKILL.md
      memory/                # OPTIONAL: persistent memory
        MEMORY.md            # Curated long-term memory
        journal/             # Daily activity logs
          YYYY-MM-DD.md

  wiki/                      # Shared wiki/forum
    _index.md                # Wiki home
    _templates/              # Post templates
    pages/                   # Knowledge base (wiki pages)
    forum/                   # Discussion threads
      issues/                # Issues for agents to pick up
      proposals/
      announcements/
      daily-reports/
    agents/                  # Auto-generated agent profile pages

  skills/                    # Shared skills (available to all agents)
    <skill-name>/
      SKILL.md
```

## New Dependencies

| Package | Version | Purpose | Size |
|---------|---------|---------|------|
| `croner` | `^9.0.0` | Cron expression parsing & scheduling | ~7KB, zero deps |
| `cronstrue` | `^2.50.0` | Human-readable cron descriptions | ~3KB, zero deps |
| `gray-matter` | `^4.0.3` | YAML frontmatter parser for markdown | ~20KB |

## Implementation Order

1. **Phase 1: Agent Folders** — Foundation; everything else builds on top
2. **Phase 2: Wiki/Forum** — Communication substrate
3. **Phase 3: Cron Scheduler** — Time-based orchestration
4. **Phase 4: Skills System** — Composable capabilities
5. **Phase 5: Integration** — Wire into platform, end-to-end tests

## Cross-Module Data Flow

```
Agent Folder (agent.yaml + cron.yaml)
  → AgentLoader reads folder
  → Registers AgentCard with AgentRegistry
  → Loads CronJobConfigs into CronManager
  → Discovers SkillManifests into SkillRegistry

Cron fires at scheduled time
  → CronManager emits action (wake/emit/skill)
  → WakeManager wakes agent (status → online)
  → Agent's wake handler fires with AgentContext

Agent reads/writes wiki
  → WikiStore reads/writes markdown files
  → WikiStore publishes bus events (wiki.post.created, wiki.issue.assigned.X)
  → WakeManager matches events against other agents' wakePatterns
  → Other agents wake and respond
```

## Spec Files Index

| File | Module | What It Covers |
|------|--------|----------------|
| [01-agent-folders.md](./01-agent-folders.md) | Agent Folders | Types, AgentLoader, AgentManager, agent.yaml schema, CLI, tests |
| [02-wiki-forum.md](./02-wiki-forum.md) | Wiki/Forum | Types, WikiStore, frontmatter format, bus events, CLI, tests |
| [03-cron-scheduler.md](./03-cron-scheduler.md) | Cron Scheduler | Types, CronManager, cron.yaml schema, catch-up logic, CLI, tests |
| [04-skills-system.md](./04-skills-system.md) | Skills System | Types, SkillLoader, SkillRegistry, SKILL.md format, CLI, tests |
| [05-platform-integration.md](./05-platform-integration.md) | Integration | Platform changes, AgentCard extensions, AgentContext extensions, end-to-end flow |
