# Spec 01: Agent Folders

## Summary

Load agents from filesystem directories. Each agent is a self-contained folder containing `agent.yaml` (required), identity files (`CLAUDE.md`, `SOUL.md`), optional `cron.yaml`, optional `skills/`, and optional `memory/`. Agents are invoked as Claude Code sessions (`claude -p "..."`) with their folder as the working directory. CLAUDE.md is auto-loaded by Claude Code. The agent reads its own SOUL.md and memory, does work via CLI commands, and writes back to its own memory to evolve over time.

> **Architecture context:** This spec defines the folder structure and loader. See `04-scheduler-daemon.md` for how agents are invoked, `03-cli-nodes.md` for the CLI commands agents use, and `05-skills-system.md` for how skills work.

## Files to Create

```
src/agents/
  types.ts               # Type definitions
  agent-loader.ts        # Discover and load agent folders
  agent-manager.ts       # Lifecycle management (load all, watch, init)
  index.ts               # Public exports
  __tests__/
    agent-loader.test.ts # Tests
```

## Files to Modify

```
src/types/agent.ts       # Extend AgentCard
src/cli/commands/agents.ts  # Add init, load subcommands
src/cli/commands/index.ts   # Register updates
src/index.ts             # Export new module
```

---

## Type Definitions (`src/agents/types.ts`)

```typescript
import type { AgentCapability, AgentAuth } from '../types/agent.js';

/**
 * Schema for agent.yaml — the required config file in each agent folder.
 */
export interface AgentFolderConfig {
  name: string;
  description: string;
  version?: string;                        // defaults to "1.0.0"
  capabilities: (string | AgentCapability)[];
  wakePatterns?: string[];
  endpoint?: string;
  auth?: AgentAuth;
  status?: 'online' | 'offline' | 'sleeping';  // default: 'sleeping'
  metadata?: Record<string, unknown>;
}

/**
 * Fully resolved manifest after reading an agent folder.
 */
export interface AgentManifest {
  /** Absolute path to the agent folder */
  folderPath: string;

  /** Parsed agent.yaml */
  config: AgentFolderConfig;

  /** Identity file contents (read as UTF-8 strings) */
  identityFiles: AgentIdentityFiles;

  /** Parsed cron.yaml (if exists) */
  cronConfig?: CronFileConfig;

  /** Discovered skill manifests (from skills/ subdirectory) */
  skills: AgentSkillRef[];

  /** Whether memory/ directory exists */
  hasMemory: boolean;

  /** Path to memory/ directory (if exists) */
  memoryPath?: string;
}

export interface AgentIdentityFiles {
  claude?: string;     // CLAUDE.md content
  soul?: string;       // SOUL.md content
  identity?: string;   // IDENTITY.md content
}

/**
 * Reference to a skill found in the agent's skills/ directory.
 * Full loading is deferred to the SkillRegistry.
 */
export interface AgentSkillRef {
  name: string;        // directory name
  path: string;        // absolute path to SKILL.md
}

/**
 * Schema for cron.yaml — defines scheduled jobs for the agent.
 * Full type definition is in scheduler-types.ts; this is just the file shape.
 */
export interface CronFileConfig {
  jobs: CronJobFileEntry[];
}

export interface CronJobFileEntry {
  id: string;
  schedule: string;
  description?: string;
  action: {
    type: 'wake' | 'emit' | 'skill';
    reason?: string;         // for type: 'wake'
    subject?: string;        // for type: 'emit'
    payload?: unknown;       // for type: 'emit'
    skill?: string;          // for type: 'skill'
    params?: Record<string, unknown>;  // for type: 'skill'
  };
  enabled?: boolean;         // default: true
  catchUp?: boolean;         // default: false
  timezone?: string;
  protect?: boolean;         // skip if previous run still active, default: true
}

/**
 * Result of loading an agent folder into the platform.
 */
export interface AgentLoadResult {
  manifest: AgentManifest;
  agentId: string;           // ID assigned by registry
  agentName: string;
  cronJobsLoaded: number;
  skillsLoaded: number;
  warnings: string[];        // non-fatal issues found during loading
}
```

