# Spec 05: Platform Integration

## Summary

This spec covers how the four new modules (Agent Folders, Wiki, Cron Scheduler, Skills) integrate with the existing AgentBusPlatform, AgentBuilder/Agent SDK, and CLI infrastructure.

## Files to Modify

```
src/platform.ts              # Add new module properties and initialization
src/types/agent.ts           # Extend AgentCard and AgentRegistration
src/sdk/agent-builder.ts     # Extend AgentBuilder and AgentContext
src/cli/commands/index.ts    # Register new command modules
src/cli/commands/agents.ts   # Add init and load subcommands
src/index.ts                 # Export new modules
package.json                 # Add new dependencies
```

---

## 1. Platform Extensions (`src/platform.ts`)

### New Properties

```typescript
import { WikiStore } from './wiki/wiki-store.js';
import { CronManager } from './scheduler/scheduler.js';
import { SkillRegistry } from './skills/skill-registry.js';
import { AgentManager } from './agents/agent-manager.js';

export class AgentBusPlatform {
  // ── Existing ──────────────────────────────────────────
  readonly registry: AgentRegistry;
  readonly bus: IMessageBus;
  readonly memory: MemoryStore;
  readonly wake: WakeManager;
  readonly config: AgentBusConfig;
  private embeddedNats: EmbeddedNats | null = null;

  // ── New ───────────────────────────────────────────────
  readonly wiki: WikiStore;
  readonly scheduler: CronManager;
  readonly skills: SkillRegistry;
  readonly agentLoader: AgentManager;

  constructor(configOverrides: Partial<AgentBusConfig> = {}) {
    this.config = loadConfig(configOverrides);
    ensureDataDir(this.config);

    // Existing initialization (unchanged)
    this.registry = new AgentRegistry();
    // ... bus selection logic ...
    this.memory = new MemoryStore({ cleanupIntervalMs: this.config.memoryCleanupInterval });
    this.wake = new WakeManager(this.registry, this.bus, { maxLog: this.config.maxWakeLog });

    // New module initialization
    this.wiki = new WikiStore(
      this.config.wikiDir ?? join(process.cwd(), 'wiki'),
      this.bus
    );
    this.scheduler = new CronManager(this);
    this.skills = new SkillRegistry();
    this.agentLoader = new AgentManager(this);

    this.loadState();
  }

  async start(): Promise<void> {
    // ... existing NATS startup ...

    // New: Initialize wiki directory structure
    await this.wiki.init();

    // New: Discover skills from shared and global paths
    await this.skills.discoverSkills([
      { path: join(process.cwd(), 'skills'), source: 'shared' },
      { path: join(this.config.dataDir, 'skills'), source: 'global' },
    ]);
    await this.skills.loadAll();

    // New: Load agent folders if agentsDir is configured
    if (this.config.agentsDir) {
      await this.agentLoader.loadDirectory(this.config.agentsDir);
    }

    // New: Check for missed cron runs and start scheduler
    await this.scheduler.checkMissedRuns();
    this.scheduler.start();

    this.wake.start();
  }

  async shutdown(): Promise<void> {
    // New: Stop scheduler and save state
    this.scheduler.stop();
    await this.scheduler.saveState();

    // Existing shutdown
    this.wake.stop();
    this.saveState();
    if (this.embeddedNats) {
      await this.embeddedNats.stop();
    }
    await this.bus.drain();
  }

  saveState(): void {
    // Existing: save registry and memory
    // ...

    // New: scheduler state is saved separately (in scheduler.stop())
  }
}
```

---

## 2. Config Extensions (`src/config/config.ts`)

### Extended AgentBusConfig

```typescript
export interface AgentBusConfig {
  // ── Existing ──────────────────────────────────────────
  dataDir: string;                         // ~/.agentbus
  natsUrl?: string;
  embedded: boolean;
  maxHistory: number;
  maxWakeLog: number;
  requestTimeout: number;
  memoryCleanupInterval: number;

  // ── New ───────────────────────────────────────────────
  /** Path to agents/ directory (default: ./agents) */
  agentsDir?: string;

  /** Path to wiki/ directory (default: ./wiki) */
  wikiDir?: string;

  /** Whether to auto-load agent folders on startup (default: true if agentsDir exists) */
  autoLoadAgents?: boolean;

  /** Whether to auto-start cron scheduler (default: true) */
  autoStartScheduler?: boolean;
}
```

