# Spec 04: Skills System

## Summary

A composable skills system where agent capabilities are defined in SKILL.md files (markdown with YAML frontmatter). Skills are "packaged reasoning" — not executable code, but structured instructions that shape how agents approach tasks. The SkillRegistry discovers, loads, and resolves skills from agent-specific and shared directories.

## Files to Create

```
src/skills/
  skill-types.ts         # Type definitions
  skill-loader.ts        # Parse SKILL.md files
  skill-registry.ts      # Discover, register, resolve skills
  index.ts               # Public exports
  __tests__/
    skill-registry.test.ts  # Tests

src/cli/commands/
  skills.ts              # CLI commands
```

---

## Type Definitions (`src/skills/skill-types.ts`)

```typescript
/**
 * Where the skill was loaded from.
 */
export type SkillSource = 'agent' | 'shared' | 'global';

/**
 * A fully loaded skill.
 */
export interface Skill {
  /** Unique identifier (derived from directory name) */
  id: string;

  /** Display name (from frontmatter) */
  name: string;

  /** What this skill does */
  description: string;

  /** Semantic version */
  version: string;

  /** Full SKILL.md body content (instructions section) */
  content: string;

  /** Tools this skill is allowed to use */
  allowedTools?: string[];

  /** Whether the user can invoke this skill directly (e.g., via CLI) */
  userInvocable: boolean;

  /** Where this skill was loaded from */
  source: SkillSource;

  /** Agent ID if agent-specific skill */
  agentId?: string;

  /** Agent name if agent-specific skill */
  agentName?: string;

  /** Absolute path to the SKILL.md file */
  filePath: string;

  /** Tags for search/categorization */
  tags?: string[];
}

/**
 * Lightweight reference to a skill (before full loading).
 * Used during discovery phase.
 */
export interface SkillManifest {
  /** Skill name (directory name) */
  name: string;

  /** Description (from frontmatter, if available without full parse) */
  description?: string;

  /** Absolute path to SKILL.md */
  filePath: string;

  /** Where it was found */
  source: SkillSource;

  /** Agent name (if agent-specific) */
  agentName?: string;
}

/**
 * SKILL.md frontmatter schema.
 */
export interface SkillFrontmatter {
  /** Display name */
  name: string;

  /** What this skill does */
  description: string;

  /** Semantic version */
  version?: string;                // default: "1.0.0"

  /** Allowed tools */
  'allowed-tools'?: string[];

  /** Whether user can invoke directly */
  'user-invocable'?: boolean;     // default: false

  /** Tags */
  tags?: string[];
}

/**
 * Options for resolving skills for an agent.
 */
export interface SkillResolutionOptions {
  /** Include shared skills */
  includeShared?: boolean;        // default: true

  /** Include global skills */
  includeGlobal?: boolean;        // default: true
}
```

---

## SKILL.md Format

### Full Example

```yaml
---
name: check-inbox
description: "Check email inbox for new messages and summarize findings"
version: 1.0.0
allowed-tools:
  - Read
  - Write
  - Bash
user-invocable: false
tags:
  - email
  - monitoring
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

## Error Handling

- If email endpoint is unreachable, create a wiki issue with tag `connectivity`
- If authentication fails, create a critical wiki issue
```

### Minimal Example

```yaml
---
name: summarize
description: "Generate a summary of recent activity"
---

# Summarize

Read recent wiki posts, memory entries, and bus messages.
Produce a concise summary organized by topic.
```

### Frontmatter Fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | Yes | — | Display name for the skill |
| `description` | Yes | — | One-line description |
| `version` | No | `"1.0.0"` | Semantic version |
| `allowed-tools` | No | — | Tools this skill may use |
| `user-invocable` | No | `false` | Whether users can invoke directly |
| `tags` | No | `[]` | Searchable tags |

---

## SkillLoader (`src/skills/skill-loader.ts`)

