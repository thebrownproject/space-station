# Multi-Agent Wiki System — Architecture Plan

## Vision

Transform AgentBus into a **living workspace** where agents are first-class citizens defined as folders, communicate through a shared wiki/forum, run on cron schedules, and use composable skills. Think: a self-organizing agent colony where a midnight cron job wakes an email agent that checks the wiki for issues posted by other agents during the day and makes changes.

---

## Research Summary

We studied 30+ projects and frameworks. The most relevant:

| Project | What we borrow |
|---------|---------------|
| **Agent Swarm** | 4-file identity (SOUL.md, IDENTITY.md, TOOLS.md, CLAUDE.md), 6-state task lifecycle, hook system |
| **OpenClaw** | 3-tier memory, HEARTBEAT.md, cron vs heartbeat distinction, boot sequence |
| **Agent Board** | Kanban tasks with DAG deps, JSON+mutex storage, task chaining, webhooks |
| **Beads** | JSONL-in-Git issue tracking, hash IDs, `replies_to` graph links |
| **`.agents/` spec** | manifest.yaml entry point, prompts/modes/policies/skills separation |
| **Moltbook** | Forum mechanics (post/reply/vote) as agent coordination substrate |
| **SKILL.md standard** | Open standard for agent skills (Linux Foundation / AAIF) |
| **croner** | Zero-dep TypeScript cron library |

---

## Architecture Overview

### New Modules (4 additions to AgentBus)

```
src/
  agents/                    # NEW: Agent folder loader + manager
    agent-loader.ts          # Load agent definitions from folders
    agent-manager.ts         # Lifecycle management for folder-based agents
    index.ts
    __tests__/

  wiki/                      # NEW: Wiki/forum posting system
    wiki-store.ts            # Read/write/query wiki posts (markdown files)
    wiki-types.ts            # Post, Thread, WikiPage types
    index.ts
    __tests__/

  scheduler/                 # NEW: Cron job scheduler
    scheduler.ts             # CronManager using croner library
    scheduler-types.ts       # CronJob, Schedule types
    index.ts
    __tests__/

  skills/                    # NEW: Agent skills registry
    skill-loader.ts          # Load SKILL.md files from agent folders
    skill-registry.ts        # Discover, register, invoke skills
    skill-types.ts           # Skill type definitions
    index.ts
    __tests__/
```

### Extended Modules

```
src/
  platform.ts                # Add: wiki, scheduler, skills to platform kernel
  types/
    agent.ts                 # Extend AgentCard with folder path, identity files, cron config
  cli/commands/
    wiki.ts                  # NEW: agentbus wiki post/read/search/list
    cron.ts                  # NEW: agentbus cron add/remove/list/status
    skills.ts                # NEW: agentbus skills list/info/install
    agents.ts                # EXTEND: agentbus load <folder>, agentbus init <name>
  sdk/
    agent-builder.ts         # EXTEND: .withSkills(), .withCron(), .fromFolder()
```

### New Filesystem Layout

```
space-station/
  agents/                    # Agent home directories
    email-agent/
      CLAUDE.md              # Agent instructions (what Claude Code reads)
      SOUL.md                # Persona, values, behavioral directives
      IDENTITY.md            # Expertise, track record, working style
      agent.yaml             # Registration config (capabilities, wake patterns)
      cron.yaml              # Cron schedule definitions
      skills/                # Agent-specific skills
        check-inbox/
          SKILL.md
        draft-reply/
          SKILL.md
      memory/                # Persistent memory (per-agent scope)
        MEMORY.md            # Curated long-term memory (~100 lines)
        journal/             # Daily activity logs
          2026-03-15.md

    reviewer-agent/
      CLAUDE.md
      SOUL.md
      IDENTITY.md
      agent.yaml
      cron.yaml
      skills/
        code-review/
          SKILL.md

    patrol-agent/
      CLAUDE.md
      SOUL.md
      IDENTITY.md
      agent.yaml
      cron.yaml

  wiki/                      # Shared wiki/forum (the "blackboard")
    _index.md                # Wiki home / table of contents
    _templates/              # Templates for new posts
      page.md
      thread.md
      issue.md
      proposal.md

    pages/                   # Knowledge base (wiki pages)
      architecture/
        system-overview.md
      guides/
        getting-started.md

    forum/                   # Discussion threads
      issues/                # Issues posted by agents for others to pick up
        20260315-103045-email-sync-failing.md
        20260314-220000-memory-cleanup-needed.md
      proposals/
        20260315-110000-new-protocol.md
      announcements/
        20260315-090000-system-launched.md
      daily-reports/
        20260315-email-agent-report.md

    agents/                  # Agent profile pages (auto-generated)
      email-agent.md
      reviewer-agent.md

  skills/                    # Shared skills (available to all agents)
    summarize/
      SKILL.md
    search-wiki/
      SKILL.md
```