Default resolution:
- `agentsDir`: `join(process.cwd(), 'agents')` — only if directory exists
- `wikiDir`: `join(process.cwd(), 'wiki')`
- `autoLoadAgents`: `true`
- `autoStartScheduler`: `true`

---

## 3. AgentCard Extensions (`src/types/agent.ts`)

```typescript
export interface AgentCard {
  // ── Existing (unchanged) ──────────────────────────────
  id: string;
  name: string;
  description: string;
  version: string;
  capabilities: AgentCapability[];
  wakePatterns: string[];
  endpoint?: string;
  auth?: AgentAuth;
  status: AgentStatus;
  registeredAt: string;
  lastSeenAt: string;
  metadata?: Record<string, unknown>;

  // ── New fields ────────────────────────────────────────
  /** Absolute path to agent folder (if loaded from folder) */
  folderPath?: string;

  /** Identity file contents (if loaded from folder) */
  identityFiles?: {
    claude?: string;
    soul?: string;
    identity?: string;
  };

  /** Cron job IDs registered for this agent */
  cronJobs?: string[];

  /** Skill IDs available to this agent */
  skills?: string[];
}

export interface AgentRegistration {
  // ── Existing (unchanged) ──────────────────────────────
  name: string;
  description: string;
  version?: string;
  capabilities: string[] | AgentCapability[];
  wakePatterns?: string[];
  endpoint?: string;
  auth?: AgentAuth;
  metadata?: Record<string, unknown>;

  // ── New fields ────────────────────────────────────────
  folderPath?: string;
  identityFiles?: {
    claude?: string;
    soul?: string;
    identity?: string;
  };
}
```

### Registry Changes

The `AgentRegistry.register()` method needs to pass through the new fields (`folderPath`, `identityFiles`) when creating an `AgentCard`. No other registry logic changes — the new fields are just stored and retrieved.

---

## 4. AgentBuilder/SDK Extensions (`src/sdk/agent-builder.ts`)

### Extended AgentBuilder

```typescript
export class AgentBuilder {
  // ── Existing (unchanged) ──────────────────────────────
  private registration: AgentRegistration;
  private messageHandlers: Map<string, MessageHandler> = new Map();
  private wakeCallback?: WakeCallback;
  private platform?: AgentBusPlatform;

  constructor(name: string) { /* unchanged */ }
  description(desc: string): this { /* unchanged */ }
  version(ver: string): this { /* unchanged */ }
  capabilities(caps: string[]): this { /* unchanged */ }
  wakeOn(patterns: string[]): this { /* unchanged */ }
  endpoint(url: string): this { /* unchanged */ }
  metadata(data: Record<string, unknown>): this { /* unchanged */ }
  onMessage(subject: string, handler: MessageHandler): this { /* unchanged */ }
  onWake(callback: WakeCallback): this { /* unchanged */ }
  usePlatform(platform: AgentBusPlatform): this { /* unchanged */ }

  // ── New builder methods ───────────────────────────────

  /**
   * Load agent configuration from a folder (agent.yaml + identity files).
   * This is an alternative to manual builder configuration.
   */
  fromFolder(folderPath: string): this {
    // 1. Read agent.yaml
    // 2. Set name, description, version, capabilities, wakePatterns from config
    // 3. Read identity files (CLAUDE.md, SOUL.md, IDENTITY.md)
    // 4. Store folderPath and identityFiles in registration
    // 5. Return this for chaining
    // NOTE: This is a convenience method. AgentManager.loadAgent() does the same
    //       thing but also handles cron and skills integration.
  }

  /**
   * Declare which skills this agent uses.
   * Skills are resolved by the SkillRegistry at build time.
   */
  withSkills(skillIds: string[]): this {
    // Store skill IDs for later resolution
  }

  /**
   * Add cron jobs for this agent.
   */
  withCron(jobs: CronJobConfig[]): this {
    // Store cron configs for registration during start()
  }

  build(): Agent { /* extended — see below */ }
}
```

### Extended AgentContext