---

## AgentCard Extensions (`src/types/agent.ts`)

Add these optional fields to the existing `AgentCard` interface:

```typescript
export interface AgentCard {
  // ... existing fields (id, name, description, version, capabilities,
  //     wakePatterns, endpoint, auth, status, registeredAt, lastSeenAt, metadata) ...

  /** Absolute path to agent folder (if loaded from folder) */
  folderPath?: string;

  /** Identity file contents */
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
```

Also extend `AgentRegistration` to accept the new fields:

```typescript
export interface AgentRegistration {
  // ... existing fields ...

  folderPath?: string;
  identityFiles?: {
    claude?: string;
    soul?: string;
    identity?: string;
  };
}
```

---

## AgentLoader (`src/agents/agent-loader.ts`)

```typescript
import { readFile, readdir, stat, access, mkdir, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { AgentManifest, AgentFolderConfig, AgentIdentityFiles,
              AgentSkillRef, CronFileConfig } from './types.js';

// Use a simple YAML parser. agent.yaml and cron.yaml are simple enough
// that we can parse them without a full YAML library.
// Option A: Use the `yaml` package (add as dependency)
// Option B: Use gray-matter's built-in YAML parser (already adding for wiki)
// Recommendation: Add `yaml` (^2.6.0) as a dependency — it's 40KB, zero deps,
// and we need it for agent.yaml / cron.yaml which are pure YAML (not frontmatter).

export class AgentLoader {
  /**
   * Scan a directory for agent folders.
   * An agent folder is any subdirectory containing an `agent.yaml` file.
   *
   * @param baseDir - Directory to scan (e.g., "agents/")
   * @returns Array of fully resolved AgentManifest objects
   */
  async discoverAgents(baseDir: string): Promise<AgentManifest[]> {
    // 1. readdir(baseDir) to get subdirectories
    // 2. For each subdir, check if agent.yaml exists
    // 3. If yes, call loadManifest(subdir)
    // 4. Sort by name for deterministic ordering
    // 5. Return manifests (skip folders without agent.yaml silently)
  }

  /**
   * Load a single agent folder into an AgentManifest.
   *
   * @param folderPath - Absolute path to the agent folder
   * @throws Error if agent.yaml is missing or invalid
   */
  async loadManifest(folderPath: string): Promise<AgentManifest> {
    // 1. Read and parse agent.yaml (required — throw if missing)
    // 2. Validate AgentFolderConfig fields (name required, etc.)
    // 3. Read identity files (CLAUDE.md, SOUL.md, IDENTITY.md) — optional
    // 4. Read cron.yaml — optional
    // 5. Discover skills in skills/ subdirectory — optional
    // 6. Check for memory/ directory — optional
    // 7. Return AgentManifest
  }

  /**
   * Initialize a new agent folder from scratch.
   *
   * @param baseDir - Parent directory (e.g., "agents/")
   * @param name - Agent name (used as folder name)
   * @param template - Optional template: 'basic' | 'full' | 'cron'
   * @returns Path to the created folder
   */
  async initAgent(baseDir: string, name: string, template: string = 'basic'): Promise<string> {
    // 1. Validate name (same rules as AgentRegistry.validateAgentName)
    // 2. Create directory: baseDir/name/
    // 3. Write agent.yaml with defaults
    // 4. If template === 'full': also create CLAUDE.md, SOUL.md, IDENTITY.md, skills/, memory/
    // 5. If template === 'cron': also create cron.yaml with example job
    // 6. Return folder path
  }

  /**
   * Read identity files from an agent folder.
   * Missing files are returned as undefined (not errors).
   */
  private async readIdentityFiles(folderPath: string): Promise<AgentIdentityFiles> {
    // Read CLAUDE.md, SOUL.md, IDENTITY.md — catch ENOENT, return undefined for missing
  }

  /**
   * Discover skill references in the agent's skills/ subdirectory.
   * Only checks for SKILL.md existence — does not parse skill content.
   */
  private async discoverSkills(folderPath: string): Promise<AgentSkillRef[]> {
    // 1. Check if skills/ exists
    // 2. readdir skills/, find subdirs containing SKILL.md
    // 3. Return array of { name: dirName, path: absolute path to SKILL.md }
  }

  /**
   * Parse and validate agent.yaml content.
   */
  private parseAgentConfig(content: string, folderPath: string): AgentFolderConfig {
    // Parse YAML, validate required fields (name, description, capabilities)
    // Apply defaults (version: "1.0.0", status: "sleeping")
  }

  /**
   * Parse and validate cron.yaml content.
   */
  private parseCronConfig(content: string, folderPath: string): CronFileConfig {
    // Parse YAML, validate each job has id, schedule, action
    // Apply defaults (enabled: true, catchUp: false, protect: true)
  }
}
```