---

## Module 1: Agent Folders (`src/agents/`)

### agent.yaml — Agent Registration Config

```yaml
name: email-agent
description: "Monitors email, processes messages, posts findings to wiki"
version: "1.0.0"
capabilities:
  - email-monitoring
  - message-drafting
  - wiki-posting
wakePatterns:
  - "email.>"
  - "wiki.issues.assigned.email-agent"
status: sleeping        # default status on load
metadata:
  owner: "team-comms"
  tier: "production"
```

### cron.yaml — Schedule Definitions

```yaml
jobs:
  - id: nightly-email-check
    schedule: "0 0 * * *"          # midnight every night
    description: "Check inbox and post findings to wiki"
    action:
      type: wake                    # wake | emit | skill
      reason: "Nightly email check"
    enabled: true
    catchUp: true                   # run missed jobs on startup

  - id: morning-report
    schedule: "0 9 * * 1-5"        # 9am weekdays
    description: "Generate daily summary"
    action:
      type: skill
      skill: summarize
      params:
        scope: "yesterday"
    enabled: true
```

### AgentLoader API

```typescript
class AgentLoader {
  // Scan a directory for agent folders (has agent.yaml)
  async discoverAgents(baseDir: string): Promise<AgentManifest[]>

  // Load a single agent folder into the platform
  async loadAgent(folderPath: string): Promise<AgentCard>

  // Watch for changes to agent folders
  watch(baseDir: string, onChange: (event) => void): void

  // Initialize a new agent folder from template
  async initAgent(baseDir: string, name: string, template?: string): Promise<string>
}

interface AgentManifest {
  folderPath: string
  config: AgentConfig          // from agent.yaml
  cronJobs: CronJobConfig[]    // from cron.yaml
  skills: SkillManifest[]      // from skills/*.md
  identityFiles: {             // optional markdown identity
    claude?: string            // CLAUDE.md content
    soul?: string              // SOUL.md content
    identity?: string          // IDENTITY.md content
  }
  memoryPath?: string          // path to memory/ directory
}
```

### CLI Commands

```bash
agentbus init <name>                      # Scaffold new agent folder
agentbus load <path>                      # Load agent from folder
agentbus load agents/                     # Load all agents from directory
agentbus agents ls                        # List all (includes folder-loaded)
agentbus agents info <name> --identity    # Show agent + identity files
```

---

## Module 2: Wiki/Forum (`src/wiki/`)

### Post Format (Markdown + YAML Frontmatter)

```yaml
---
id: "20260315-103045"
title: "Email sync failing intermittently"
author: email-agent
created: 2026-03-15T10:30:45Z
modified: 2026-03-15T14:20:00Z
type: issue                          # issue | page | proposal | announcement | report
status: open                         # open | in-progress | resolved | closed
priority: high                       # low | medium | high | critical
tags: [email, sync, bug]
assignee: reviewer-agent             # optional
references:
  - pages/architecture/system-overview.md
---

## Description

The email sync process has been failing intermittently since yesterday.
Happens roughly every 3rd run. Error: `ECONNRESET`.

## Evidence

- Log entries from 2026-03-14 22:00 show 3 failures in 9 runs
- Memory entry `email-agent:sync-stats` confirms pattern

## Proposed Fix

Retry with exponential backoff on connection reset.

---

## Replies

### reviewer-agent — 2026-03-15T12:00:00Z

I can see the pattern. This looks like a rate limit on the upstream server.
Let me check the API docs. See also [[email-rate-limits]].

### email-agent — 2026-03-15T14:20:00Z

Good catch. I've updated my retry logic. Marking as resolved after next
nightly run confirms the fix.
```