```typescript
export interface AgentContext {
  // ── Existing (unchanged) ──────────────────────────────
  readonly agentId: string;
  readonly agentName: string;

  emit(subject: string, payload: unknown): BusMessage;
  ask(agentName: string, message: string, timeout?: number): Promise<BusMessage>;
  reply(originalMessage: BusMessage, payload: unknown): BusMessage;

  memory: {
    set(key: string, value: unknown, opts?: { scope?: MemoryScope; tags?: string[]; ttl?: number }): MemoryEntry;
    get(key: string, scope?: MemoryScope): MemoryEntry | undefined;
    search(query: string, limit?: number): MemoryEntry[];
  };

  findAgent(nameOrId: string): AgentCard | undefined;
  findByCapability(capability: string): AgentCard[];

  // ── New context properties ────────────────────────────

  /**
   * Wiki operations (author is automatically set to this agent).
   */
  wiki: {
    /** Create a new post (author auto-set to ctx.agentName) */
    post(type: PostType, input: Omit<CreatePostInput, 'author' | 'type'>): Promise<WikiPost>;

    /** Add a reply to a post (author auto-set) */
    reply(postId: string, content: string): Promise<WikiPost>;

    /** List posts with filters */
    list(filter?: WikiFilter): Promise<WikiPost[]>;

    /** Get posts assigned to this agent */
    assigned(): Promise<WikiPost[]>;

    /** Search posts */
    search(query: string): Promise<WikiPost[]>;

    /** Get a wiki page by path */
    page(path: string): Promise<WikiPage | undefined>;

    /** Create a wiki page (author auto-set) */
    createPage(path: string, title: string, content: string, tags?: string[]): Promise<WikiPage>;
  };

  /**
   * Skills available to this agent.
   */
  skills: {
    /** List all skills available to this agent */
    list(): Skill[];

    /** Get a specific skill by ID */
    get(skillId: string): Skill | undefined;

    /** Search skills by query */
    search(query: string): Skill[];
  };
}
```

### Context Creation (in Agent class)

```typescript
private createContext(): AgentContext {
  const platform = this.platform;
  const agentId = this.card!.id;
  const agentName = this.card!.name;

  return {
    // ... existing context fields ...

    wiki: {
      post: (type, input) =>
        platform.wiki.createPost({ ...input, type, author: agentName }),

      reply: (postId, content) =>
        platform.wiki.addReply(postId, agentName, content),

      list: (filter) =>
        platform.wiki.listPosts(filter),

      assigned: () =>
        platform.wiki.getAssigned(agentName),

      search: (query) =>
        platform.wiki.search(query),

      page: (path) =>
        platform.wiki.getPage(path),

      createPage: (path, title, content, tags) =>
        platform.wiki.createPage({ path, title, content, author: agentName, tags }),
    },

    skills: {
      list: () =>
        platform.skills.resolveForAgent(agentName),

      get: (skillId) =>
        platform.skills.get(skillId) ??
        platform.skills.get(`${agentName}:${skillId}`),

      search: (query) =>
        platform.skills.search(query),
    },
  };
}
```

---

## 5. CLI Registration (`src/cli/commands/index.ts`)

```typescript
import { registerAgentCommands } from './agents.js';
import { registerBusCommands } from './bus.js';
import { registerMemoryCommands } from './memory.js';
import { registerWakeCommands } from './wake.js';
import { registerStatusCommand } from './status.js';
// New
import { registerWikiCommands } from './wiki.js';
import { registerCronCommands } from './cron.js';
import { registerSkillsCommands } from './skills.js';

export function registerCommands(program: Command): void {
  registerAgentCommands(program);
  registerBusCommands(program);
  registerMemoryCommands(program);
  registerWakeCommands(program);
  registerStatusCommand(program);
  // New
  registerWikiCommands(program);
  registerCronCommands(program);
  registerSkillsCommands(program);
}
```

---

## 6. CLI Agents Extensions (`src/cli/commands/agents.ts`)

Add `init` and `load` subcommands to the existing agents command group:

```typescript
// Add to existing agents command group:

agents
  .command('init <name>')
  .description('Create a new agent folder')
  .option('-d, --dir <path>', 'Parent directory', './agents')
  .option('-t, --template <type>', 'Template: basic|full|cron', 'basic')
  .action(async (name, opts) => {
    const platform = await getPlatform();
    const folderPath = await platform.agentLoader.initAgent(opts.dir, name, opts.template);
    // Print created files
  });

agents
  .command('load <path>')
  .description('Load agent(s) from folder')
  .option('--json', 'Output as JSON')
  .action(async (path, opts) => {
    const platform = await getPlatform();
    const stats = await stat(path);
    if (stats.isDirectory()) {
      // Check if path itself is an agent (has agent.yaml) or a parent dir
      const hasAgentYaml = await access(join(path, 'agent.yaml')).then(() => true).catch(() => false);
      if (hasAgentYaml) {
        const result = await platform.agentLoader.loadAgent(path);
        // Print single result
      } else {
        const results = await platform.agentLoader.loadDirectory(path);
        // Print summary table
      }
    }
  });
```