```typescript
import { readFile, readdir, stat, access } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import matter from 'gray-matter';
import type { Skill, SkillManifest, SkillFrontmatter, SkillSource } from './skill-types.js';

export class SkillLoader {
  /**
   * Discover skill manifests in a directory.
   * Looks for subdirectories containing a SKILL.md file.
   *
   * @param searchDir - Directory to search (e.g., "agents/email-agent/skills/")
   * @param source - Where these skills come from
   * @param agentName - Agent name (if agent-specific)
   * @returns Array of SkillManifest references
   */
  async discoverSkills(
    searchDir: string,
    source: SkillSource,
    agentName?: string
  ): Promise<SkillManifest[]> {
    // 1. readdir(searchDir) to get subdirectories
    // 2. For each subdir, check if SKILL.md exists
    // 3. Return SkillManifest with name = directory name
    // 4. Silently skip dirs without SKILL.md
    // 5. Return empty array if searchDir doesn't exist
  }

  /**
   * Fully load a skill from its SKILL.md file.
   *
   * @param filePath - Absolute path to SKILL.md
   * @param source - Where this skill comes from
   * @param agentId - Agent ID (if agent-specific)
   * @param agentName - Agent name (if agent-specific)
   */
  async loadSkill(
    filePath: string,
    source: SkillSource,
    agentId?: string,
    agentName?: string
  ): Promise<Skill> {
    // 1. Read SKILL.md file
    // 2. Parse with gray-matter (frontmatter + body)
    // 3. Validate frontmatter (name and description required)
    // 4. Apply defaults (version: "1.0.0", userInvocable: false)
    // 5. Generate id from directory name
    // 6. Return Skill object
  }

  /**
   * Parse and validate SKILL.md frontmatter.
   */
  private parseFrontmatter(data: Record<string, unknown>, filePath: string): SkillFrontmatter {
    // Validate required fields: name, description
    // Apply defaults
    // Convert kebab-case keys to camelCase for internal use
  }
}
```

---

## SkillRegistry (`src/skills/skill-registry.ts`)

```typescript
import type { Skill, SkillManifest, SkillSource, SkillResolutionOptions } from './skill-types.js';
import { SkillLoader } from './skill-loader.js';

export class SkillRegistry {
  private loader: SkillLoader;
  private skills: Map<string, Skill> = new Map();          // id → Skill
  private agentSkills: Map<string, Set<string>> = new Map(); // agentName → Set<skillId>
  private manifests: SkillManifest[] = [];

  constructor() {
    this.loader = new SkillLoader();
  }

  // ── Discovery ─────────────────────────────────────────

  /**
   * Discover skills from multiple search paths.
   * Does NOT fully load skills — only creates manifests.
   *
   * @param searchPaths - Array of { path, source, agentName? }
   */
  async discoverSkills(
    searchPaths: Array<{
      path: string;
      source: SkillSource;
      agentName?: string;
    }>
  ): Promise<SkillManifest[]> {
    // For each search path, call loader.discoverSkills()
    // Collect all manifests
    // Store in this.manifests
    // Return full list
  }

  /**
   * Fully load a skill from a manifest and register it.
   * Call this when a skill is actually needed (lazy loading).
   */
  async loadAndRegister(manifest: SkillManifest, agentId?: string): Promise<Skill> {
    // 1. loader.loadSkill(manifest.filePath, manifest.source, agentId, manifest.agentName)
    // 2. register(skill)
    // 3. Return skill
  }

  /**
   * Load all discovered manifests (eager loading alternative).
   */
  async loadAll(): Promise<Skill[]> {
    // For each manifest, loadAndRegister()
  }

  // ── Registry ──────────────────────────────────────────

  /**
   * Register a fully loaded skill.
   */
  register(skill: Skill): void {
    // 1. Store in skills map (key: skill.id or agentName:skill.id for agent-specific)
    // 2. If agent-specific, track in agentSkills map
  }

  /**
   * Get a skill by ID.
   * For agent-specific skills, use "agentName:skillId" format.
   */
  get(skillId: string): Skill | undefined {
    return this.skills.get(skillId);
  }

  /**
   * List all registered skills, optionally filtered.
   */
  list(agentName?: string): Skill[] {
    if (agentName) {
      // Return agent-specific + shared + global skills
      const agentIds = this.agentSkills.get(agentName) ?? new Set();
      return Array.from(this.skills.values()).filter(s =>
        agentIds.has(s.id) || s.source === 'shared' || s.source === 'global'
      );
    }
    return Array.from(this.skills.values());
  }

  /**
   * Search skills by query (matches name, description, tags).
   */
  search(query: string): Skill[] {
    const lower = query.toLowerCase();
    return Array.from(this.skills.values()).filter(s =>
      s.name.toLowerCase().includes(lower) ||
      s.description.toLowerCase().includes(lower) ||
      (s.tags ?? []).some(t => t.toLowerCase().includes(lower))
    );
  }

  // ── Resolution ────────────────────────────────────────

  /**
   * Resolve all skills available to a specific agent.
   * Includes agent-specific skills + shared + global (based on options).
   *
   * Priority (highest first):
   * 1. Agent-specific: agents/<name>/skills/<skill>/SKILL.md
   * 2. Project-shared: skills/<skill>/SKILL.md
   * 3. User-global: ~/.agentbus/skills/<skill>/SKILL.md
   *
   * If the same skill name exists at multiple levels, the highest-priority
   * version wins (agent-specific overrides shared overrides global).
   */
  resolveForAgent(agentName: string, options?: SkillResolutionOptions): Skill[] {
    const opts = {
      includeShared: true,
      includeGlobal: true,
      ...options,
    };

    // 1. Start with agent-specific skills
    // 2. Add shared skills (if not overridden by agent-specific)
    // 3. Add global skills (if not overridden by agent-specific or shared)
    // 4. Return deduplicated list
  }

  /**
   * Get total count of registered skills.
   */
  count(): number {
    return this.skills.size;
  }

  /**
   * Clear all registered skills.
   */
  clear(): void {
    this.skills.clear();
    this.agentSkills.clear();
    this.manifests = [];
  }
}
```