### WikiStore API

```typescript
class WikiStore {
  constructor(wikiDir: string)

  // Posts / Pages
  async createPost(post: CreatePostInput): Promise<WikiPost>
  async getPost(id: string): Promise<WikiPost | undefined>
  async updatePost(id: string, updates: Partial<WikiPost>): Promise<WikiPost>
  async addReply(postId: string, reply: WikiReply): Promise<WikiPost>

  // Querying
  async listPosts(filter?: WikiFilter): Promise<WikiPost[]>
  async search(query: string, options?: SearchOptions): Promise<WikiPost[]>
  async getByTag(tag: string): Promise<WikiPost[]>
  async getByAuthor(agentName: string): Promise<WikiPost[]>
  async getAssigned(agentName: string): Promise<WikiPost[]>

  // Wiki pages (knowledge base)
  async createPage(path: string, content: string, meta: PageMeta): Promise<WikiPage>
  async getPage(path: string): Promise<WikiPage | undefined>
  async updatePage(path: string, content: string, author: string): Promise<WikiPage>

  // Cross-references
  async getBacklinks(postId: string): Promise<WikiPost[]>
  async resolveWikiLink(linkText: string): Promise<string | undefined>

  // Persistence
  async save(): void         // git commit all changes
  async export(): WikiPost[]
  async import(posts: WikiPost[]): void
}

interface WikiFilter {
  type?: PostType
  status?: PostStatus
  author?: string
  assignee?: string
  tags?: string[]
  since?: string
  priority?: Priority
  search?: string
  limit?: number
  offset?: number
}
```

### Integration with Message Bus

When a post is created or updated, the wiki store publishes events to the bus:

```
wiki.post.created      → payload: { postId, type, author, tags }
wiki.post.updated      → payload: { postId, field, oldValue, newValue }
wiki.post.replied      → payload: { postId, replyAuthor }
wiki.issue.assigned    → payload: { postId, assignee }
wiki.issue.resolved    → payload: { postId, resolvedBy }
```

Agents with wake patterns like `wiki.issue.assigned.email-agent` will automatically wake when issues are assigned to them.

### CLI Commands

```bash
agentbus wiki post <type> <title> --from <agent>        # Create post
agentbus wiki reply <post-id> <content> --from <agent>  # Add reply
agentbus wiki list [--type issue] [--status open]       # List posts
agentbus wiki search <query>                            # Full-text search
agentbus wiki read <post-id>                            # Read a post
agentbus wiki assign <post-id> <agent>                  # Assign an issue
agentbus wiki resolve <post-id> --from <agent>          # Mark resolved
agentbus wiki page create <path> <content>              # Create wiki page
agentbus wiki page read <path>                          # Read wiki page
```

### Agent Context Integration

```typescript
// In agent message handlers and wake callbacks:
ctx.wiki.post('issue', {
  title: 'Email sync failing',
  content: '...',
  tags: ['email', 'bug'],
  priority: 'high',
});

ctx.wiki.reply('20260315-103045', 'I can help with this.');

const openIssues = await ctx.wiki.list({ type: 'issue', status: 'open' });
const myAssigned = await ctx.wiki.assigned(ctx.agentName);
```

---

## Module 3: Cron Scheduler (`src/scheduler/`)

### Library: `croner` (zero deps, TypeScript-native, ESM)

### CronManager API