---

## AgentManager (`src/agents/agent-manager.ts`)

```typescript
import type { AgentBusPlatform } from '../platform.js';
import type { AgentManifest, AgentLoadResult } from './types.js';
import { AgentLoader } from './agent-loader.js';

/**
 * Higher-level manager that coordinates loading agent folders
 * into the platform (registry, scheduler, skills).
 */
export class AgentManager {
  private loader: AgentLoader;
  private loaded: Map<string, AgentLoadResult> = new Map();  // name → result

  constructor(private platform: AgentBusPlatform) {
    this.loader = new AgentLoader();
  }

  /**
   * Load a single agent from a folder into the platform.
   * Registers with registry, loads cron jobs, discovers skills.
   */
  async loadAgent(folderPath: string): Promise<AgentLoadResult> {
    // 1. loader.loadManifest(folderPath) → manifest
    // 2. Register with platform.registry (convert manifest to AgentRegistration)
    // 3. If manifest.cronConfig, load jobs into platform.scheduler
    // 4. If manifest.skills, register with platform.skills
    // 5. Track in this.loaded map
    // 6. Return AgentLoadResult
  }

  /**
   * Load all agents from a directory.
   */
  async loadDirectory(baseDir: string): Promise<AgentLoadResult[]> {
    // 1. loader.discoverAgents(baseDir)
    // 2. For each manifest, call loadAgent()
    // 3. Collect results and warnings
    // 4. Return all results
  }

  /**
   * Unload an agent (unregister, remove cron jobs, remove skills).
   */
  async unloadAgent(name: string): Promise<boolean> {
    // Reverse of loadAgent
  }

  /**
   * Initialize a new agent folder.
   */
  async initAgent(baseDir: string, name: string, template?: string): Promise<string> {
    return this.loader.initAgent(baseDir, name, template);
  }

  /**
   * Get all loaded agent manifests.
   */
  getLoaded(): AgentLoadResult[] {
    return Array.from(this.loaded.values());
  }

  /**
   * Get a specific loaded agent's manifest.
   */
  getLoadResult(name: string): AgentLoadResult | undefined {
    return this.loaded.get(name);
  }
}
```

---

## agent.yaml Schema (Reference)

```yaml
# REQUIRED fields
name: email-agent                      # unique identifier, no dots/colons
description: "Monitors email inboxes and processes messages"

# OPTIONAL fields
version: "1.0.0"                       # semver, default "1.0.0"

capabilities:                          # array of strings or objects
  - email-monitoring                   # simple string form
  - name: wiki-posting                 # object form
    description: "Posts findings to the shared wiki"
    subjects:
      - "wiki.post.>"

wakePatterns:                          # NATS-style subject patterns
  - "email.>"
  - "wiki.issue.assigned.email-agent"

endpoint: "http://localhost:3001"      # optional HTTP endpoint

auth:                                  # optional auth config
  type: token
  tokenHeader: "Authorization"

status: sleeping                       # initial status: online | offline | sleeping

metadata:                              # arbitrary key-value pairs
  owner: "team-comms"
  tier: "production"
  tags: ["email", "monitoring"]
```