---

## Skill Discovery Order (Precedence)

When resolving skills for an agent, higher-priority sources override lower ones:

```
1. Agent-specific    agents/<agent-name>/skills/<skill>/SKILL.md    (highest)
2. Project-shared    skills/<skill>/SKILL.md
3. User-global       ~/.agentbus/skills/<skill>/SKILL.md            (lowest)
```

If `check-inbox` exists at both agent-specific and shared levels, the agent-specific version is used. This allows agents to customize shared skills.

---

## CLI Commands (`src/cli/commands/skills.ts`)

```typescript
import { Command } from 'commander';
import { getPlatform } from '../../platform.js';

export function registerSkillsCommands(program: Command): void {
  const skills = program.command('skills').description('Skills management');

  skills
    .command('list')
    .description('List available skills')
    .option('-a, --agent <name>', 'Show skills available to specific agent')
    .option('--source <source>', 'Filter by source: agent|shared|global')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      // platform.skills.list(opts.agent) or platform.skills.resolveForAgent(opts.agent)
      // Display table: Name | Description | Version | Source | Agent | Tags
    });

  skills
    .command('info <skill-name>')
    .description('Show detailed skill information')
    .option('--json', 'Output as JSON')
    .action(async (skillName, opts) => {
      // platform.skills.get(skillName)
      // Display full skill info including content body
    });

  skills
    .command('search <query>')
    .description('Search skills by name, description, or tags')
    .option('--json', 'Output as JSON')
    .action(async (query, opts) => {
      // platform.skills.search(query)
    });
}
```

---

## AgentContext Integration

The `AgentContext` interface gets a new `skills` property:

```typescript
export interface AgentContext {
  // ... existing fields ...

  skills: {
    /** List all skills available to this agent */
    list(): Skill[];

    /** Get a specific skill by ID */
    get(skillId: string): Skill | undefined;

    /** Search skills */
    search(query: string): Skill[];
  };
}
```

Usage in agent handlers:

```typescript
// In an agent's wake handler or message handler:
async onWake(event, ctx) {
  // Find the right skill for the job
  const skill = ctx.skills.get('check-inbox');
  if (skill) {
    // The skill content contains instructions that inform the agent's behavior
    // In practice, this content would be injected into the agent's context/prompt
    console.log(`Using skill: ${skill.name}`);
    console.log(`Instructions: ${skill.content}`);
  }
}
```

---

## Tests (`src/skills/__tests__/skill-registry.test.ts`)

```typescript
import { SkillLoader } from '../skill-loader.js';
import { SkillRegistry } from '../skill-registry.js';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('SkillLoader', () => {
  let loader: SkillLoader;
  let tempDir: string;

  beforeEach(async () => {
    loader = new SkillLoader();
    tempDir = await mkdtemp(join(tmpdir(), 'skill-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // Helper to create a skill directory
  async function createSkill(name: string, frontmatter: object, body: string) {
    const dir = join(tempDir, name);
    await mkdir(dir, { recursive: true });
    const fm = Object.entries(frontmatter)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join('\n');
    await writeFile(join(dir, 'SKILL.md'), `---\n${fm}\n---\n\n${body}`);
    return dir;
  }

  describe('discoverSkills', () => {
    test('finds skills with SKILL.md files');
    test('skips directories without SKILL.md');
    test('returns empty array for non-existent directory');
    test('returns empty array for empty directory');
    test('sets correct source and agentName');
  });

  describe('loadSkill', () => {
    test('loads skill with full frontmatter');
    test('loads skill with minimal frontmatter');
    test('applies default version "1.0.0"');
    test('applies default userInvocable false');
    test('parses allowed-tools array');
    test('parses tags array');
    test('extracts content body (without frontmatter)');
    test('throws on missing name');
    test('throws on missing description');
    test('throws if SKILL.md does not exist');
    test('sets correct source, agentId, agentName');
    test('generates id from directory name');
  });
});

describe('SkillRegistry', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  describe('register', () => {
    test('registers a skill');
    test('tracks agent-specific skills separately');
  });

  describe('get', () => {
    test('retrieves skill by id');
    test('returns undefined for non-existent skill');
  });

  describe('list', () => {
    test('returns all skills');
    test('filters by agent name (agent + shared + global)');
    test('returns empty array when no skills registered');
  });

  describe('search', () => {
    test('searches by name');
    test('searches by description');
    test('searches by tags');
    test('case-insensitive search');
    test('returns empty for no matches');
  });

  describe('resolveForAgent', () => {
    test('returns agent-specific + shared + global skills');
    test('agent-specific overrides shared with same name');
    test('shared overrides global with same name');
    test('respects includeShared option');
    test('respects includeGlobal option');
  });

  describe('clear', () => {
    test('removes all skills');
    test('resets agent skill tracking');
  });
});
```

### Expected Test Count: ~30-35 tests

---

## Implementation Notes

### Lazy vs Eager Loading

Two loading strategies:

1. **Eager** (recommended for now): On startup, discover all manifests AND load all skills fully. Simple, predictable. For a typical project with <50 skills, this is fast.

2. **Lazy**: On startup, only discover manifests (fast — just check directory existence). Load full skill content on first access. Better for large skill libraries.

Start with eager loading. Add lazy loading if performance becomes an issue.

### Skill ID Generation

The skill ID is the directory name (e.g., `check-inbox`, `summarize`). For agent-specific skills, the composite ID is `agentName:skillId` (e.g., `email-agent:check-inbox`).

### gray-matter for Parsing

Same `gray-matter` dependency used by the wiki module:

```typescript
import matter from 'gray-matter';

const { data, content } = matter(fileContent);
// data.name, data.description, data['allowed-tools'], etc.
// content = everything after the frontmatter closing ---
```

### Relationship to Cron Actions

When a cron job has `action.type: 'skill'`, the scheduler publishes a bus event:
```
_skill.{agentName}.{skillId} → { params, triggeredBy: 'cron', jobId }
```

The agent can listen for this subject in its message handlers and use the skill content to guide its behavior.