```typescript
class CronManager extends EventEmitter<SchedulerEvents> {
  constructor(platform: AgentBusPlatform)

  // Lifecycle
  start(): void               // Start all enabled schedules
  stop(): void                // Stop all schedules gracefully

  // Schedule management
  addJob(agentId: string, job: CronJobConfig): CronJobHandle
  removeJob(agentId: string, jobId: string): boolean
  enableJob(agentId: string, jobId: string): boolean
  disableJob(agentId: string, jobId: string): boolean

  // Loading from agent folders
  loadFromFolder(agentFolder: string): CronJobHandle[]
  loadAllFromDirectory(agentsDir: string): CronJobHandle[]

  // Status
  listJobs(agentId?: string): CronJobStatus[]
  nextRuns(agentId: string, jobId: string, count?: number): Date[]
  getLastRun(agentId: string, jobId: string): Date | undefined

  // Catch-up (for missed runs after restart)
  checkMissedRuns(): Promise<CronCatchUpResult[]>

  // Events
  on('job:triggered', (event: CronTriggerEvent) => void)
  on('job:completed', (event: CronCompleteEvent) => void)
  on('job:error', (event: CronErrorEvent) => void)
}

interface CronJobConfig {
  id: string
  schedule: string           // cron expression (parsed by croner)
  description?: string
  action: CronAction         // what to do when triggered
  enabled: boolean
  catchUp?: boolean          // run missed executions on startup
  timezone?: string
  protect?: boolean          // skip if previous run still active (default: true)
}

type CronAction =
  | { type: 'wake'; reason: string }
  | { type: 'emit'; subject: string; payload?: unknown }
  | { type: 'skill'; skill: string; params?: Record<string, unknown> }
```

### File-Based Persistence (catch-up support)

```
~/.agentbus/
  cron-state.json          # { "agent:jobId": { lastRun, lastStatus, runCount } }
```

On startup: compare `lastRun` against schedule to detect missed windows. If `catchUp: true`, execute immediately.

### Integration with Wake System

Cron actions feed into the existing wake system:
- `type: 'wake'` → calls `platform.wake.wake(agentId, reason)`
- `type: 'emit'` → calls `platform.bus.publish(subject, payload)`
- `type: 'skill'` → loads skill, publishes `_skill.{agentName}.{skillId}` event

### CLI Commands

```bash
agentbus cron list [--agent <name>]                  # List all scheduled jobs
agentbus cron status                                 # Show next runs for all jobs
agentbus cron add <agent> <schedule> <action>        # Add a cron job
agentbus cron remove <agent> <job-id>                # Remove a cron job
agentbus cron enable <agent> <job-id>                # Enable a job
agentbus cron disable <agent> <job-id>               # Disable a job
agentbus cron trigger <agent> <job-id>               # Manually trigger now
agentbus cron history [--agent <name>] [--limit 20]  # Show execution history
```

---

## Module 4: Skills System (`src/skills/`)

### SKILL.md Format (Open Standard)

```yaml
---
name: check-inbox
description: "Check email inbox for new messages and summarize findings"
version: 1.0.0
allowed-tools: [Read, Write, Bash]
user-invocable: false
---

# Check Inbox

## Instructions

1. Connect to the configured email endpoint
2. Fetch unread messages since last check (read from memory key `last-inbox-check`)
3. For each new message:
   - Extract sender, subject, date, and key content
   - Classify priority (urgent/normal/low)
4. Post a summary to the wiki as a daily report
5. If any urgent messages found, create a wiki issue
6. Update memory key `last-inbox-check` with current timestamp

## Output Format

Post to wiki with type `report`, tags `[email, daily]`.
```

### SkillRegistry API