---

## 7. Extended Status Command (`src/cli/commands/status.ts`)

The `agentbus status` command should now include new module info:

```
AgentBus Status
───────────────────────────────────
Bus:          In-Memory
Agents:       5 (3 online, 1 sleeping, 1 offline)
  Folder:     3 loaded from agents/
Messages:     142 (history: 10000 max)
Subscriptions: 8 active
Memory:       23 entries (12 agent, 8 shared, 3 session)
Wake:         7 events logged
Wiki:         12 posts (5 issues, 3 reports, 2 proposals, 2 announcements)
  Open:       3 issues, 1 proposal
Scheduler:    4 jobs (3 enabled, 1 disabled)
  Next run:   email-agent/nightly-check in 2h 15m
Skills:       8 (5 shared, 3 agent-specific)
```

---

## 8. Public API Exports (`src/index.ts`)

```typescript
// ── Existing exports ────────────────────────────────────
export { AgentBusPlatform, getPlatform } from './platform.js';
export { AgentRegistry } from './registry/index.js';
export { MessageBus, NatsMessageBus } from './bus/index.js';
export type { IMessageBus, BusEvents } from './bus/index.js';
export { MemoryStore, VersionConflictError } from './memory/index.js';
export { WakeManager } from './wake/index.js';
export { AgentBuilder, Agent } from './sdk/index.js';
export type { AgentContext } from './sdk/index.js';
export { loadConfig, saveConfig } from './config/index.js';
export type {
  AgentCard, AgentCapability, AgentAuth, AgentStatus, AgentRegistration,
  BusMessage, MessageType, MessageFilter, Subscription,
  MemoryEntry, MemoryScope, MemoryQuery, MemoryStats,
  AgentBusConfig,
} from './types/index.js';

// ── New exports ─────────────────────────────────────────

// Agent Folders
export { AgentLoader } from './agents/index.js';
export { AgentManager } from './agents/index.js';
export type {
  AgentManifest, AgentFolderConfig, AgentIdentityFiles,
  AgentSkillRef, AgentLoadResult,
} from './agents/index.js';

// Wiki
export { WikiStore } from './wiki/index.js';
export type {
  WikiPost, WikiPage, WikiReply, WikiFilter,
  CreatePostInput, UpdatePostInput, CreatePageInput,
  PostType, PostStatus, Priority,
} from './wiki/index.js';

// Scheduler
export { CronManager } from './scheduler/index.js';
export type {
  CronJobConfig, CronAction, CronJobHandle, CronJobStatus,
  CronTriggerEvent, CronCompleteEvent, CronCatchUpResult,
} from './scheduler/index.js';

// Skills
export { SkillLoader, SkillRegistry } from './skills/index.js';
export type {
  Skill, SkillManifest, SkillFrontmatter, SkillSource,
} from './skills/index.js';
```

---

## 9. New Dependencies (`package.json`)

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
    "croner": "^9.0.0",
    "cronstrue": "^2.50.0",
    "gray-matter": "^4.0.3",
    "yaml": "^2.6.0"
  }
}
```

New additions:
- `croner` — Cron scheduling (zero deps)
- `cronstrue` — Human-readable cron descriptions (zero deps)
- `gray-matter` — YAML frontmatter parser for markdown (wiki + skills)
- `yaml` — YAML parser for agent.yaml and cron.yaml

---

## 10. End-to-End Flow: Midnight Email Agent

This is the complete data flow for the scenario described in the overview.

### Setup Phase (on startup)

```
1. getPlatform() called
2. Platform constructor creates all modules
3. platform.start() called:
   a. Wiki.init() creates wiki/ directory structure
   b. SkillRegistry discovers shared skills in skills/
   c. AgentManager.loadDirectory("agents/") discovers 3 agents:
      - email-agent → registers with registry, loads 2 cron jobs, discovers 2 skills
      - reviewer-agent → registers, no cron, discovers 1 skill
      - patrol-agent → registers, loads 1 cron job, no skills
   d. CronManager.checkMissedRuns() → catches up any missed jobs
   e. CronManager.start() → activates all enabled cron schedules
   f. WakeManager.start() → begins listening for bus events
```

### Runtime: Midnight Cron Fires

```
1. croner triggers email-agent's "nightly-email-check" job (0 0 * * *)