### Validation Rules

| Field | Rule |
|-------|------|
| `name` | Required. Must pass `validateAgentName()`: no dots, no colons, non-empty |
| `description` | Required. Non-empty string |
| `capabilities` | Required. Non-empty array. Each item is string or `{name, description?, subjects?}` |
| `version` | Optional. Defaults to `"1.0.0"` |
| `wakePatterns` | Optional. Each must pass `validateSubject(pattern, true)` |
| `status` | Optional. Must be one of `AgentStatus` values. Defaults to `"sleeping"` |

---

## cron.yaml Schema (Reference)

```yaml
jobs:
  - id: nightly-email-check            # unique within this agent
    schedule: "0 0 * * *"              # standard cron expression (5 or 6 fields)
    description: "Check inbox and post findings to wiki"
    action:
      type: wake                        # wake | emit | skill
      reason: "Nightly email check"     # only for type: wake
    enabled: true                       # default: true
    catchUp: true                       # run missed jobs on startup, default: false
    timezone: "America/New_York"        # optional, default: system timezone
    protect: true                       # skip if previous run still active, default: true

  - id: morning-report
    schedule: "0 9 * * 1-5"
    description: "Generate daily email summary"
    action:
      type: skill
      skill: summarize
      params:
        scope: "yesterday"
    enabled: true

  - id: hourly-heartbeat
    schedule: "*/60 * * * *"
    description: "Emit heartbeat event"
    action:
      type: emit
      subject: "heartbeat.email-agent"
      payload:
        source: "email-agent"
    enabled: true
```

---

## Template Files for `agentbus init`

### basic template

Creates:
- `agent.yaml` (minimal: name, description, capabilities)

### full template

Creates:
- `agent.yaml` (full example with all optional fields)
- `CLAUDE.md` (starter instructions)
- `SOUL.md` (starter persona)
- `IDENTITY.md` (starter expertise)
- `skills/` (empty directory)
- `memory/MEMORY.md` (empty with header comment)
- `memory/journal/` (empty directory)

### cron template

Creates:
- `agent.yaml` (with wake patterns)
- `cron.yaml` (example job)
- `CLAUDE.md` (instructions mentioning cron)

---

## CLI Commands

### `agentbus init <name> [options]`

Create a new agent folder.

```
Options:
  -d, --dir <path>       Parent directory (default: "./agents")
  -t, --template <type>  Template: basic | full | cron (default: "basic")

Example:
  agentbus init email-agent --template full
  agentbus init patrol-bot --dir ./my-agents --template cron
```

Output:
```
Created agent folder: agents/email-agent/
  agent.yaml    ✓
  CLAUDE.md     ✓
  SOUL.md       ✓
  IDENTITY.md   ✓
  skills/       ✓
  memory/       ✓
```

### `agentbus load <path> [options]`

Load agent(s) from folder(s) into the running platform.

```
Options:
  --json    Output as JSON

Example:
  agentbus load agents/email-agent     # Load single agent
  agentbus load agents/                # Load all agents in directory
```

Output:
```
Loaded 3 agents:
  email-agent    2 cron jobs, 3 skills
  reviewer-agent 0 cron jobs, 1 skill
  patrol-agent   1 cron job, 0 skills

Warnings:
  reviewer-agent: SOUL.md is empty
```

### Extended `agentbus info <name>`

When an agent was loaded from a folder, show additional information:

```
Agent: email-agent
  ID:           a1b2c3d4-...
  Status:       sleeping
  Folder:       /path/to/agents/email-agent
  Version:      1.0.0
  Capabilities: email-monitoring, wiki-posting
  Wake:         email.>, wiki.issue.assigned.email-agent
  Cron Jobs:    nightly-email-check (0 0 * * *), morning-report (0 9 * * 1-5)
  Skills:       check-inbox, draft-reply, summarize
  Identity:
    CLAUDE.md:  ✓ (245 lines)
    SOUL.md:    ✓ (12 lines)
    IDENTITY.md: ✓ (8 lines)
  Memory:       memory/MEMORY.md (32 lines)
```

---

## Tests (`src/agents/__tests__/agent-loader.test.ts`)

### Test Structure

```typescript
import { AgentLoader } from '../agent-loader.js';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('AgentLoader', () => {
  let loader: AgentLoader;
  let tempDir: string;

  beforeEach(async () => {
    loader = new AgentLoader();
    tempDir = await mkdtemp(join(tmpdir(), 'agentbus-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // Helper to create agent folders in tempDir
  async function createAgentFolder(name: string, config: object, extras?: Record<string, string>) {
    const dir = join(tempDir, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'agent.yaml'), /* serialize config */);
    if (extras) {
      for (const [file, content] of Object.entries(extras)) {
        const filePath = join(dir, file);
        await mkdir(join(filePath, '..'), { recursive: true });
        await writeFile(filePath, content);
      }
    }
    return dir;
  }

  describe('discoverAgents', () => {
    test('finds agent folders with agent.yaml');
    test('skips directories without agent.yaml');
    test('skips non-directory entries');
    test('returns empty array for empty directory');
    test('returns manifests sorted by name');
    test('throws if baseDir does not exist');
  });

  describe('loadManifest', () => {
    test('loads minimal agent.yaml');
    test('loads agent.yaml with all fields');
    test('reads CLAUDE.md when present');
    test('reads SOUL.md when present');
    test('reads IDENTITY.md when present');
    test('identity files are undefined when missing');
    test('reads cron.yaml when present');
    test('cronConfig is undefined when cron.yaml missing');
    test('discovers skills in skills/ subdirectory');
    test('skills is empty array when no skills/ dir');
    test('detects memory/ directory');
    test('throws on missing agent.yaml');
    test('throws on invalid YAML');
    test('throws when name is missing');
    test('throws when description is missing');
    test('throws when capabilities is empty');
    test('applies default version "1.0.0"');
    test('applies default status "sleeping"');
    test('validates wake patterns');
  });

  describe('initAgent', () => {
    test('creates basic template');
    test('creates full template with all files');
    test('creates cron template with cron.yaml');
    test('throws on invalid agent name');
    test('throws if folder already exists');
    test('creates parent directory if needed');
  });
});
```

### Expected Test Count: ~25-30 tests

---

## Implementation Notes

### YAML Parsing

We need a YAML parser for `agent.yaml` and `cron.yaml`. Options:

1. **Add `yaml` package** (recommended) — Standard YAML parser, 40KB, zero deps
2. **Use `gray-matter`'s built-in** — Only works for frontmatter, not standalone YAML
3. **Simple hand-parser** — Too fragile for nested objects

**Recommendation:** Add `yaml` (^2.6.0) as a dependency. It's the standard choice and we need robust YAML parsing for both agent config and cron config.

### File Watching (Future)

The `watch()` method on AgentLoader is intentionally deferred. For now, agents are loaded on startup or via CLI. File watching adds complexity (debouncing, partial writes, etc.) and can be added later if needed.

### Relationship to Existing Registry

`AgentManager.loadAgent()` calls `platform.registry.register()` under the hood. Folder-loaded agents are standard AgentCards with extra fields (`folderPath`, `identityFiles`). They participate in all existing registry operations (search, resolve, status updates, etc.).

### Error Handling

- Missing `agent.yaml` → throw with clear message including path
- Invalid YAML → throw with parse error details
- Missing required fields → throw listing which fields are missing
- Missing optional files → silently skip (set to undefined)
- Invalid cron expressions → throw with job ID and expression
- Invalid wake patterns → throw with pattern and validation error