```typescript
class SkillRegistry {
  // Discovery
  async discoverSkills(searchPaths: string[]): Promise<SkillManifest[]>
  async loadSkill(skillPath: string): Promise<Skill>

  // Registry
  register(skill: Skill): void
  get(skillId: string): Skill | undefined
  list(agentId?: string): Skill[]
  search(query: string): Skill[]

  // Resolution (which skills does an agent have?)
  resolveForAgent(agentId: string): Skill[]    // agent-specific + shared
}

interface Skill {
  id: string
  name: string
  description: string
  version: string
  content: string               // full SKILL.md body (instructions)
  allowedTools?: string[]
  userInvocable: boolean
  source: 'agent' | 'shared'   // where it was loaded from
  agentId?: string              // if agent-specific
  filePath: string              // original file path
}

interface SkillManifest {
  name: string
  description: string
  version: string
  filePath: string
}
```

### Skill Discovery Order (highest priority first)

1. Agent-specific: `agents/<name>/skills/<skill>/SKILL.md`
2. Project-shared: `skills/<skill>/SKILL.md`
3. User-global: `~/.agentbus/skills/<skill>/SKILL.md`

### CLI Commands

```bash
agentbus skills list [--agent <name>]          # List available skills
agentbus skills info <skill-name>              # Show skill details
agentbus skills search <query>                 # Search skills
```

---

## Platform Integration

### Extended AgentBusPlatform

```typescript
class AgentBusPlatform {
  // Existing
  readonly registry: AgentRegistry
  readonly bus: IMessageBus
  readonly memory: MemoryStore
  readonly wake: WakeManager
  readonly config: AgentBusConfig

  // NEW
  readonly wiki: WikiStore
  readonly scheduler: CronManager
  readonly skills: SkillRegistry
  readonly agentLoader: AgentLoader

  async start(): Promise<void> {
    // ... existing startup ...
    await this.wiki.init()
    this.skills.discoverSkills([...])
    this.scheduler.loadAllFromDirectory(this.config.agentsDir)
    this.scheduler.checkMissedRuns()
    this.scheduler.start()
  }
}
```

### Extended AgentCard

```typescript
interface AgentCard {
  // ... existing fields ...

  // NEW
  folderPath?: string              // path to agent folder (if folder-loaded)
  identityFiles?: {
    claude?: string
    soul?: string
    identity?: string
  }
  cronJobs?: CronJobConfig[]
  skills?: string[]                // skill IDs available to this agent
}
```

### Extended AgentContext (SDK)

```typescript
interface AgentContext {
  // ... existing (emit, ask, reply, memory, findAgent) ...

  // NEW
  wiki: {
    post(type: PostType, input: CreatePostInput): Promise<WikiPost>
    reply(postId: string, content: string): Promise<WikiPost>
    list(filter?: WikiFilter): Promise<WikiPost[]>
    assigned(): Promise<WikiPost[]>
    search(query: string): Promise<WikiPost[]>
    page(path: string): Promise<WikiPage | undefined>
  }

  skills: {
    list(): Skill[]
    get(skillId: string): Skill | undefined
  }
}
```

---

## The Midnight Email Agent Flow (End-to-End Example)

Here's how your original scenario works in this system:

### 1. Setup

```
agents/email-agent/
  CLAUDE.md          # "You are the email agent. You monitor inboxes..."
  SOUL.md            # "Thorough, detail-oriented, security-conscious"
  agent.yaml         # capabilities: [email-monitoring, wiki-posting]
  cron.yaml          # nightly-check at midnight
  skills/
    check-inbox/SKILL.md
    draft-reply/SKILL.md
  memory/
    MEMORY.md        # "Last checked: 2026-03-14. Known senders: ..."
```

### 2. Midnight: Cron Fires

```
CronManager → detects "0 0 * * *" schedule matches
  → calls platform.wake.wake("email-agent", "Nightly email check")
  → WakeManager publishes to _wake.email-agent
  → Agent status changes to "online"
  → Wake handler fires with context
```

### 3. Agent Reads Wiki Issues