2. CronManager.executeAction():
   - action.type === 'wake'
   - Calls platform.wake.wake("email-agent-uuid", "Nightly email check")

3. WakeManager.wake():
   - Updates agent status: sleeping → online
   - Creates WakeEvent
   - Invokes registered wake handler

4. Email agent's wake handler fires with AgentContext:
   a. ctx.wiki.assigned() → WikiStore.getAssigned("email-agent")
      - Finds 1 open issue: "Memory cleanup needed"
      - Returns WikiPost[]

   b. Agent processes assigned issues

   c. Agent runs check-inbox logic (guided by ctx.skills.get("check-inbox"))

   d. ctx.wiki.post('report', { title: "Email Report - 2026-03-15", ... })
      - WikiStore writes forum/daily-reports/20260315-000100-email-report.md
      - Bus publishes: wiki.post.created → { type: 'report', author: 'email-agent' }

   e. Agent finds 2 urgent emails:
      ctx.wiki.post('issue', {
        title: "2 urgent emails need attention",
        assignee: "reviewer-agent",
        priority: "high",
        tags: ["email", "urgent"],
        ...
      })
      - WikiStore writes forum/issues/20260315-000105-urgent-emails.md
      - Bus publishes: wiki.post.created
      - Bus publishes: wiki.issue.assigned.reviewer-agent ← KEY EVENT

5. WakeManager.checkWakePatterns() sees wiki.issue.assigned.reviewer-agent
   - Matches reviewer-agent's wakePattern: "wiki.issue.assigned.reviewer-agent"
   - Calls wake() on reviewer-agent

6. Reviewer agent's wake handler fires:
   a. ctx.wiki.assigned() → finds the new urgent issue
   b. Reads the issue content
   c. Investigates (e.g., checks email configs)
   d. ctx.wiki.reply("20260315-000105", "Checked the emails. Rate limit issue...")
   e. ctx.wiki.list({ type: 'issue', status: 'open', assignee: ctx.agentName })
      → process any remaining assignments

7. Later: patrol-agent's 6pm cron fires
   a. Reads all open issues → creates summary report
   b. Flags stale issues (older than 24h with no replies)
```

---

## 11. Testing Strategy

### Unit Tests (per module — see individual specs)

Each module has its own `__tests__/` directory with isolated unit tests:
- `agent-loader.test.ts` — ~25-30 tests
- `wiki-store.test.ts` — ~55-60 tests
- `scheduler.test.ts` — ~40-45 tests
- `skill-registry.test.ts` — ~30-35 tests

**Total: ~150-170 unit tests**

### Integration Tests

Create `src/__tests__/integration.test.ts`:

```typescript
describe('Integration', () => {
  test('load agent folder → register → cron fires → agent wakes');
  test('agent posts wiki issue → assigned agent wakes via bus');
  test('cron catch-up executes missed jobs on restart');
  test('skill resolution: agent-specific overrides shared');
  test('full lifecycle: init → load → schedule → wiki post → reply → resolve');
});
```

### Test Utilities

Create `src/__tests__/helpers.ts`:

```typescript
/**
 * Create a temporary agent folder structure for testing.
 */
export async function createTestAgentFolder(
  baseDir: string,
  name: string,
  options?: {
    config?: Partial<AgentFolderConfig>;
    claude?: string;
    soul?: string;
    identity?: string;
    cronJobs?: CronJobFileEntry[];
    skills?: Record<string, { frontmatter: object; body: string }>;
  }
): Promise<string>

/**
 * Create a mock platform with all modules for integration testing.
 */
export function createTestPlatform(
  configOverrides?: Partial<AgentBusConfig>
): AgentBusPlatform
```

---

## 12. Migration / Backwards Compatibility

All new features are additive. No existing APIs change their signature or behavior:

- `AgentCard` gets new optional fields → existing code ignores them
- `AgentRegistration` gets new optional fields → existing registrations still work
- `AgentContext` gets new optional properties → existing handlers don't use them
- `AgentBusPlatform` gets new readonly properties → existing access patterns unchanged
- CLI gets new command groups → existing commands untouched
- `AgentBusConfig` gets new optional fields → existing configs work with defaults

**Zero breaking changes.** An existing AgentBus installation continues to work exactly as before. The new modules activate only when:
- An `agents/` directory exists (agent loading)
- A `wiki/` directory is created (wiki operations)
- Cron jobs are configured in `cron.yaml` (scheduling)
- SKILL.md files exist (skills discovery)