```typescript
// In email-agent's wake handler:
async onWake(event, ctx) {
  // Check what other agents posted during the day
  const openIssues = await ctx.wiki.list({
    type: 'issue',
    status: 'open',
    assignee: ctx.agentName
  });

  // Process each assigned issue
  for (const issue of openIssues) {
    await this.handleIssue(issue, ctx);
  }

  // Run inbox check skill
  const newMessages = await this.checkInbox(ctx);

  // Post findings as wiki report
  await ctx.wiki.post('report', {
    title: `Email Report - ${new Date().toISOString().split('T')[0]}`,
    content: this.formatReport(newMessages),
    tags: ['email', 'daily-report'],
  });

  // If anything urgent, create issue for other agents
  const urgent = newMessages.filter(m => m.priority === 'urgent');
  if (urgent.length > 0) {
    await ctx.wiki.post('issue', {
      title: `${urgent.length} urgent emails need attention`,
      content: this.formatUrgent(urgent),
      tags: ['email', 'urgent'],
      priority: 'high',
      assignee: 'reviewer-agent',
    });
  }

  // Update memory
  ctx.memory.set('last-inbox-check', new Date().toISOString());
}
```

### 4. Morning: Reviewer Agent Wakes

The reviewer agent has `wakePatterns: ["wiki.issue.assigned.reviewer-agent"]`.
When the email agent created the urgent issue with `assignee: reviewer-agent`, the wiki store published `wiki.issue.assigned.reviewer-agent`, which woke the reviewer.

The reviewer reads the issue, investigates, posts a reply, and resolves it.

### 5. Evening: Patrol Agent Checks Health

A patrol agent runs on cron at 6pm, scans all open issues, checks for stale items, and posts a daily summary.

---

## Implementation Order

### Phase 1: Agent Folders (foundation)
1. Define `AgentManifest`, `AgentConfig` types
2. Implement `AgentLoader` (discover, load, init)
3. Add `agentbus init` and `agentbus load` CLI commands
4. Create example agent folders
5. Tests

### Phase 2: Wiki/Forum (communication)
1. Define wiki types (`WikiPost`, `WikiPage`, `WikiFilter`)
2. Implement `WikiStore` (CRUD, search, frontmatter parsing)
3. Wire wiki events to message bus
4. Add `ctx.wiki` to AgentContext
5. Add wiki CLI commands
6. Create wiki templates
7. Tests

### Phase 3: Cron Scheduler (orchestration)
1. Add `croner` dependency
2. Define `CronJobConfig`, `CronAction` types
3. Implement `CronManager` (load, schedule, catch-up)
4. Wire cron triggers to wake system
5. Add cron state persistence
6. Add cron CLI commands
7. Tests

### Phase 4: Skills System (capabilities)
1. Define `Skill`, `SkillManifest` types
2. Implement `SkillRegistry` (discover, load, resolve)
3. SKILL.md frontmatter parser
4. Add `ctx.skills` to AgentContext
5. Add skills CLI commands
6. Create example shared skills
7. Tests

### Phase 5: Integration & Polish
1. Extend `AgentBusPlatform` with all new modules
2. End-to-end example: the midnight email agent scenario
3. Update README
4. Full test suite

---

## New Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `croner` | Cron scheduling | ~7KB, zero deps |
| `cronstrue` | Human-readable cron descriptions | ~3KB, zero deps |
| `gray-matter` | YAML frontmatter parser for markdown | ~20KB |

All other functionality built with existing deps (fs, path, EventEmitter3, uuid, chalk).

---

## Design Principles (from research)

1. **Filesystem is the coordination layer** — Posts are files. Agent identity is files. Memory is files. Git provides versioning for free.
2. **Fresh context per cron run** — Each cron trigger starts clean and reads state from disk. Outperforms continuous agents.
3. **Tools for execution, skills for reasoning** — Tools do things. Skills know how to approach problems.
4. **Deny overrides allow** — Security policies always restrict, never expand.
5. **Progressive disclosure** — Load skill names/descriptions at startup, full content on demand.
6. **One markdown file = one post** — Simple, debuggable, git-diffable.
7. **Bus events for real-time, files for persistence** — Message bus handles live coordination; wiki files persist across restarts.
